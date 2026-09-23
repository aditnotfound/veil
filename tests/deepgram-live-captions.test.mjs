import test from "node:test";
import assert from "node:assert/strict";
import { DeepgramLiveCaptions, pcm16FromBase64, pcm16FromFloat } from "../src/lib/call/deepgram-live-captions.ts";

function harness() {
  const captions = [];
  const statuses = [];
  const sent = [];
  const socket = {
    readyState: 0, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: (value) => sent.push(value),
    close() { this.readyState = 3; },
  };
  let url;
  let protocols;
  const stream = new DeepgramLiveCaptions("secret-key", "nova-2", 16000,
    (text) => captions.push(text), (status) => statuses.push(status),
    (target, auth) => { url = target; protocols = auth; return socket; });
  return { stream, socket, captions, statuses, sent, url, protocols };
}

test("live Deepgram captions revise partial text and assemble final chunks once", () => {
  const h = harness();
  assert.equal(h.url.includes("secret-key"), false);
  assert.deepEqual(h.protocols, ["token", "secret-key"]);
  assert.match(h.url, /interim_results=true/);
  h.socket.readyState = 1;
  h.socket.onopen();
  const result = (transcript, is_final, speech_final = false) => {
    h.socket.onmessage({ data: JSON.stringify({ type: "Results", is_final, speech_final,
      channel: { alternatives: [{ transcript }] } }) });
  };
  result("where", false);
  result("where is", false);
  result("where is", true);
  result("the file", false);
  result("the file", true, true);
  result("next", false);
  assert.deepEqual(h.captions, ["where", "where is", "where is", "where is the file", "where is the file", "next"]);
  assert.deepEqual(h.statuses, ["connecting", "live"]);
  assert.equal(h.stream.sendPcm(pcm16FromFloat(new Float32Array([1, -1]))), true);
  assert.deepEqual([...new Uint8Array(h.sent.at(-1))], [255, 127, 0, 128]);
  h.stream.close();
  assert.equal(h.socket.readyState, 3);
});

test("provider failure and backpressure switch to batch fallback without storing text", () => {
  const h = harness();
  h.socket.readyState = 1;
  h.socket.onopen();
  h.socket.onmessage({ data: "not json" });
  assert.deepEqual(h.captions, []);
  h.socket.bufferedAmount = 300_000;
  assert.equal(h.stream.sendPcm(new ArrayBuffer(4)), false);
  assert.equal(h.statuses.at(-1), "fallback");
  assert.equal(h.socket.readyState, 3);
  h.socket.onmessage({ data: JSON.stringify({ type: "Results", channel: { alternatives: [{ transcript: "late" }] } }) });
  assert.deepEqual(h.captions, []);
});

test("base64 PCM decoder rejects odd byte counts", () => {
  assert.deepEqual([...new Uint8Array(pcm16FromBase64("AQI="))], [1, 2]);
  assert.throws(() => pcm16FromBase64("AQ=="));
});
