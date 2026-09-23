import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRouter } from "../src/lib/call/evaluate-router.ts";

const corpus = JSON.parse(readFileSync(new URL("./fixtures/synthetic-router-replay.json", import.meta.url), "utf8"));

test("replay evaluator counts abstentions, false suggestions, and labeled negative time", () => {
  const result = evaluateRouter(corpus.sessions, "after_pause");
  assert.deepEqual(
    [result.truePositive, result.falsePositive, result.falseNegative, result.trueNegative],
    [1, 1, 0, 3]
  );
  assert.equal(result.negativeHours, 0.25);
  assert.equal(result.falseSuggestionsPerNegativeHour, 4);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 1);
});

test("replay evaluator rejects missing usefulness labels and missing negative time", () => {
  assert.throws(() => evaluateRouter([{ id: "bad", negativeDurationMs: -1, turns: [] }], "after_pause"));
  const bad = structuredClone(corpus.sessions);
  delete bad[0].turns[0].usefulSuggestion;
  assert.throws(() => evaluateRouter(bad, "after_pause"));
});
