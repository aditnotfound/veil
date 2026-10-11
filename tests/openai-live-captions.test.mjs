import test from "node:test";
import assert from "node:assert/strict";
import { OpenAILiveCaptions, Pcm16Resampler } from "../src/lib/call/openai-live-captions.ts";

function pcm(samples) {
  const frame = new ArrayBuffer(samples.length * 2);
  const view = new DataView(frame);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return frame;
}

function samples(frame) {
  const view = new DataView(frame);
  return Array.from({ length: frame.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true));
}

test("24 kHz resampling keeps the same samples across capture frame boundaries", () => {
  for (const [rate, length] of [[16000, 320], [44100, 882], [48000, 960]]) {
    const input = Array.from({ length }, (_, index) => Math.round(Math.sin(index / 10) * 10000));
    const whole = new Pcm16Resampler(rate).process(pcm(input));
    const split = new Pcm16Resampler(rate);
    const half = length / 2;
    const result = [...samples(split.process(pcm(input.slice(0, half)))),
      ...samples(split.process(pcm(input.slice(half))))];
    assert.deepEqual(result, samples(whole));
    assert.ok(Math.abs(result.length - length * 24000 / rate) < 2);
  }
});

test("OpenAI live captions queue audio until a short-lived transcription session is ready", async () => {
  const statuses = [];
  const captions = [];
  const sent = [];
  let request;
  let url;
  let protocols;
  const socket = {
    readyState: 0, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: (value) => sent.push(JSON.parse(value)),
    close() { this.readyState = 3; },
  };
  const stream = new OpenAILiveCaptions("private-key", 16000,
    (text) => captions.push(text), (status) => statuses.push(status),
    async (target, init) => {
      request = { target, init };
      return new Response(JSON.stringify({ value: "ek_short_lived" }), { status: 200 });
    },
    (target, auth) => { url = target; protocols = auth; return socket; });
  assert.equal(stream.sendPcm(pcm(Array(160).fill(1000))), true);
  stream.commit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(request.target, "https://api.openai.com/v1/realtime/client_secrets");
  assert.equal(request.init.body.includes("gpt-live-transcribe"), true);
  assert.equal(request.init.body.includes("private-key"), false);
  assert.equal(url.includes("private-key"), false);
  assert.deepEqual(protocols, ["realtime", "openai-insecure-api-key.ek_short_lived"]);
  socket.readyState = 1;
  socket.onopen();
  assert.equal(sent[0].type, "session.update");
  socket.onmessage({ data: JSON.stringify({ type: "session.updated" }) });
  assert.deepEqual(sent.slice(1).map((event) => event.type),
    ["input_audio_buffer.append", "input_audio_buffer.commit"]);
  socket.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "Hel" }) });
  socket.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "lo" }) });
  socket.onmessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hello" }) });
  assert.deepEqual(captions, ["Hel", "Hello", "Hello"]);
  assert.deepEqual(statuses, ["connecting", "live"]);
  stream.close();
  assert.equal(socket.readyState, 3);
});

test("OpenAI session errors stop streaming and leave batch transcription available", async () => {
  const statuses = [];
  const stream = new OpenAILiveCaptions("private-key", 16000, () => {},
    (status) => statuses.push(status),
    async () => new Response("denied", { status: 401 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, ["connecting", "fallback"]);
  assert.equal(stream.sendPcm(pcm([1, 2])), false);
});
