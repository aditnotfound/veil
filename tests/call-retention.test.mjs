import test from "node:test";
import assert from "node:assert/strict";
import {
  CALL_RETENTION_OPTIONS,
  callRetentionCutoff,
  callRetentionLabel,
  parseCallRetentionDays,
} from "../src/lib/call/retention.ts";

test("call retention defaults safely and accepts only exposed choices", () => {
  assert.deepEqual(CALL_RETENTION_OPTIONS, [0, 7, 30, 90]);
  assert.equal(parseCallRetentionDays(null), 0);
  assert.equal(parseCallRetentionDays("30"), 30);
  assert.equal(parseCallRetentionDays("31"), 0);
  assert.equal(parseCallRetentionDays("garbage"), 0);
  assert.equal(callRetentionLabel(0), "Keep until I delete");
  assert.equal(callRetentionLabel(7), "7 days");
});

test("call retention cutoff is deterministic and forever has no cutoff", () => {
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  assert.equal(callRetentionCutoff(0, now), null);
  assert.equal(callRetentionCutoff(7, now), now - 7 * 24 * 60 * 60 * 1_000);
  assert.equal(callRetentionCutoff(90, now), now - 90 * 24 * 60 * 60 * 1_000);
});
