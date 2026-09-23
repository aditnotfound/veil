-- Completed, locally displayed Listen cards and their streamed checkpoints.
-- The JSON event list contains text deltas with wall-clock timestamps so a
-- reviewer can identify when the displayed card first became useful.
CREATE TABLE IF NOT EXISTS call_answer_cards (
    turn_id TEXT PRIMARY KEY REFERENCES call_utterances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    answer_text TEXT NOT NULL CHECK(length(trim(answer_text)) > 0),
    stream_events TEXT NOT NULL DEFAULT '[]',
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL CHECK(completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_call_answer_cards_session
ON call_answer_cards(session_id, completed_at);

-- The original session-delete trigger predates this table, and SQLite foreign
-- key enforcement may be disabled on an individual connection.
CREATE TRIGGER IF NOT EXISTS delete_call_answer_cards
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_answer_cards WHERE session_id = OLD.id;
END;
