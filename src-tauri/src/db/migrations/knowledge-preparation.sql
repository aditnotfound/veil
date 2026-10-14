ALTER TABLE knowledge_sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1));
ALTER TABLE knowledge_sources ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1));

CREATE TABLE knowledge_preparation (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    preparation_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE call_session_context (
    session_id TEXT PRIMARY KEY REFERENCES call_sessions(id) ON DELETE CASCADE,
    context_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Also clean up when a SQLite connection has foreign keys disabled.
CREATE TRIGGER delete_call_session_context BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_session_context WHERE session_id = OLD.id;
END;
