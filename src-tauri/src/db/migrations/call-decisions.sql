-- One immutable routing decision per finalized utterance. Transcript text stays in call_utterances.
CREATE TABLE IF NOT EXISTS call_turn_decisions (
    turn_id TEXT PRIMARY KEY REFERENCES call_utterances(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    decided_at INTEGER NOT NULL,
    router_version TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('off', 'on_question', 'after_pause')),
    action TEXT NOT NULL CHECK(action IN ('silence', 'short_answer')),
    reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_turn_decisions_session
ON call_turn_decisions(session_id, decided_at);
