export interface AnswerStreamEvent {
  at: number;
  delta: string;
}

export interface CallAnswerCard {
  turnId: string;
  sessionId: string;
  provider: string;
  model: string;
  answerText: string;
  streamEvents: AnswerStreamEvent[];
  startedAt: number;
  completedAt: number;
}

export const SAVE_REGENERATED_CALL_ANSWER_SQL = `INSERT OR REPLACE INTO call_answer_cards
      (turn_id, session_id, provider, model, answer_text, stream_events,
       started_at, completed_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM call_utterances
       WHERE id = ? AND session_id = ? AND text = ?
     )`;

export const SAVE_REGENERATED_CALL_DEEP_ANSWER_SQL = `INSERT OR REPLACE INTO call_deep_answers
      (turn_id, session_id, provider, model, answer_text, stream_events,
       status, started_at, completed_at)
     SELECT ?, ?, ?, ?, ?, ?, 'draft', ?, ?
     WHERE EXISTS (
       SELECT 1 FROM call_utterances
       WHERE id = ? AND session_id = ? AND text = ?
     )`;

function validEvent(event: AnswerStreamEvent): boolean {
  return Number.isSafeInteger(event.at) && event.at > 0 &&
    typeof event.delta === "string" && event.delta.length > 0;
}

export function validateCallAnswerCard(card: CallAnswerCard): void {
  if (!card.turnId || !card.sessionId || !card.provider || !card.answerText.trim() ||
      !Number.isSafeInteger(card.startedAt) || !Number.isSafeInteger(card.completedAt) ||
      card.completedAt < card.startedAt || !card.streamEvents.every(validEvent)) {
    throw new Error("Invalid completed call card");
  }
  const reconstructed = card.streamEvents.map((event) => event.delta).join("");
  if (reconstructed !== card.answerText) {
    throw new Error("Call card checkpoints do not reconstruct the displayed answer");
  }
  let previousAt = card.startedAt;
  for (const event of card.streamEvents) {
    if (event.at < previousAt || event.at > card.completedAt) {
      throw new Error("Call card checkpoint timestamp is outside its generation window");
    }
    previousAt = event.at;
  }
}
