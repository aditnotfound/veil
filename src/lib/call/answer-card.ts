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
