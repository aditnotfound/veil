import { getDatabase } from "./config";
import type { CallSource } from "../call/session-core";

export type CallTurnStatus = "transcribed" | "answered" | "stt_error" | "answer_error" | "storage_error" | "canceled";

export interface CallTurnTiming {
  turnId: string;
  sessionId: string;
  source: CallSource;
  audioReadyAt: number;
  audioToSttMs?: number;
  waitBeforeAnswerMs?: number;
  answerToFirstChunkMs?: number;
  audioToFirstChunkMs?: number;
  answerTotalMs?: number;
  status: CallTurnStatus;
}

export async function getCallTurnTiming(turnId: string): Promise<CallTurnTiming | null> {
  const db = await getDatabase();
  const rows = await db.select<{
    turn_id: string; session_id: string; source: CallSource; audio_ready_at: number;
    audio_to_stt_ms: number | null; wait_before_answer_ms: number | null;
    answer_to_first_chunk_ms: number | null; audio_to_first_chunk_ms: number | null;
    answer_total_ms: number | null; status: CallTurnStatus;
  }[]>(
    `SELECT turn_id, session_id, source, audio_ready_at, audio_to_stt_ms,
            wait_before_answer_ms, answer_to_first_chunk_ms, audio_to_first_chunk_ms,
            answer_total_ms, status FROM call_turn_timings WHERE turn_id = ? LIMIT 1`,
    [turnId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    turnId: row.turn_id, sessionId: row.session_id, source: row.source,
    audioReadyAt: row.audio_ready_at,
    audioToSttMs: row.audio_to_stt_ms ?? undefined,
    waitBeforeAnswerMs: row.wait_before_answer_ms ?? undefined,
    answerToFirstChunkMs: row.answer_to_first_chunk_ms ?? undefined,
    audioToFirstChunkMs: row.audio_to_first_chunk_ms ?? undefined,
    answerTotalMs: row.answer_total_ms ?? undefined,
    status: row.status,
  };
}

export async function saveCallTurnTiming(timing: CallTurnTiming): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO call_turn_timings
      (turn_id, session_id, source, audio_ready_at, audio_to_stt_ms,
       wait_before_answer_ms, answer_to_first_chunk_ms,
       audio_to_first_chunk_ms, answer_total_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(turn_id) DO UPDATE SET
       audio_ready_at = CASE WHEN excluded.audio_to_stt_ms IS NOT NULL
         THEN excluded.audio_ready_at ELSE call_turn_timings.audio_ready_at END,
       audio_to_stt_ms = COALESCE(excluded.audio_to_stt_ms, call_turn_timings.audio_to_stt_ms),
       wait_before_answer_ms = COALESCE(excluded.wait_before_answer_ms, call_turn_timings.wait_before_answer_ms),
       answer_to_first_chunk_ms = COALESCE(excluded.answer_to_first_chunk_ms, call_turn_timings.answer_to_first_chunk_ms),
       audio_to_first_chunk_ms = COALESCE(excluded.audio_to_first_chunk_ms, call_turn_timings.audio_to_first_chunk_ms),
       answer_total_ms = COALESCE(excluded.answer_total_ms, call_turn_timings.answer_total_ms),
       status = CASE WHEN excluded.status = 'transcribed' AND
         call_turn_timings.status IN ('answered', 'answer_error')
         THEN call_turn_timings.status ELSE excluded.status END`,
    [timing.turnId, timing.sessionId, timing.source, timing.audioReadyAt,
      timing.audioToSttMs ?? null, timing.waitBeforeAnswerMs ?? null,
      timing.answerToFirstChunkMs ?? null, timing.audioToFirstChunkMs ?? null,
      timing.answerTotalMs ?? null, timing.status]
  );
}
