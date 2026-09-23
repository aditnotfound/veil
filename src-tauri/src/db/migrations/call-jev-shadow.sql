-- Optional JEV experiment outcomes. No transcript or request body is copied here.
CREATE TABLE IF NOT EXISTS call_jev_shadow (
    turn_id TEXT PRIMARY KEY REFERENCES call_utterances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    observed_at INTEGER NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('off', 'on_question', 'after_pause')),
    status TEXT NOT NULL CHECK(status IN (
        'valid', 'invalid', 'timeout', 'canceled', 'http_error', 'network_error',
        'unavailable', 'backpressure', 'out_of_scope', 'superseded'
    )),
    choice TEXT CHECK(choice IN ('silence', 'short_answer')),
    confidence REAL CHECK(confidence BETWEEN 0 AND 1),
    latency_ms REAL CHECK(latency_ms >= 0),
    CHECK((status = 'valid' AND choice IS NOT NULL) OR
          (status <> 'valid' AND choice IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_call_jev_shadow_session
ON call_jev_shadow(session_id, observed_at);

-- Migration 8's deletion trigger predates this table. Keep session deletion
-- complete even when a connection does not enforce SQLite foreign keys.
CREATE TRIGGER IF NOT EXISTS delete_call_jev_shadow
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_jev_shadow WHERE session_id = OLD.id;
END;
