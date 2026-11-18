-- Layered memory: core facts are always supplied, shared and call memories are
-- recalled by relevance. Vectors for memories and library chunks live in one
-- table so the native recall index can load them in a single pass.
CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY NOT NULL,
    layer TEXT NOT NULL CHECK(layer IN ('core', 'shared', 'call')),
    kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'episode', 'qa', 'followup', 'note')),
    text TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT '',
    session_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_items_layer ON memory_items(layer, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_items_session ON memory_items(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
    text, content='memory_items', content_rowid='rowid', tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memory_items_fts_insert AFTER INSERT ON memory_items BEGIN
    INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_items_fts_delete AFTER DELETE ON memory_items BEGIN
    INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_items_fts_update AFTER UPDATE OF text ON memory_items BEGIN
    INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE IF NOT EXISTS recall_vectors (
    item_id TEXT PRIMARY KEY NOT NULL,
    item_kind TEXT NOT NULL CHECK(item_kind IN ('chunk', 'memory')),
    source_id TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    vec BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recall_vectors_source ON recall_vectors(item_kind, source_id);
