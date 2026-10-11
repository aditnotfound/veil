import assert from "node:assert/strict";
import test from "node:test";
import { OneShotGuidance } from "../src/lib/call/one-shot-guidance.ts";
import { MAX_LIVE_GUIDANCE_CHARS, callCardPrompt } from "../src/lib/call/decision-router.ts";

test("queued guidance is used by one automatic answer and cannot bleed into the next", () => {
  const queue = new OneShotGuidance();
  assert.equal(queue.queue("  Focus on the database issue.  "), "Focus on the database issue.");
  const first = callCardPrompt("Base", queue.take());
  const second = callCardPrompt("Base", queue.take());
  assert.match(first, /Focus on the database issue/);
  assert.doesNotMatch(second, /Focus on the database issue/);
  assert.match(first, /this answer only/);
});

test("new guidance replaces pending guidance and can be canceled", () => {
  const queue = new OneShotGuidance();
  queue.queue("Old topic");
  queue.queue("New topic");
  assert.equal(queue.take(), "New topic");
  queue.queue("Cancel this");
  queue.clear();
  assert.equal(queue.take(), "");
  assert.equal(queue.queue(" "), "");
  queue.queue("Keep this");
  assert.equal(queue.queue(" "), "Keep this");
  assert.equal(queue.queue("x".repeat(MAX_LIVE_GUIDANCE_CHARS + 10)).length, MAX_LIVE_GUIDANCE_CHARS);
});
