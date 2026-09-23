-- Audited transcript corrections and conservative invalidation of generated work.
CREATE TABLE IF NOT EXISTS call_utterance_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utterance_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    previous_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL CHECK(length(trim(corrected_text)) > 0),
    corrected_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_utterance_revisions_source
ON call_utterance_revisions(session_id, utterance_id, corrected_at);

CREATE TABLE IF NOT EXISTS call_answer_invalidations (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK(reason = 'transcript_corrected'),
    invalidated_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS record_call_utterance_revision
BEFORE UPDATE OF text ON call_utterances
WHEN trim(NEW.text) <> trim(OLD.text)
BEGIN
    INSERT INTO call_utterance_revisions
        (utterance_id, session_id, previous_text, corrected_text, corrected_at)
    VALUES
        (OLD.id, OLD.session_id, OLD.text, trim(NEW.text),
         CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS invalidate_call_context_after_correction
AFTER UPDATE OF text ON call_utterances
WHEN trim(NEW.text) <> trim(OLD.text)
BEGIN
    DELETE FROM call_session_ledger WHERE source_utterance_id = OLD.id;
    DELETE FROM call_session_plans WHERE session_id = OLD.session_id;
    INSERT OR REPLACE INTO call_answer_invalidations
        (turn_id, session_id, reason, invalidated_at)
    SELECT cards.turn_id, OLD.session_id, 'transcript_corrected',
           CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    FROM call_answer_cards cards
    JOIN call_utterances answered ON answered.id = cards.turn_id
    WHERE cards.session_id = OLD.session_id AND answered.ended_at >= OLD.ended_at;
END;

CREATE TRIGGER IF NOT EXISTS delete_call_transcript_revision_records
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_utterance_revisions WHERE session_id = OLD.id;
    DELETE FROM call_answer_invalidations WHERE session_id = OLD.id;
END;
