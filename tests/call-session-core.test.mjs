import test from "node:test";
import assert from "node:assert/strict";
import { CallSessionCore } from "../src/lib/call/session-core.ts";

const final = (sessionId, sequence, startedAt, text, source = "system") => ({
  id: `${sessionId}:${source}:${sequence}`,
  sessionId,
  source,
  sequence,
  startedAt,
  endedAt: startedAt + 500,
  text,
});

test("replay keeps unanswered utterances in capture order and deduplicates finals", () => {
  const core = new CallSessionCore();
  core.start("call-1");
  assert.equal(core.appendFinal(final("call-1", 2, 2000, "Second")), true);
  assert.equal(core.appendFinal(final("call-1", 1, 1000, "First")), true);
  assert.equal(core.appendFinal(final("call-1", 2, 2000, "Second duplicate")), false);
  assert.equal(core.appendFinal(final("call-1", 1, 1500, "Me", "mic")), true);
  assert.deepEqual(core.orderedUtterances().map((u) => u.text), ["First", "Me", "Second"]);
  assert.deepEqual(core.historyBefore("call-1:system:2").map((m) => m.content), [
    "System: First", "Mic: Me",
  ]);
});

test("an answer cannot see later finalized turns even when they arrived first", () => {
  const core = new CallSessionCore();
  core.start("call");
  core.appendFinal(final("call", 3, 3000, "future fact"));
  core.appendFinal(final("call", 2, 2000, "question"));
  core.appendFinal(final("call", 1, 1000, "earlier fact", "mic"));
  assert.deepEqual(core.historyBefore("call:system:2").map((m) => m.content), [
    "Mic: earlier fact",
  ]);
  assert.equal(core.historyBefore("").length, 3);
});

test("a new answer, stop, and restart invalidate old streamed work", () => {
  const core = new CallSessionCore();
  core.start("call-1");
  const first = core.beginAnswer();
  assert.equal(first.isCurrent(), true);
  const second = core.beginAnswer();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  core.stop();
  assert.equal(second.isCurrent(), false);
  core.start("call-2");
  assert.equal(core.appendFinal(final("call-1", 1, 1000, "late")), false);
  assert.deepEqual(core.orderedUtterances(), []);
  assert.equal(core.appendFinal(final("call-2", 1, 1000, "new")), true);
});

test("blank and duplicate sequence finals cannot enter context", () => {
  const core = new CallSessionCore();
  core.start("call-1");
  assert.equal(core.appendFinal(final("call-1", 1, 1, "  ")), false);
  assert.equal(core.appendFinal(final("call-1", 1, 1, " valid ")), true);
  assert.deepEqual(core.orderedUtterances().map((u) => u.text), ["valid"]);
});

test("a two-hour replay retains the full journal but bounds prompt history", () => {
  const core = new CallSessionCore();
  core.start("long");
  const turnCount = 120 * 60 / 5;
  for (let index = 0; index < turnCount; index++) {
    const source = index % 2 === 0 ? "system" : "mic";
    const sequence = Math.floor(index / 2) + 1;
    core.appendFinal(final("long", sequence, index * 5000, `turn ${index + 1}`, source));
  }
  const journal = core.orderedUtterances();
  assert.equal(journal.length, 1440);
  assert.equal(journal.at(-1).endedAt - journal[0].startedAt, 7_195_500);
  const history = core.historyBefore("");
  assert.equal(history.length, 24);
  assert.equal(history[0].content, "System: turn 1417");
  assert.equal(history.at(-1).content, "Mic: turn 1440");
});
