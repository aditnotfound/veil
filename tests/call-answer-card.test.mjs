import test from "node:test";
import assert from "node:assert/strict";
import { validateCallAnswerCard } from "../src/lib/call/answer-card.ts";

function card(overrides = {}) {
  return {
    turnId: "turn",
    sessionId: "session",
    provider: "openai",
    model: "test",
    answerText: "Useful answer",
    streamEvents: [
      { at: 1200, delta: "Useful " },
      { at: 1300, delta: "answer" },
    ],
    startedAt: 1100,
    completedAt: 1400,
    ...overrides,
  };
}

test("completed call card checkpoints reconstruct the displayed answer", () => {
  assert.doesNotThrow(() => validateCallAnswerCard(card()));
  assert.throws(
    () => validateCallAnswerCard(card({ answerText: "Different" })),
    /do not reconstruct/
  );
});

test("completed call cards reject invalid timestamps and empty deltas", () => {
  assert.throws(() => validateCallAnswerCard(card({ completedAt: 1000 })), /Invalid/);
  assert.throws(
    () => validateCallAnswerCard(card({ streamEvents: [{ at: 1200, delta: "" }] })),
    /Invalid/
  );
  assert.throws(
    () => validateCallAnswerCard(card({ streamEvents: [{ at: 1500, delta: "Useful answer" }] })),
    /outside/
  );
});
