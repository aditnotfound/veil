-- Stage timings contain no transcript text or provider credentials.
-- audio_ready_at is the time the batch is available after VAD, not speech end.
CREATE TABLE IF NOT EXISTS call_turn_timings (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('system', 'mic')),
    audio_ready_at INTEGER NOT NULL,
    audio_to_stt_ms REAL,
    wait_before_answer_ms REAL,
    answer_to_first_chunk_ms REAL,
    audio_to_first_chunk_ms REAL,
    answer_total_ms REAL,
    status TEXT NOT NULL CHECK(status IN ('transcribed', 'answered', 'stt_error', 'answer_error', 'storage_error', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_call_turn_timings_session
ON call_turn_timings(session_id, audio_ready_at);
