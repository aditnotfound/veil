import test from "node:test";
import assert from "node:assert/strict";
import { buildCallReviewHistory, formatCallLedger, formatCallPlans, formatCallSuggestions } from "../src/lib/call/session-review.ts";

test("review-time answer history is bounded, chronological, and source linked", () => {
  const utterances = Array.from({ length: 30 }, (_, index) => ({
    id: `turn-${index}`,
    sessionId: "call",
    source: index % 2 ? "mic" : "system",
    sequence: index,
    startedAt: index * 2,
    endedAt: index * 2 + 1,
    text: `utterance ${index}`,
  }));
  const history = buildCallReviewHistory(utterances, "turn-29");
  assert.equal(history.length, 24);
  assert.match(history[0].content, /^\[C:turn-5\] Mic: utterance 5$/);
  assert.match(history.at(-1).content, /^\[C:turn-28\] System: utterance 28$/);
  assert.deepEqual(buildCallReviewHistory(utterances, "missing"), []);
});

test("saved call suggestions stay source linked, labeled, and chronological", () => {
  const output = formatCallSuggestions([
    {
      turnId: "turn-1", tier: "deep", status: "draft", prompt: "  Explain   why ",
      provider: "openai", model: "strong", answer: "Detailed draft", questionEndedAt: 1000,
      completedAt: 3000,
    },
    {
      turnId: "turn-1", tier: "initial", status: "unverified", prompt: "Explain why",
      provider: "openai", model: "fast", answer: "Short opening", questionEndedAt: 1000,
      completedAt: 2000,
    },
  ], (timestamp) => `t=${timestamp}`);

  assert.ok(output.indexOf("Initial card") < output.indexOf("Deep answer"));
  assert.match(output, /Source: \[C:turn-1\] · t=2000 · openai · fast/);
  assert.match(output, /Question: Explain why/);
  assert.match(output, /Deep answer · draft/);
});

test("saved planner revisions remain visibly candidate and source linked", () => {
  const output = formatCallPlans([{
    revision: 2, throughUtteranceId: "turn-8", provider: "openai", model: "planner",
    objective: "Address the control", activeTopic: "Calibration", sourceUtteranceIds: ["turn-2"],
    unresolvedQuestions: [{ text: "Which split?", sourceUtteranceIds: ["turn-7"] }],
    completedAt: 9000,
  }], (timestamp) => `t=${timestamp}`);
  assert.match(output, /Planner revision 2 · candidate/);
  assert.match(output, /Through: \[C:turn-8\] · t=9000/);
  assert.match(output, /Sources: \[C:turn-2\]/);
  assert.match(output, /Which split\?.*\[C:turn-7\]/);
});

test("candidate session ledger stays source linked and escapes transcript markdown", () => {
  const output = formatCallLedger([{
    id: "ledger-1", sourceUtteranceId: "turn-2", source: "mic", kind: "commitment",
    status: "candidate", excerpt: "I will open [this](https://example.com) tomorrow.", createdAt: 4000,
  }], (timestamp) => `t=${timestamp}`);
  assert.match(output, /commitment · candidate/);
  assert.match(output, /Source: \[C:turn-2\] · t=4000 · Mic/);
  assert.match(output, /\\\[this\\\]\\\(https:\/\/example\\\.com\\\)/);
});
