import { getDatabase } from "./config";

export interface CallAnswerAttempt {
  turnId: string;
  sessionId: string;
  trigger: "automatic" | "answer_now";
  startedAt: number;
  firstChunkAt: number | null;
  completedAt: number;
  outcome: "answered" | "failed" | "canceled";
}

/** Diagnostic metadata only; transcript text and provider credentials stay out. */
export async function saveCallAnswerAttempt(attempt: CallAnswerAttempt): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO call_answer_attempts
      (turn_id, session_id, initiator, started_at, first_chunk_at, completed_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [attempt.turnId, attempt.sessionId, attempt.trigger, attempt.startedAt,
      attempt.firstChunkAt, attempt.completedAt, attempt.outcome]
  );
}
