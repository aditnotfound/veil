import { safeLocalStorage } from "@/lib/storage/helper";
import { STORAGE_KEYS } from "@/config";
import { embedTexts, cosineSimilarity } from "./embed";
import { getAllChunksWithMeta } from "./store";
import type { KnowledgeSettings } from "./types";
import { getDatabase } from "@/lib/database/config";
import { buildFtsQuery } from "@/lib/call/local-search";
import { formatKnowledgeExcerpts, LOCAL_KNOWLEDGE_SQL, PINNED_KNOWLEDGE_SQL, selectKnowledgeExcerpts, type KnowledgeExcerpt } from "./preparation";

const DEFAULT_TOP_K = 7;

/** Local, network-free first pass for live calls and non-OpenAI answer providers. */
export async function retrievePersonalContextLocal(params: {
  query: string;
  topK?: number;
  onlyWithoutEmbeddings?: boolean;
  includePinned?: boolean;
}): Promise<string> {
  const settings = getKnowledgeSettings();
  if (!settings.enabled) return "";
  const match = buildFtsQuery(params.query);
  const db = await getDatabase();
  const [rows, pinned] = await Promise.all([
    match ? db.select<KnowledgeExcerpt[]>(params.onlyWithoutEmbeddings
      ? LOCAL_KNOWLEDGE_SQL.replace("AND s.enabled = 1", "AND s.enabled = 1 AND c.embedding = '[]'")
      : LOCAL_KNOWLEDGE_SQL, [match]) : Promise.resolve([]),
    params.includePinned === false ? Promise.resolve([]) : db.select<KnowledgeExcerpt[]>(PINNED_KNOWLEDGE_SQL),
  ]);
  return formatKnowledgeExcerpts(selectKnowledgeExcerpts(pinned, rows, settings.focusTags, params.topK ?? DEFAULT_TOP_K));
}

export function getKnowledgeSettings(): KnowledgeSettings {
  const enabled =
    safeLocalStorage.getItem(STORAGE_KEYS.KNOWLEDGE_ENABLED) !== "false";
  let focusTags: string[] = [];
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEYS.KNOWLEDGE_FOCUS_TAGS);
    if (raw) focusTags = JSON.parse(raw);
  } catch {
    focusTags = [];
  }
  return { enabled, focusTags: Array.isArray(focusTags) ? focusTags.filter((tag) => typeof tag === "string") : [] };
}

export function setKnowledgeEnabled(enabled: boolean) {
  safeLocalStorage.setItem(STORAGE_KEYS.KNOWLEDGE_ENABLED, String(enabled));
  window.dispatchEvent(new Event("knowledge-changed"));
}

export function setKnowledgeFocusTags(tags: string[]) {
  safeLocalStorage.setItem(
    STORAGE_KEYS.KNOWLEDGE_FOCUS_TAGS,
    JSON.stringify(tags)
  );
  window.dispatchEvent(new Event("knowledge-changed"));
}

export async function retrievePersonalContext(params: {
  query: string;
  apiKey?: string;
  topK?: number;
}): Promise<string> {
  const settings = getKnowledgeSettings();
  if (!settings.enabled) return "";

  const query = params.query?.trim();
  if (!query) return "";
  const apiKey = params.apiKey?.trim();
  if (!apiKey) return retrievePersonalContextLocal({ query, topK: params.topK });

  const chunks = await getAllChunksWithMeta();
  if (chunks.length === 0) return "";
  // Lexical-only sources remain available to Ask even when older sources use embeddings.
  if (chunks.every((chunk) => chunk.embedding.length === 0)) {
    return retrievePersonalContextLocal({ query, topK: params.topK });
  }
  const topK = Number.isFinite(params.topK) ? Math.max(1, Math.min(7, Math.floor(params.topK!))) : DEFAULT_TOP_K;
  const db = await getDatabase();
  const match = buildFtsQuery(query);
  const [pins, localOnly] = await Promise.all([
    db.select<KnowledgeExcerpt[]>(PINNED_KNOWLEDGE_SQL),
    match ? db.select<KnowledgeExcerpt[]>(LOCAL_KNOWLEDGE_SQL.replace("AND s.enabled = 1", "AND s.enabled = 1 AND c.embedding = '[]'"), [match]) : Promise.resolve([]),
  ]);
  const pool = chunks.filter((chunk) => chunk.embedding.length > 0);
  let queryEmbedding: number[];
  try { [queryEmbedding] = await embedTexts(apiKey, [query], 2500); }
  catch {
    return `${await retrievePersonalContextLocal({ query, topK })}\n\nSemantic search was unavailable; only local keyword matches and pinned references were checked.`;
  }

  const scored = pool
    .map((c) => ({
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .filter((c) => c.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (scored.length === 0) return retrievePersonalContextLocal({ query, topK });
  const selected = selectKnowledgeExcerpts(pins, [
    ...localOnly.slice(0, 2), ...scored.map((chunk) => ({ ...chunk, tags: JSON.stringify(chunk.tags) })),
  ], settings.focusTags, topK);
  return formatKnowledgeExcerpts(selected);
}
