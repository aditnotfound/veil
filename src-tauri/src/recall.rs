//! Local recall over the knowledge library and layered memory.
//!
//! Each query is answered from two rankings fused with reciprocal rank fusion:
//! SQLite FTS5 keyword matches and on-device sentence embeddings
//! (`embedder`). Both run without network access. Vectors are persisted in
//! `recall_vectors` and mirrored in memory as one contiguous matrix; missing
//! vectors are filled in by a background task so searches never wait on it.
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqliteConnectOptions, Connection, Row, SqliteConnection};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::embedder::TextEmbedder;

const MODEL_ID: &str = "arctic-embed-xs";
const RRF_K: f32 = 60.0;
const CANDIDATES: usize = 40;
const EMBED_BATCH: usize = 8;
const EXCERPT_CHARS: usize = 700;
const MAX_MEMORY_CHARS: usize = 2000;

// Similarities from this model cluster tightly (unrelated text averages about
// 0.45), so semantic relevance is judged as a z-score against the similarity
// of everything else indexed. Small libraries borrow a calibrated prior.
const PRIOR_MEAN: f32 = 0.453;
const PRIOR_STD: f32 = 0.042;
const PRIOR_WEIGHT: f32 = 50.0;
/// A hit found only by meaning must stand this many deviations above the rest.
const SEMANTIC_ONLY_MIN_RELEVANCE: f32 = 2.0;

// Embeddings rate "presented at ACL 2025" and "will present at ACL 2026" as
// near-identical, so merging also requires the same numbers and wording.
const DEDUPE_MIN_SIMILARITY: f32 = 0.97;
const DEDUPE_SURE_SIMILARITY: f32 = 0.985;
const DEDUPE_MIN_WORD_OVERLAP: f32 = 0.5;

const STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "did", "do", "does", "for", "from",
    "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "please", "the", "their",
    "them", "there", "these", "this", "to", "us", "was", "we", "were", "what", "when", "where",
    "which", "who", "why", "with", "would", "you", "your",
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ItemKind {
    Chunk,
    Memory,
}

impl ItemKind {
    fn as_str(self) -> &'static str {
        match self {
            ItemKind::Chunk => "chunk",
            ItemKind::Memory => "memory",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "chunk" => Some(ItemKind::Chunk),
            "memory" => Some(ItemKind::Memory),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
struct Key {
    id: String,
    kind: ItemKind,
    source: String,
}

#[derive(Clone, Copy, Debug)]
struct Background {
    mean: f32,
    std: f32,
}

impl Background {
    fn relevance(self, similarity: f32) -> f32 {
        (similarity - self.mean) / self.std
    }
}

/// Normalized vectors stored row-major so a full scan is one linear pass.
#[derive(Default)]
struct VectorIndex {
    dim: usize,
    keys: Vec<Key>,
    data: Vec<f32>,
    pos: HashMap<String, usize>,
}

impl VectorIndex {
    fn upsert(&mut self, key: Key, vector: &[f32]) {
        if self.dim == 0 {
            self.dim = vector.len();
        }
        if vector.len() != self.dim {
            return;
        }
        if let Some(&slot) = self.pos.get(&key.id) {
            self.data[slot * self.dim..(slot + 1) * self.dim].copy_from_slice(vector);
            self.keys[slot] = key;
            return;
        }
        self.pos.insert(key.id.clone(), self.keys.len());
        self.keys.push(key);
        self.data.extend_from_slice(vector);
    }

    fn remove(&mut self, id: &str) {
        let Some(slot) = self.pos.remove(id) else { return };
        let last = self.keys.len() - 1;
        if slot != last {
            let (head, tail) = self.data.split_at_mut(last * self.dim);
            head[slot * self.dim..(slot + 1) * self.dim].copy_from_slice(&tail[..self.dim]);
            self.keys.swap(slot, last);
            self.pos.insert(self.keys[slot].id.clone(), slot);
        }
        self.keys.pop();
        self.data.truncate(last * self.dim);
    }

    fn remove_where(&mut self, predicate: impl Fn(&Key) -> bool) {
        let ids: Vec<String> = self.keys.iter().filter(|key| predicate(key)).map(|key| key.id.clone()).collect();
        for id in ids {
            self.remove(&id);
        }
    }

    /// Top matches plus the similarity distribution over every scanned row.
    fn top(&self, query: &[f32], limit: usize, kind: Option<ItemKind>) -> (Vec<(usize, f32)>, Background) {
        let prior = Background { mean: PRIOR_MEAN, std: PRIOR_STD };
        if self.dim == 0 || query.len() != self.dim {
            return (Vec::new(), prior);
        }
        let mut scored: Vec<(usize, f32)> = self
            .data
            .chunks_exact(self.dim)
            .enumerate()
            .filter(|(slot, _)| kind.map_or(true, |kind| self.keys[*slot].kind == kind))
            .map(|(slot, row)| (slot, row.iter().zip(query).map(|(a, b)| a * b).sum()))
            .collect();
        let n = scored.len() as f32;
        let (sum, sum_sq) = scored.iter().fold((0.0f32, 0.0f32), |(s, q), (_, v)| (s + v, q + v * v));
        let mean = (sum + PRIOR_WEIGHT * PRIOR_MEAN) / (n + PRIOR_WEIGHT);
        let observed_var = if n > 0.0 { (sum_sq / n - (sum / n).powi(2)).max(0.0) } else { 0.0 };
        let var = (n * observed_var + PRIOR_WEIGHT * PRIOR_STD * PRIOR_STD) / (n + PRIOR_WEIGHT);
        let background = Background { mean, std: var.sqrt().max(1e-3) };
        let limit = limit.min(scored.len());
        if limit == 0 {
            return (Vec::new(), background);
        }
        scored.select_nth_unstable_by(limit - 1, |a, b| b.1.total_cmp(&a.1));
        scored.truncate(limit);
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        (scored, background)
    }
}

struct Engine {
    model: OnceLock<Option<TextEmbedder>>,
    index: RwLock<VectorIndex>,
    db: AsyncMutex<Option<SqliteConnection>>,
    loaded: AsyncMutex<bool>,
    backfilling: AtomicBool,
}

fn engine() -> &'static Engine {
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    ENGINE.get_or_init(|| Engine {
        model: OnceLock::new(),
        index: RwLock::new(VectorIndex::default()),
        db: AsyncMutex::new(None),
        loaded: AsyncMutex::new(false),
        backfilling: AtomicBool::new(false),
    })
}

fn model() -> Option<&'static TextEmbedder> {
    engine().model.get().and_then(Option::as_ref)
}

fn model_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("resources").join("recall-model"));
        candidates.push(dir.join("recall-model"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("recall-model"));
    candidates.into_iter().find(|dir| dir.join("model.safetensors").exists())
}

/// Loads the embedding model on a background thread so startup is not delayed.
pub fn start_model_load(app: &AppHandle) {
    let dir = model_dir(app);
    std::thread::spawn(move || {
        let started = Instant::now();
        let loaded = match dir {
            Some(dir) => match TextEmbedder::load(&dir) {
                Ok(model) => {
                    eprintln!("Recall model loaded in {:?}", started.elapsed());
                    Some(model)
                }
                Err(error) => {
                    eprintln!("Recall model unavailable, using keyword recall only: {error}");
                    None
                }
            },
            None => {
                eprintln!("Recall model files not found, using keyword recall only");
                None
            }
        };
        let _ = engine().model.set(loaded);
    });
}

async fn wait_for_model(timeout: Duration) -> Option<&'static TextEmbedder> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(state) = engine().model.get() {
            return state.as_ref();
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn embed_texts(model: &TextEmbedder, texts: &[String], query: bool) -> Result<Vec<Vec<f32>>, String> {
    let mut vectors = Vec::with_capacity(texts.len());
    for batch in texts.chunks(EMBED_BATCH) {
        let clipped: Vec<String> = batch.iter().map(|text| clip(text, 4000).to_string()).collect();
        vectors.extend(model.embed(&clipped, query).map_err(|error| error.to_string())?);
    }
    Ok(vectors)
}

async fn embed_blocking(texts: Vec<String>, query: bool) -> Result<Option<Vec<Vec<f32>>>, String> {
    let Some(model) = model() else { return Ok(None) };
    tokio::task::spawn_blocking(move || embed_texts(model, &texts, query))
        .await
        .map_err(|error| error.to_string())?
        .map(Some)
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn from_blob(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4).map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])).collect()
}

fn clip(text: &str, max_chars: usize) -> &str {
    text.char_indices().nth(max_chars).map_or(text, |(index, _)| &text[..index])
}

fn words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric()).filter(|token| !token.is_empty()).map(str::to_lowercase)
}

fn query_terms(text: &str, max_terms: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut terms = Vec::new();
    for token in words(text).filter(|token| token.chars().count() >= 2 && !STOPWORDS.contains(&token.as_str())) {
        if seen.insert(token.clone()) {
            terms.push(token);
            if terms.len() >= max_terms {
                break;
            }
        }
    }
    terms
}

fn fts_query(terms: &[String]) -> Option<String> {
    (!terms.is_empty()).then(|| terms.iter().map(|term| format!("\"{term}\"*")).collect::<Vec<_>>().join(" OR "))
}

/// True when two memories say the same thing, not merely something similar.
fn is_same_memory(a: &str, b: &str, similarity: f32) -> bool {
    if similarity < DEDUPE_MIN_SIMILARITY {
        return false;
    }
    let numbers = |text: &str| -> Vec<String> {
        let mut found: Vec<String> = words(text).filter(|word| word.chars().any(|c| c.is_ascii_digit())).collect();
        found.sort();
        found
    };
    if numbers(a) != numbers(b) {
        return false;
    }
    let set_a: HashSet<String> = words(a).collect();
    let set_b: HashSet<String> = words(b).collect();
    let union = set_a.union(&set_b).count().max(1) as f32;
    let overlap = set_a.intersection(&set_b).count() as f32 / union;
    overlap >= DEDUPE_MIN_WORD_OVERLAP || similarity >= DEDUPE_SURE_SIMILARITY
}

/// Picks the excerpt window that mentions the most query terms.
fn best_excerpt(content: &str, terms: &[String], max_chars: usize) -> String {
    if content.chars().count() <= max_chars {
        return content.to_string();
    }
    let mut starts = vec![0usize];
    for (index, c) in content.char_indices() {
        if c == '\n' || (c == ' ' && content[..index].ends_with('.')) {
            starts.push(index + c.len_utf8());
        }
    }
    let mut best = (0usize, 0usize);
    for &start in &starts {
        let window = clip(&content[start..], max_chars);
        let window_lower = window.to_lowercase();
        let hits = terms.iter().filter(|term| window_lower.contains(term.as_str())).count();
        if hits > best.1 {
            best = (start, hits);
        }
        if window.len() < max_chars / 2 {
            break;
        }
    }
    let excerpt = clip(&content[best.0..], max_chars).trim();
    let head = if best.0 == 0 { "" } else { "… " };
    let tail = if best.0 + excerpt.len() < content.len() { " …" } else { "" };
    format!("{head}{excerpt}{tail}")
}

async fn connection<'a>(
    app: &AppHandle,
    guard: &'a mut tokio::sync::MutexGuard<'_, Option<SqliteConnection>>,
) -> Result<&'a mut SqliteConnection, String> {
    if guard.is_none() {
        let path = app.path().app_config_dir().map_err(|error| error.to_string())?.join("veil.db");
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(false)
            .busy_timeout(Duration::from_secs(5));
        **guard = Some(SqliteConnection::connect_with(&options).await.map_err(|error| error.to_string())?);
    }
    Ok(guard.as_mut().expect("connection opened above"))
}

fn sql_err(error: sqlx::Error) -> String {
    error.to_string()
}

fn index_write() -> Result<std::sync::RwLockWriteGuard<'static, VectorIndex>, String> {
    engine().index.write().map_err(|_| "Recall index poisoned".to_string())
}

fn index_read() -> Result<std::sync::RwLockReadGuard<'static, VectorIndex>, String> {
    engine().index.read().map_err(|_| "Recall index poisoned".to_string())
}

/// Loads stored vectors once and drops vectors whose item no longer exists.
async fn ensure_loaded(app: &AppHandle) -> Result<(), String> {
    let mut loaded = engine().loaded.lock().await;
    if *loaded {
        return Ok(());
    }
    let mut guard = engine().db.lock().await;
    let conn = connection(app, &mut guard).await?;
    sqlx::query("DELETE FROM recall_vectors WHERE model != ? OR (item_kind = 'chunk' AND item_id NOT IN (SELECT id FROM knowledge_chunks)) OR (item_kind = 'memory' AND item_id NOT IN (SELECT id FROM memory_items))")
        .bind(MODEL_ID).execute(&mut *conn).await.map_err(sql_err)?;
    let rows = sqlx::query("SELECT item_id, item_kind, source_id, vec FROM recall_vectors")
        .fetch_all(&mut *conn).await.map_err(sql_err)?;
    let mut index = index_write()?;
    for row in rows {
        let Some(kind) = ItemKind::parse(row.get::<String, _>("item_kind").as_str()) else { continue };
        let key = Key { id: row.get("item_id"), kind, source: row.get("source_id") };
        index.upsert(key, &from_blob(&row.get::<Vec<u8>, _>("vec")));
    }
    *loaded = true;
    Ok(())
}

/// Embeds library chunks and memories that have no vector yet, in small
/// batches, without holding the database or index locks while computing.
fn spawn_backfill(app: AppHandle) {
    if model().is_none() || engine().backfilling.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let mut total = 0usize;
        let result: Result<(), String> = async {
            loop {
                let pending: Vec<(Key, String)> = {
                    let mut guard = engine().db.lock().await;
                    let conn = connection(&app, &mut guard).await?;
                    let chunks = sqlx::query("SELECT c.id, c.source_id, c.content, s.title FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id WHERE c.id NOT IN (SELECT item_id FROM recall_vectors) LIMIT 32")
                        .fetch_all(&mut *conn).await.map_err(sql_err)?;
                    let memories = sqlx::query("SELECT id, text FROM memory_items WHERE id NOT IN (SELECT item_id FROM recall_vectors) LIMIT 32")
                        .fetch_all(&mut *conn).await.map_err(sql_err)?;
                    chunks.into_iter().map(|row| {
                        let text = format!("{}\n{}", row.get::<String, _>("title"), row.get::<String, _>("content"));
                        (Key { id: row.get("id"), kind: ItemKind::Chunk, source: row.get("source_id") }, text)
                    }).chain(memories.into_iter().map(|row| {
                        (Key { id: row.get("id"), kind: ItemKind::Memory, source: String::new() }, row.get("text"))
                    })).collect()
                };
                if pending.is_empty() {
                    return Ok(());
                }
                let (keys, texts): (Vec<Key>, Vec<String>) = pending.into_iter().unzip();
                total += keys.len();
                let Some(vectors) = embed_blocking(texts, false).await? else { return Ok(()) };
                {
                    let mut guard = engine().db.lock().await;
                    let conn = connection(&app, &mut guard).await?;
                    let mut tx = conn.begin().await.map_err(sql_err)?;
                    for (key, vector) in keys.iter().zip(&vectors) {
                        sqlx::query("INSERT OR REPLACE INTO recall_vectors (item_id, item_kind, source_id, model, vec) VALUES (?, ?, ?, ?, ?)")
                            .bind(&key.id).bind(key.kind.as_str()).bind(&key.source).bind(MODEL_ID).bind(to_blob(vector))
                            .execute(&mut *tx).await.map_err(sql_err)?;
                    }
                    tx.commit().await.map_err(sql_err)?;
                }
                let mut index = index_write()?;
                for (key, vector) in keys.into_iter().zip(vectors) {
                    index.upsert(key, &vector);
                }
            }
        }
        .await;
        match result {
            Ok(()) if total > 0 => eprintln!("Recall indexed {total} items in {:?}", started.elapsed()),
            Ok(()) => {}
            Err(error) => eprintln!("Recall indexing paused: {error}"),
        }
        engine().backfilling.store(false, Ordering::SeqCst);
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallStatus {
    model_ready: bool,
    model_loading: bool,
    indexing: bool,
    items: usize,
}

#[tauri::command]
pub async fn recall_warmup(app: AppHandle) -> Result<RecallStatus, String> {
    ensure_loaded(&app).await?;
    if wait_for_model(Duration::from_secs(20)).await.is_some() {
        spawn_backfill(app);
    }
    recall_status().await
}

#[tauri::command]
pub async fn recall_status() -> Result<RecallStatus, String> {
    Ok(RecallStatus {
        model_ready: model().is_some(),
        model_loading: engine().model.get().is_none(),
        indexing: engine().backfilling.load(Ordering::SeqCst),
        items: index_read()?.keys.len(),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecallHit {
    id: String,
    kind: &'static str,
    source_id: String,
    title: String,
    text: String,
    layer: Option<String>,
    memory_kind: Option<String>,
    origin: Option<String>,
    tags: String,
    updated_at: i64,
    pinned: bool,
    score: f32,
    similarity: Option<f32>,
    /// Standard deviations above the similarity of everything else indexed.
    relevance: Option<f32>,
    lexical: bool,
}

#[derive(Default)]
struct Candidate {
    kind: Option<ItemKind>,
    semantic_rank: Option<usize>,
    similarity: Option<f32>,
    relevance: Option<f32>,
    lexical_rank: Option<usize>,
}

fn fuse(candidates: &HashMap<String, Candidate>, min_relevance: f32) -> Vec<(String, ItemKind, f32)> {
    let mut fused: Vec<(String, ItemKind, f32)> = candidates
        .iter()
        .filter_map(|(id, candidate)| {
            let kind = candidate.kind?;
            if candidate.lexical_rank.is_none() && candidate.relevance.unwrap_or(f32::MIN) < min_relevance {
                return None;
            }
            // Meaning only counts toward the rank once it stands out from the background.
            let semantic = candidate
                .semantic_rank
                .filter(|_| candidate.relevance.unwrap_or(f32::MIN) >= 1.0)
                .map_or(0.0, |rank| 1.0 / (RRF_K + rank as f32));
            let lexical = candidate.lexical_rank.map_or(0.0, |rank| 1.0 / (RRF_K + rank as f32));
            Some((id.clone(), kind, semantic + lexical))
        })
        .collect();
    fused.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    fused
}

#[tauri::command]
pub async fn recall_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
    min_relevance: Option<f32>,
) -> Result<Vec<RecallHit>, String> {
    let limit = limit.unwrap_or(8).clamp(1, 20);
    let query = clip(query.trim(), 2000).to_string();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let terms = query_terms(&query, 8);
    ensure_loaded(&app).await?;

    let mut candidates: HashMap<String, Candidate> = HashMap::new();
    if let Some(mut vectors) = embed_blocking(vec![query.clone()], true).await? {
        let vector = vectors.remove(0);
        let index = index_read()?;
        let (top, background) = index.top(&vector, CANDIDATES, None);
        for (rank, (slot, similarity)) in top.into_iter().enumerate() {
            let key = &index.keys[slot];
            let entry = candidates.entry(key.id.clone()).or_default();
            entry.kind = Some(key.kind);
            entry.semantic_rank = Some(rank);
            entry.similarity = Some(similarity);
            entry.relevance = Some(background.relevance(similarity));
        }
    }

    let mut guard = engine().db.lock().await;
    let conn = connection(&app, &mut guard).await?;
    if let Some(matcher) = fts_query(&terms) {
        let chunk_rows = sqlx::query("SELECT c.id FROM knowledge_chunks_fts JOIN knowledge_chunks c ON c.rowid = knowledge_chunks_fts.rowid JOIN knowledge_sources s ON s.id = c.source_id WHERE knowledge_chunks_fts MATCH ? AND s.enabled = 1 ORDER BY bm25(knowledge_chunks_fts) LIMIT ?")
            .bind(&matcher).bind(CANDIDATES as i64).fetch_all(&mut *conn).await.map_err(sql_err)?;
        let memory_rows = sqlx::query("SELECT m.id FROM memory_items_fts JOIN memory_items m ON m.rowid = memory_items_fts.rowid WHERE memory_items_fts MATCH ? AND m.enabled = 1 ORDER BY bm25(memory_items_fts) LIMIT ?")
            .bind(&matcher).bind(CANDIDATES as i64).fetch_all(&mut *conn).await.map_err(sql_err)?;
        // Interleave by rank so neither table dominates the keyword list.
        let mut lexical: Vec<(String, ItemKind, usize)> = chunk_rows.into_iter().enumerate()
            .map(|(rank, row)| (row.get("id"), ItemKind::Chunk, rank))
            .chain(memory_rows.into_iter().enumerate().map(|(rank, row)| (row.get("id"), ItemKind::Memory, rank)))
            .collect();
        lexical.sort_by_key(|(_, _, rank)| *rank);
        for (rank, (id, kind, _)) in lexical.into_iter().enumerate() {
            let entry = candidates.entry(id).or_default();
            entry.kind = Some(kind);
            entry.lexical_rank = Some(rank);
        }
    }

    let fused = fuse(&candidates, min_relevance.unwrap_or(SEMANTIC_ONLY_MIN_RELEVANCE));
    let mut hits = Vec::new();
    for (id, kind, score) in fused {
        if hits.len() >= limit {
            break;
        }
        let candidate = &candidates[&id];
        let hit = match kind {
            ItemKind::Chunk => sqlx::query("SELECT c.id, c.source_id, c.content, s.title, s.tags, s.updated_at, s.pinned FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id WHERE c.id = ? AND s.enabled = 1")
                .bind(&id).fetch_optional(&mut *conn).await.map_err(sql_err)?
                .map(|row| RecallHit {
                    id: row.get("id"),
                    kind: "chunk",
                    source_id: row.get("source_id"),
                    title: row.get("title"),
                    text: best_excerpt(&row.get::<String, _>("content"), &terms, EXCERPT_CHARS),
                    layer: None,
                    memory_kind: None,
                    origin: None,
                    tags: row.get("tags"),
                    updated_at: row.get("updated_at"),
                    pinned: row.get::<i64, _>("pinned") == 1,
                    score,
                    similarity: candidate.similarity,
                    relevance: candidate.relevance,
                    lexical: candidate.lexical_rank.is_some(),
                }),
            ItemKind::Memory => sqlx::query("SELECT id, layer, kind, text, origin, updated_at FROM memory_items WHERE id = ? AND enabled = 1")
                .bind(&id).fetch_optional(&mut *conn).await.map_err(sql_err)?
                .map(|row| RecallHit {
                    id: row.get("id"),
                    kind: "memory",
                    source_id: String::new(),
                    title: String::new(),
                    text: row.get("text"),
                    layer: Some(row.get("layer")),
                    memory_kind: Some(row.get("kind")),
                    origin: Some(row.get("origin")),
                    tags: "[]".into(),
                    updated_at: row.get("updated_at"),
                    pinned: false,
                    score,
                    similarity: candidate.similarity,
                    relevance: candidate.relevance,
                    lexical: candidate.lexical_rank.is_some(),
                }),
        };
        hits.extend(hit);
    }
    Ok(hits)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInput {
    id: Option<String>,
    layer: String,
    kind: String,
    text: String,
    origin: Option<String>,
    session_id: Option<String>,
    enabled: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySaved {
    id: String,
    merged: bool,
}

fn validate_memory(input: &MemoryInput) -> Result<(), String> {
    if !matches!(input.layer.as_str(), "core" | "shared" | "call") {
        return Err(format!("Unknown memory layer: {}", input.layer));
    }
    if !matches!(input.kind.as_str(), "fact" | "preference" | "episode" | "qa" | "followup" | "note") {
        return Err(format!("Unknown memory kind: {}", input.kind));
    }
    if input.text.trim().is_empty() {
        return Err("Memory text is empty".into());
    }
    Ok(())
}

fn layer_rank(layer: &str) -> u8 {
    match layer {
        "core" => 2,
        "shared" => 1,
        _ => 0,
    }
}

/// Inserts or updates memories. With `dedupe`, a new memory that says the same
/// thing as an existing one refreshes it instead of adding a duplicate.
#[tauri::command]
pub async fn memory_save(app: AppHandle, items: Vec<MemoryInput>, dedupe: bool) -> Result<Vec<MemorySaved>, String> {
    for item in &items {
        validate_memory(item)?;
    }
    ensure_loaded(&app).await?;
    let texts: Vec<String> = items.iter().map(|item| clip(item.text.trim(), MAX_MEMORY_CHARS).to_string()).collect();
    let vectors: Vec<Option<Vec<f32>>> = match embed_blocking(texts.clone(), false).await? {
        Some(vectors) => vectors.into_iter().map(Some).collect(),
        None => vec![None; items.len()],
    };

    let now = now_ms();
    let mut guard = engine().db.lock().await;
    let conn = connection(&app, &mut guard).await?;
    let mut tx = conn.begin().await.map_err(sql_err)?;
    let mut saved = Vec::new();
    let mut written: Vec<(Key, Vec<f32>, String)> = Vec::new();
    for ((item, text), vector) in items.iter().zip(&texts).zip(&vectors) {
        let mut target = item.id.clone();
        let mut merged = false;
        if target.is_none() && dedupe {
            if let Some(vector) = vector {
                let in_batch = written.iter()
                    .find(|(_, other, other_text)| is_same_memory(text, other_text, dot(vector, other)))
                    .map(|(key, _, _)| key.id.clone());
                let nearest = match in_batch {
                    Some(id) => Some(id),
                    None => {
                        let candidate = {
                            let index = index_read()?;
                            let (top, _) = index.top(vector, 1, Some(ItemKind::Memory));
                            top.first().map(|(slot, similarity)| (index.keys[*slot].id.clone(), *similarity))
                        };
                        match candidate {
                            Some((id, similarity)) if similarity >= DEDUPE_MIN_SIMILARITY => {
                                let existing: Option<String> = sqlx::query_scalar("SELECT text FROM memory_items WHERE id = ?")
                                    .bind(&id).fetch_optional(&mut *tx).await.map_err(sql_err)?;
                                existing.filter(|existing| is_same_memory(text, existing, similarity)).map(|_| id)
                            }
                            _ => None,
                        }
                    }
                };
                if let Some(id) = nearest {
                    target = Some(id);
                    merged = true;
                }
            }
        }

        let id = match target {
            Some(id) => {
                let current_layer: Option<String> = sqlx::query_scalar("SELECT layer FROM memory_items WHERE id = ?")
                    .bind(&id).fetch_optional(&mut *tx).await.map_err(sql_err)?;
                let Some(current_layer) = current_layer else { return Err("Memory no longer exists".into()) };
                // Merging never demotes a memory the user promoted to core.
                let layer = if merged && layer_rank(&current_layer) > layer_rank(&item.layer) { current_layer } else { item.layer.clone() };
                sqlx::query("UPDATE memory_items SET layer = ?, kind = ?, text = ?, enabled = COALESCE(?, enabled), updated_at = ? WHERE id = ?")
                    .bind(&layer).bind(&item.kind).bind(text).bind(item.enabled.map(i64::from)).bind(now).bind(&id)
                    .execute(&mut *tx).await.map_err(sql_err)?;
                id
            }
            None => {
                let id = format!("mem_{}", uuid::Uuid::new_v4().simple());
                sqlx::query("INSERT INTO memory_items (id, layer, kind, text, origin, session_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(&id).bind(&item.layer).bind(&item.kind).bind(text)
                    .bind(item.origin.clone().unwrap_or_default()).bind(&item.session_id)
                    .bind(i64::from(item.enabled.unwrap_or(true))).bind(now).bind(now)
                    .execute(&mut *tx).await.map_err(sql_err)?;
                id
            }
        };
        if let Some(vector) = vector {
            sqlx::query("INSERT OR REPLACE INTO recall_vectors (item_id, item_kind, source_id, model, vec) VALUES (?, 'memory', '', ?, ?)")
                .bind(&id).bind(MODEL_ID).bind(to_blob(vector))
                .execute(&mut *tx).await.map_err(sql_err)?;
            written.push((Key { id: id.clone(), kind: ItemKind::Memory, source: String::new() }, vector.clone(), text.clone()));
        }
        saved.push(MemorySaved { id, merged });
    }
    tx.commit().await.map_err(sql_err)?;
    let mut index = index_write()?;
    for (key, vector, _) in written {
        index.upsert(key, &vector);
    }
    Ok(saved)
}

#[tauri::command]
pub async fn memory_delete(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut guard = engine().db.lock().await;
    let conn = connection(&app, &mut guard).await?;
    let mut tx = conn.begin().await.map_err(sql_err)?;
    for id in &ids {
        sqlx::query("DELETE FROM memory_items WHERE id = ?").bind(id).execute(&mut *tx).await.map_err(sql_err)?;
        sqlx::query("DELETE FROM recall_vectors WHERE item_id = ?").bind(id).execute(&mut *tx).await.map_err(sql_err)?;
    }
    tx.commit().await.map_err(sql_err)?;
    let mut index = index_write()?;
    for id in &ids {
        index.remove(id);
    }
    Ok(())
}

/// Drops a library source's old vectors and indexes its new chunks in the background.
pub async fn reindex_source(app: &AppHandle, source_id: &str) -> Result<(), String> {
    forget_source(app, source_id).await?;
    spawn_backfill(app.clone());
    Ok(())
}

pub async fn forget_source(app: &AppHandle, source_id: &str) -> Result<(), String> {
    {
        let mut guard = engine().db.lock().await;
        let conn = connection(app, &mut guard).await?;
        sqlx::query("DELETE FROM recall_vectors WHERE item_kind = 'chunk' AND source_id = ?")
            .bind(source_id).execute(&mut *conn).await.map_err(sql_err)?;
    }
    index_write()?.remove_where(|key| key.kind == ItemKind::Chunk && key.source == source_id);
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(id: &str, kind: ItemKind, source: &str) -> Key {
        Key { id: id.into(), kind, source: source.into() }
    }

    #[test]
    fn index_upsert_remove_keeps_slots_consistent() {
        let mut index = VectorIndex::default();
        index.upsert(key("a", ItemKind::Chunk, "s1"), &[1.0, 0.0]);
        index.upsert(key("b", ItemKind::Memory, ""), &[0.0, 1.0]);
        index.upsert(key("c", ItemKind::Chunk, "s1"), &[0.6, 0.8]);
        index.remove("a");
        assert_eq!(index.keys.len(), 2);
        assert_eq!(index.top(&[0.6, 0.8], 1, None).0[0].0, index.pos["c"]);
        index.remove_where(|key| key.source == "s1");
        assert_eq!(index.keys.iter().map(|key| key.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert_eq!(index.top(&[1.0, 0.0], 5, Some(ItemKind::Chunk)).0.len(), 0);
    }

    #[test]
    fn small_libraries_use_the_calibrated_prior() {
        let mut index = VectorIndex::default();
        index.upsert(key("a", ItemKind::Chunk, ""), &[1.0, 0.0]);
        let (_, background) = index.top(&[1.0, 0.0], 1, None);
        assert!((background.mean - PRIOR_MEAN).abs() < 0.02, "{background:?}");
        assert!(background.relevance(0.58) > 2.0);
        assert!(background.relevance(0.50) < 1.5);
    }

    #[test]
    fn semantic_only_hits_must_stand_out() {
        let candidate = |semantic_rank, relevance, lexical_rank| Candidate {
            kind: Some(ItemKind::Chunk), semantic_rank, similarity: Some(0.5), relevance, lexical_rank,
        };
        let mut candidates = HashMap::new();
        candidates.insert("weak".to_string(), candidate(Some(0), Some(1.2), None));
        candidates.insert("strong".to_string(), candidate(Some(1), Some(3.1), None));
        candidates.insert("keyword".to_string(), candidate(Some(2), Some(0.2), Some(0)));
        let ids: Vec<String> = fuse(&candidates, 2.0).into_iter().map(|(id, _, _)| id).collect();
        assert_eq!(ids, vec!["keyword", "strong"]);
    }

    #[test]
    fn dedupe_keeps_facts_with_different_numbers_or_wording() {
        assert!(is_same_memory("My advisor is Prof. Rao.", "Prof. Rao is my advisor.", 0.986));
        assert!(!is_same_memory("I presented at ACL 2025.", "I will present at ACL 2026.", 0.970));
        assert!(!is_same_memory("My advisor is Prof. Rao.", "My co-author is Prof. Rao.", 0.954));
        assert!(!is_same_memory("Thesis on speech recognition", "Thesis on machine translation", 0.975));
    }

    #[test]
    fn query_terms_skip_stopwords_and_duplicates() {
        assert_eq!(query_terms("What is the p-value of the p-value test?", 8), vec!["value", "test"]);
        assert_eq!(fts_query(&query_terms("how did you", 8)), None);
    }

    #[test]
    fn excerpt_prefers_window_with_query_terms() {
        let content = format!("{} The effect size was 0.42 in the replication study. {}", "Intro text. ".repeat(80), "Tail. ".repeat(80));
        let excerpt = best_excerpt(&content, &["replication".into(), "effect".into()], 200);
        assert!(excerpt.contains("replication"), "{excerpt}");
        assert!(excerpt.chars().count() <= 210);
    }
}
