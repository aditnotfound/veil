import { getDatabase } from "./config";
import { validateCallAnswerCard, type CallAnswerCard } from "../call/answer-card";

export async function saveCallAnswerCard(card: CallAnswerCard): Promise<void> {
  validateCallAnswerCard(card);
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO call_answer_cards
      (turn_id, session_id, provider, model, answer_text, stream_events,
       started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [card.turnId, card.sessionId, card.provider, card.model, card.answerText,
      JSON.stringify(card.streamEvents), card.startedAt, card.completedAt]
  );
}

/** Deep answers remain drafts until a separate, task-appropriate check exists. */
export async function saveCallDeepAnswer(card: CallAnswerCard): Promise<void> {
  validateCallAnswerCard(card);
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO call_deep_answers
      (turn_id, session_id, provider, model, answer_text, stream_events,
       status, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [card.turnId, card.sessionId, card.provider, card.model, card.answerText,
      JSON.stringify(card.streamEvents), card.startedAt, card.completedAt]
  );
}
