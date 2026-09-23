//! Commits a complete knowledge source and its FTS-backed chunks together.
//! Embeddings are prepared before this command; a failed request never changes
//! the prior visible source or index.
use std::{path::PathBuf, time::Duration};

use serde::Deserialize;
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeIndexChunk {
    id: String,
    content: String,
    embedding: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeIndexInput {
    source_id: String,
    replace: bool,
    title: String,
    kind: String,
    tags: Vec<String>,
    raw_text: String,
    updated_at: i64,
    chunks: Vec<KnowledgeIndexChunk>,
}

impl KnowledgeIndexInput {
    fn validate(&self) -> Result<(), String> {
        if self.source_id.trim().is_empty()
            || self.title.trim().is_empty()
            || self.raw_text.trim().is_empty()
        {
            return Err("Knowledge source needs an ID, title, and text".into());
        }
        if !matches!(self.kind.as_str(), "file" | "note") || self.chunks.is_empty() {
            return Err("Invalid knowledge source kind or empty index".into());
        }
        if self.chunks.iter().any(|chunk| {
            chunk.id.trim().is_empty()
                || chunk.content.trim().is_empty()
                || chunk.embedding.iter().any(|number| !number.is_finite())
        }) {
            return Err("Invalid knowledge index chunk".into());
        }
        Ok(())
    }
}

async fn open_database(path: PathBuf) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())
}

async fn commit_on_connection(
    connection: &mut SqliteConnection,
    input: KnowledgeIndexInput,
) -> Result<(), String> {
    input.validate()?;
    let tags = serde_json::to_string(&input.tags).map_err(|error| error.to_string())?;
    let mut tx = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;

    if input.replace {
        let result = sqlx::query(
            "UPDATE knowledge_sources SET title = ?, kind = ?, tags = ?, raw_text = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&input.title).bind(&input.kind).bind(&tags).bind(&input.raw_text)
        .bind(input.updated_at).bind(&input.source_id)
        .execute(&mut *tx).await.map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err("Knowledge source to replace no longer exists".into());
        }
        sqlx::query("DELETE FROM knowledge_chunks WHERE source_id = ?")
            .bind(&input.source_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
    } else {
        sqlx::query("INSERT INTO knowledge_sources (id, title, kind, tags, raw_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&input.source_id).bind(&input.title).bind(&input.kind).bind(&tags)
            .bind(&input.raw_text).bind(input.updated_at).bind(input.updated_at)
            .execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }

    for (index, chunk) in input.chunks.into_iter().enumerate() {
        let embedding =
            serde_json::to_string(&chunk.embedding).map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO knowledge_chunks (id, source_id, chunk_index, content, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&chunk.id).bind(&input.source_id).bind(index as i64)
            .bind(&chunk.content).bind(embedding).bind(input.updated_at)
            .execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }
    tx.commit().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn commit_knowledge_index(
    app: AppHandle,
    input: KnowledgeIndexInput,
) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let mut connection = open_database(config_dir.join("veil.db")).await?;
    commit_on_connection(&mut connection, input).await
}

async fn delete_on_connection(
    connection: &mut SqliteConnection,
    source_id: &str,
) -> Result<(), String> {
    if source_id.trim().is_empty() {
        return Err("Knowledge source ID required".into());
    }
    let mut tx = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM knowledge_chunks WHERE source_id = ?")
        .bind(&source_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM knowledge_sources WHERE id = ?")
        .bind(&source_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_knowledge_index(app: AppHandle, source_id: String) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let mut connection = open_database(config_dir.join("veil.db")).await?;
    delete_on_connection(&mut connection, &source_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    async fn setup() -> SqliteConnection {
        let mut connection = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(include_str!("db/migrations/knowledge.sql"))
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("db/migrations/call-sessions.sql"))
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("db/migrations/local-search.sql"))
            .execute(&mut connection)
            .await
            .unwrap();
        connection
    }

    fn source(replace: bool, text: &str, chunk_ids: &[&str]) -> KnowledgeIndexInput {
        KnowledgeIndexInput {
            source_id: "source-1".into(),
            replace,
            title: text.into(),
            kind: "note".into(),
            tags: vec!["profile".into()],
            raw_text: text.into(),
            updated_at: 42,
            chunks: chunk_ids
                .iter()
                .map(|id| KnowledgeIndexChunk {
                    id: (*id).into(),
                    content: text.into(),
                    embedding: vec![0.1, 0.2],
                })
                .collect(),
        }
    }

    async fn count_match(connection: &mut SqliteConnection, term: &str) -> i64 {
        sqlx::query(
            "SELECT count(*) AS n FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH ?",
        )
        .bind(term)
        .fetch_one(connection)
        .await
        .unwrap()
        .get("n")
    }

    #[tokio::test]
    async fn replacement_is_atomic_even_when_later_chunk_insert_fails() {
        let mut connection = setup().await;
        commit_on_connection(
            &mut connection,
            source(false, "calibration", &["chunk-old"]),
        )
        .await
        .unwrap();
        assert_eq!(count_match(&mut connection, "calibration").await, 1);

        // Duplicate IDs fail after the source update, old chunk deletion, and first insert.
        let error = commit_on_connection(
            &mut connection,
            source(true, "revision", &["duplicate", "duplicate"]),
        )
        .await;
        assert!(error.is_err());
        let old: String =
            sqlx::query("SELECT raw_text FROM knowledge_sources WHERE id = 'source-1'")
                .fetch_one(&mut connection)
                .await
                .unwrap()
                .get("raw_text");
        assert_eq!(old, "calibration");
        assert_eq!(count_match(&mut connection, "calibration").await, 1);
        assert_eq!(count_match(&mut connection, "revision").await, 0);

        commit_on_connection(&mut connection, source(true, "revision", &["chunk-new"]))
            .await
            .unwrap();
        assert_eq!(count_match(&mut connection, "calibration").await, 0);
        assert_eq!(count_match(&mut connection, "revision").await, 1);
    }

    #[tokio::test]
    async fn lexical_only_source_is_searchable_and_delete_removes_fts_hits() {
        let mut connection = setup().await;
        let mut input = source(false, "searchable", &["local-only"]);
        input.chunks[0].embedding.clear();
        commit_on_connection(&mut connection, input).await.unwrap();
        let vector: String =
            sqlx::query("SELECT embedding FROM knowledge_chunks WHERE id = 'local-only'")
                .fetch_one(&mut connection)
                .await
                .unwrap()
                .get("embedding");
        assert_eq!(vector, "[]");
        assert_eq!(count_match(&mut connection, "searchable").await, 1);
        delete_on_connection(&mut connection, "source-1")
            .await
            .unwrap();
        assert_eq!(count_match(&mut connection, "searchable").await, 0);
    }

    #[tokio::test]
    async fn failed_creation_and_missing_replacement_leave_no_partial_source() {
        let mut connection = setup().await;
        assert!(
            commit_on_connection(&mut connection, source(false, "draft", &["dup", "dup"]))
                .await
                .is_err()
        );
        let count: i64 = sqlx::query("SELECT count(*) AS n FROM knowledge_sources")
            .fetch_one(&mut connection)
            .await
            .unwrap()
            .get("n");
        assert_eq!(count, 0);
        assert_eq!(count_match(&mut connection, "draft").await, 0);
        assert!(
            commit_on_connection(&mut connection, source(true, "revision", &["new"]))
                .await
                .is_err()
        );
        assert_eq!(count_match(&mut connection, "revision").await, 0);
    }
}
