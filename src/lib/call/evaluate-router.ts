import { routeCallTurn, normalizeTurn, type AnsweredTurn, type AutoResponseMode } from "./decision-router.ts";
import type { FinalUtterance } from "./session-core";

export interface LabeledReplayTurn extends FinalUtterance {
  usefulSuggestion: boolean;
  answerSucceeded?: boolean;
}

export interface LabeledReplaySession {
  id: string;
  negativeDurationMs: number;
  turns: LabeledReplayTurn[];
}

export interface RouterEvaluation {
  sessions: number;
  turns: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  negativeHours: number;
  falseSuggestionsPerNegativeHour: number | null;
  precision: number | null;
  recall: number | null;
}

/** Labels and negative-call duration must come from independently annotated replay data. */
export function evaluateRouter(
  sessions: LabeledReplaySession[], mode: AutoResponseMode
): RouterEvaluation {
  const totals = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  let negativeDurationMs = 0;
  let turns = 0;
  for (const session of sessions) {
    if (!session.id || !Number.isFinite(session.negativeDurationMs) || session.negativeDurationMs < 0) {
      throw new Error("Replay session needs an ID and nonnegative labeled negative duration");
    }
    negativeDurationMs += session.negativeDurationMs;
    let lastAnswered: AnsweredTurn | null = null;
    const ordered = [...session.turns].sort((a, b) => a.startedAt - b.startedAt || a.sequence - b.sequence);
    for (const turn of ordered) {
      if (turn.sessionId !== session.id || typeof turn.usefulSuggestion !== "boolean") {
        throw new Error("Replay turn has an invalid session or missing usefulness label");
      }
      turns += 1;
      const decision = routeCallTurn(turn, mode, lastAnswered);
      const suggested = decision.action !== "silence";
      if (suggested && turn.usefulSuggestion) totals.truePositive += 1;
      else if (suggested) totals.falsePositive += 1;
      else if (turn.usefulSuggestion) totals.falseNegative += 1;
      else totals.trueNegative += 1;
      if (suggested && turn.answerSucceeded) {
        lastAnswered = { normalizedText: normalizeTurn(turn.text), endedAt: turn.endedAt };
      }
    }
  }
  const negativeHours = negativeDurationMs / 3_600_000;
  const proposed = totals.truePositive + totals.falsePositive;
  const positive = totals.truePositive + totals.falseNegative;
  return {
    sessions: sessions.length,
    turns,
    ...totals,
    negativeHours,
    falseSuggestionsPerNegativeHour: negativeHours ? totals.falsePositive / negativeHours : null,
    precision: proposed ? totals.truePositive / proposed : null,
    recall: positive ? totals.truePositive / positive : null,
  };
}
