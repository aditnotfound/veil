-- Conservative session memory derived locally from exact transcript excerpts.
-- Entries remain candidates: classification does not make the excerpt true.
CREATE TABLE IF NOT EXISTS call_session_ledger (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    source_utterance_id TEXT NOT NULL REFERENCES call_utterances(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN (
        'person', 'fact', 'number', 'decision', 'commitment', 'unresolved_question'
    )),
    excerpt TEXT NOT NULL CHECK(length(trim(excerpt)) > 0 AND length(excerpt) <= 400),
    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status = 'candidate'),
    created_at INTEGER NOT NULL,
    UNIQUE(source_utterance_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_call_session_ledger_session
ON call_session_ledger(session_id, created_at, source_utterance_id);

-- Session deletion must remain complete even if a connection has disabled
-- SQLite foreign-key enforcement.
CREATE TRIGGER IF NOT EXISTS delete_call_session_ledger
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_session_ledger WHERE session_id = OLD.id;
END;
