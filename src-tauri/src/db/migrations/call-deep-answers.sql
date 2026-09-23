-- Optional expanded drafts generated from a completed initial call card.
CREATE TABLE IF NOT EXISTS call_deep_answers (
    turn_id TEXT PRIMARY KEY REFERENCES call_utterances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    answer_text TEXT NOT NULL CHECK(length(trim(answer_text)) > 0),
    stream_events TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('draft', 'grounded', 'checked')),
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL CHECK(completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_call_deep_answers_session
ON call_deep_answers(session_id, completed_at);

CREATE TRIGGER IF NOT EXISTS delete_call_deep_answers
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_deep_answers WHERE session_id = OLD.id;
END;
