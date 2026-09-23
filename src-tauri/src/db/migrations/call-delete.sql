-- Remove every session-owned record in the same statement, including when a
-- SQLite connection has foreign-key enforcement disabled.
CREATE TRIGGER IF NOT EXISTS delete_call_session_records
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_turn_decisions WHERE session_id = OLD.id;
    DELETE FROM call_turn_timings WHERE session_id = OLD.id;
    DELETE FROM call_utterances WHERE session_id = OLD.id;
END;
