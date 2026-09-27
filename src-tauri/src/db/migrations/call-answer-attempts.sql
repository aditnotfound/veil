-- One row per live initial-answer attempt, including failed and canceled
-- attempts that never produced a completed answer card. No transcript or key.
CREATE TABLE IF NOT EXISTS call_answer_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id TEXT NOT NULL REFERENCES call_utterances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    initiator TEXT NOT NULL CHECK(initiator IN ('automatic', 'answer_now')),
    started_at INTEGER NOT NULL,
    first_chunk_at INTEGER CHECK(first_chunk_at IS NULL OR first_chunk_at >= started_at),
    completed_at INTEGER NOT NULL CHECK(completed_at >= started_at),
    outcome TEXT NOT NULL CHECK(outcome IN ('answered', 'failed', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_call_answer_attempts_session
ON call_answer_attempts(session_id, started_at);

CREATE TRIGGER IF NOT EXISTS delete_call_answer_attempts
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_answer_attempts WHERE session_id = OLD.id;
END;
