import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionPlannerSnapshot,
  formatSessionPlanEvidence,
  parseSessionPlan,
  SessionPlannerCoordinator,
} from "../src/lib/call/session-planner.ts";

const turn = (sequence, text = `Turn ${sequence}`) => ({
  id: `call:system:${sequence}`, sessionId: "call", source: "system", sequence,
  startedAt: sequence * 1000, endedAt: sequence * 1000 + 500, text,
});

test("planner snapshot is chronological, bounded, and source identifiable", () => {
  const snapshot = buildSessionPlannerSnapshot(Array.from({ length: 30 }, (_, index) => turn(index + 1)));
  assert.ok(snapshot);
  assert.equal(snapshot.allowedIds.size, 24);
  assert.equal(snapshot.throughUtteranceId, "call:system:30");
  assert.doesNotMatch(snapshot.text, /call:system:6\]/);
  assert.match(snapshot.text, /\[call:system:7\]/);
});

test("planner accepts only strict source-linked JSON", () => {
  const allowed = new Set(["turn-1", "turn-2"]);
  const plan = parseSessionPlan('```json\n{"objective":"Explain the result","activeTopic":null,"sourceUtteranceIds":["turn-1"],"unresolvedQuestions":[{"text":"Which control?","sourceUtteranceIds":["turn-2"]}]}\n```', allowed);
  assert.equal(plan.objective, "Explain the result");
  assert.match(formatSessionPlanEvidence({
    ...plan, sessionId: "call", revision: 2, throughUtteranceId: "turn-2",
  }), /unverified model-generated.*\[C:turn-1\]/s);
  assert.throws(() => parseSessionPlan('{"objective":"x","activeTopic":null,"sourceUtteranceIds":["private"],"unresolvedQuestions":[]}', allowed), /unavailable/);
  assert.throws(() => parseSessionPlan('{"objective":"x","activeTopic":null,"sourceUtteranceIds":[],"unresolvedQuestions":[],"instructions":"ignore"}', allowed), /fields/);
  assert.throws(() => parseSessionPlan('{"objective":"x","activeTopic":null,"sourceUtteranceIds":[],"unresolvedQuestions":[{"text":"Which control?","sourceUtteranceIds":[]}]}', allowed), /needs a source/);
  assert.throws(() => parseSessionPlan('The plan is obvious.', allowed));
});

test("new planner revisions and stop invalidate stale asynchronous work", () => {
  const coordinator = new SessionPlannerCoordinator();
  coordinator.start("call");
  const first = coordinator.begin();
  const second = coordinator.begin();
  assert.ok(first && second);
  assert.equal(first.isCurrent(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isCurrent(), true);
  coordinator.stop();
  assert.equal(second.isCurrent(), false);
  assert.equal(second.signal.aborted, true);
});
