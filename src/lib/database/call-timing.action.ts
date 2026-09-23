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

export async function saveCallTurnTiming(timing: CallTurnTiming): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO call_turn_timings
      (turn_id, session_id, source, audio_ready_at, audio_to_stt_ms,
       wait_before_answer_ms, answer_to_first_chunk_ms,
       audio_to_first_chunk_ms, answer_total_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [timing.turnId, timing.sessionId, timing.source, timing.audioReadyAt,
      timing.audioToSttMs ?? null, timing.waitBeforeAnswerMs ?? null,
      timing.answerToFirstChunkMs ?? null, timing.audioToFirstChunkMs ?? null,
      timing.answerTotalMs ?? null, timing.status]
  );
}
