import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeCallTurn } from "../src/lib/call/decision-router.ts";

const corpus = JSON.parse(readFileSync(new URL("./fixtures/listen-realistic-cases.json", import.meta.url), "utf8"));
test("realistic development replay preserves request intent and silence", () => {
  for (const item of corpus.cases) {
    const utterance = { id: item.id, sessionId: "test", source: item.source ?? "system", sequence: 2,
      startedAt: 20000, endedAt: 22000, text: item.text };
    const prior = item.previousAnswer ? { normalizedText: "previous question", endedAt: 19000 } : null;
    assert.equal(routeCallTurn(utterance, "after_pause", prior).action !== "silence", item.answer, item.id);
  }
});

test("short followups require a recent successful answer and respect off and mic controls", () => {
  const turn = { id: "t2", sessionId: "test", source: "system", sequence: 2,
    startedAt: 20000, endedAt: 22000, text: "How so?" };
  const prior = { normalizedText: "prior question", endedAt: 19000 };
  assert.equal(routeCallTurn(turn, "on_question", prior).action, "short_answer");
  assert.equal(routeCallTurn(turn, "off", prior).action, "silence");
  assert.equal(routeCallTurn({ ...turn, source: "mic" }, "after_pause", prior).action, "silence");
  for (const endedAt of [-10000, 23000]) {
    assert.equal(routeCallTurn(turn, "after_pause", { ...prior, endedAt }).action, "silence");
  }
});
