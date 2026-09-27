import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithRetry } from "../src/lib/call/transcribe-with-retry.ts";

test("a stalled STT request is aborted and a second attempt can recover", async () => {
  const signals = [];
  const result = await transcribeWithRetry((signal) => {
    signals.push(signal);
    return signals.length === 1 ? new Promise(() => {}) : Promise.resolve("final question");
  }, undefined, 10);
  assert.equal(result, "final question");
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("stopping a call ends STT promptly even when transport ignores abort", async () => {
  const session = new AbortController();
  let attempts = 0;
  const started = performance.now();
  const result = transcribeWithRetry(() => {
    attempts++;
    return new Promise(() => {});
  }, session.signal, 1_000);
  setTimeout(() => session.abort(), 10);
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(attempts, 1);
  assert.ok(performance.now() - started < 200);
});

test("provider HTTP errors do not consume a second STT request", async () => {
  let attempts = 0;
  await assert.rejects(transcribeWithRetry(async () => {
    attempts++;
    throw new Error("HTTP 401: invalid key");
  }, undefined, 10), /HTTP 401/);
  assert.equal(attempts, 1);
});
