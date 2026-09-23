CREATE TABLE IF NOT EXISTS call_sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS call_utterances (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('system', 'mic')),
    sequence INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    text TEXT NOT NULL CHECK(length(trim(text)) > 0),
    UNIQUE(session_id, source, sequence)
);

CREATE INDEX IF NOT EXISTS idx_call_utterances_order
ON call_utterances(session_id, started_at, ended_at, source, sequence);
