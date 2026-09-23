-- Track transcript-correction invalidation separately for initial and deep
-- answers. Replacing one tier clears only that tier's stale marker.
DROP TRIGGER IF EXISTS invalidate_call_context_after_correction;
DROP TRIGGER IF EXISTS delete_call_transcript_revision_records;

ALTER TABLE call_answer_invalidations RENAME TO call_answer_invalidations_v15;

CREATE TABLE call_answer_invalidations (
    turn_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK(tier IN ('initial', 'deep')),
    reason TEXT NOT NULL CHECK(reason = 'transcript_corrected'),
    invalidated_at INTEGER NOT NULL,
    PRIMARY KEY (turn_id, tier)
);

INSERT INTO call_answer_invalidations
    (turn_id, session_id, tier, reason, invalidated_at)
SELECT old.turn_id, old.session_id, 'initial', old.reason, old.invalidated_at
FROM call_answer_invalidations_v15 old
WHERE EXISTS (
    SELECT 1 FROM call_answer_cards cards WHERE cards.turn_id = old.turn_id
);

INSERT INTO call_answer_invalidations
    (turn_id, session_id, tier, reason, invalidated_at)
SELECT old.turn_id, old.session_id, 'deep', old.reason, old.invalidated_at
FROM call_answer_invalidations_v15 old
WHERE EXISTS (
    SELECT 1 FROM call_deep_answers deep WHERE deep.turn_id = old.turn_id
);

DROP TABLE call_answer_invalidations_v15;

CREATE INDEX idx_call_answer_invalidations_session
ON call_answer_invalidations(session_id, invalidated_at);

CREATE TRIGGER invalidate_call_context_after_correction
AFTER UPDATE OF text ON call_utterances
WHEN trim(NEW.text) <> trim(OLD.text)
BEGIN
    DELETE FROM call_session_ledger WHERE source_utterance_id = OLD.id;
    DELETE FROM call_session_plans WHERE session_id = OLD.session_id;
    INSERT OR REPLACE INTO call_answer_invalidations
        (turn_id, session_id, tier, reason, invalidated_at)
    SELECT cards.turn_id, OLD.session_id, 'initial', 'transcript_corrected',
           CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    FROM call_answer_cards cards
    JOIN call_utterances answered ON answered.id = cards.turn_id
    WHERE cards.session_id = OLD.session_id AND answered.ended_at >= OLD.ended_at;
    INSERT OR REPLACE INTO call_answer_invalidations
        (turn_id, session_id, tier, reason, invalidated_at)
    SELECT deep.turn_id, OLD.session_id, 'deep', 'transcript_corrected',
           CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    FROM call_deep_answers deep
    JOIN call_utterances answered ON answered.id = deep.turn_id
    WHERE deep.session_id = OLD.session_id AND answered.ended_at >= OLD.ended_at;
END;

CREATE TRIGGER clear_initial_invalidation_after_regeneration
AFTER INSERT ON call_answer_cards
BEGIN
    DELETE FROM call_answer_invalidations
    WHERE turn_id = NEW.turn_id AND tier = 'initial';
END;

CREATE TRIGGER clear_deep_invalidation_after_regeneration
AFTER INSERT ON call_deep_answers
BEGIN
    DELETE FROM call_answer_invalidations
    WHERE turn_id = NEW.turn_id AND tier = 'deep';
END;

CREATE TRIGGER delete_call_transcript_revision_records
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_utterance_revisions WHERE session_id = OLD.id;
    DELETE FROM call_answer_invalidations WHERE session_id = OLD.id;
END;
