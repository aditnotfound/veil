import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithRetry, transcribeWithHedge, timeoutForWav, isShortWavForHedge } from "../src/lib/call/transcribe-with-retry.ts";

test("long WAV recordings receive a larger bounded STT deadline", () => {
  const wav = new Uint8Array(44 + 16000 * 2 * 60);
  const view = new DataView(wav.buffer);
  wav.set([82, 73, 70, 70], 0); // RIFF
  wav.set([87, 65, 86, 69], 8); // WAVE
  view.setUint32(28, 32000, true);
  view.setUint32(40, wav.length - 44, true);
  assert.equal(timeoutForWav(wav), 53_000);
  assert.equal(timeoutForWav(new Uint8Array(8)), 8_000);
});

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

function wavWithSeconds(seconds) {
  const wav = new Uint8Array(44 + 32000 * seconds);
  const view = new DataView(wav.buffer);
  wav.set([82, 73, 70, 70], 0);
  wav.set([87, 65, 86, 69], 8);
  wav.set([102, 109, 116, 32], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(28, 32000, true);
  view.setUint16(34, 16, true);
  wav.set([100, 97, 116, 97], 36);
  view.setUint32(40, wav.length - 44, true);
  return wav;
}

test("only valid clips up to ten seconds qualify for hedging", () => {
  assert.equal(isShortWavForHedge(wavWithSeconds(10)), true);
  assert.equal(isShortWavForHedge(wavWithSeconds(11)), false);
  assert.equal(isShortWavForHedge(wavWithSeconds(0)), false);
  assert.equal(isShortWavForHedge(new Uint8Array(44)), false);
});

test("fast transcription never launches a duplicate request", async () => {
  let calls = 0;
  assert.equal(await transcribeWithHedge(async () => { calls++; return "hello"; }, undefined, 100, 20), "hello");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls, 1);
});

test("a slow request can be rescued by one backup, aborting the loser", async () => {
  const signals = [];
  const result = await transcribeWithHedge((signal) => {
    signals.push(signal);
    return signals.length === 1 ? new Promise(() => {}) : Promise.resolve("recovered");
  }, undefined, 100, 10);
  assert.equal(result, "recovered");
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("the original can win after hedging and cancels the backup", async () => {
  const signals = [];
  const result = await transcribeWithHedge((signal) => {
    signals.push(signal);
    return signals.length === 1
      ? new Promise((resolve) => setTimeout(() => resolve("original"), 25))
      : new Promise(() => {});
  }, undefined, 100, 5);
  assert.equal(result, "original");
  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, true);
});

test("session stop aborts both hedged requests even if transports ignore abort", async () => {
  const session = new AbortController();
  const signals = [];
  const result = transcribeWithHedge((signal) => { signals.push(signal); return new Promise(() => {}); }, session.signal, 1000, 5);
  setTimeout(() => session.abort(), 20);
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("a fast authentication error does not launch a backup", async () => {
  let calls = 0;
  await assert.rejects(transcribeWithHedge(async () => { calls++; throw new Error("HTTP 401"); }, undefined, 100, 10), /HTTP 401/);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls, 1);
});

test("when both hedged requests fail their errors do not hang the call", async () => {
  let calls = 0;
  await assert.rejects(transcribeWithHedge(() => {
    calls++;
    return calls === 1
      ? new Promise((_, reject) => setTimeout(() => reject(new Error("first failed")), 15))
      : Promise.reject(new Error("backup failed"));
  }, undefined, 100, 5), /first failed/);
  assert.equal(calls, 2);
});

test("one failing hedged request does not discard the other successful request", async () => {
  let calls = 0;
  const result = await transcribeWithHedge(() => {
    calls++;
    return calls === 1
      ? new Promise((_, reject) => setTimeout(() => reject(new Error("network")), 15))
      : new Promise((resolve) => setTimeout(() => resolve("recovered"), 25));
  }, undefined, 100, 5);
  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});
