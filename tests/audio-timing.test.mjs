import test from "node:test";
import assert from "node:assert/strict";
import { estimateWavStartAt } from "../src/lib/call/audio-timing.ts";

test("WAV start estimate accounts for captured PCM duration", () => {
  const wav = new Uint8Array(44 + 32000);
  wav.set(new TextEncoder().encode("RIFF"), 0);
  wav.set(new TextEncoder().encode("WAVE"), 8);
  const view = new DataView(wav.buffer);
  view.setUint32(28, 32000, true);
  view.setUint32(40, 32000, true);
  assert.equal(estimateWavStartAt(5000, wav), 4000);
});

test("malformed WAV timing falls back to receipt time", () => {
  assert.equal(estimateWavStartAt(5000, new Uint8Array(10)), 5000);
});
