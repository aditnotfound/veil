-- Optional asynchronous high-level plans. Plans are generated drafts, not facts.
CREATE TABLE IF NOT EXISTS call_session_plans (
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK(revision >= 1),
    through_utterance_id TEXT NOT NULL REFERENCES call_utterances(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    plan_json TEXT NOT NULL CHECK(length(trim(plan_json)) > 0),
    status TEXT NOT NULL DEFAULT 'candidate' CHECK(status = 'candidate'),
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL CHECK(completed_at >= started_at),
    PRIMARY KEY(session_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_call_session_plans_latest
ON call_session_plans(session_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS delete_call_session_plans
BEFORE DELETE ON call_sessions
BEGIN
    DELETE FROM call_session_plans WHERE session_id = OLD.id;
END;
