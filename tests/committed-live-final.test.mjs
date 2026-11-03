import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAILiveCaptions } from '../src/lib/call/openai-live-captions.ts';

async function setup() {
  const socket = { readyState: 1, bufferedAmount: 0, send() {}, close() {},
    onopen: null, onmessage: null, onclose: null, onerror: null };
  const stream = new OpenAILiveCaptions('test', 16000, () => {}, () => {},
    async () => new Response(JSON.stringify({ value: 'ek_test' })), () => socket);
  await new Promise(resolve => setImmediate(resolve));
  const event = data => socket.onmessage({ data: JSON.stringify(data) });
  event({ type: 'session.updated' });
  const ack = id => event({ type: 'input_audio_buffer.committed', item_id: id });
  const final = (id, text) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
  return { stream, ack, final, event };
}

test('final transcripts follow commit identities even when completion order reverses', async () => {
  const {stream, ack, final} = await setup();
  const first = stream.commitFinal(), second = stream.commitFinal();
  ack('a'); ack('a'); ack('b'); final('b', 'second question'); final('a', 'first question');
  assert.equal((await first).text, 'first question');
  assert.equal((await second).text, 'second question');
  stream.close();
});

test('a final received before acknowledgment survives display reset', async () => {
  const {stream, ack, final} = await setup();
  const result = stream.commitFinal();
  final('a', 'complete question'); stream.resetDisplay(); ack('a');
  assert.equal((await result).text, 'complete question');
  stream.close();
});

test('a timeout retains its queue position instead of stealing the next result', async () => {
  const {stream, ack, final} = await setup();
  const expired = stream.commitFinal(5);
  assert.equal(await expired, null);
  const next = stream.commitFinal();
  ack('old'); ack('new'); final('old', 'stale'); final('new', 'new question');
  assert.equal((await next).text, 'new question');
  stream.close();
});

test('discarded commits and session close cannot leak into another final', async () => {
  const {stream, ack, final} = await setup();
  stream.discard();
  const result = stream.commitFinal();
  ack('noise'); ack('question'); final('noise', 'noise'); final('question', 'valid');
  assert.equal((await result).text, 'valid');
  const pending = stream.commitFinal(); stream.close();
  assert.equal(await pending, null);
});

test('provider failure and queue overflow settle pending finals instead of hanging', async () => {
  const one = await setup();
  const pending = one.stream.commitFinal();
  one.event({ type: 'error' });
  assert.equal(await pending, null);
  const two = await setup();
  const requests = Array.from({ length: 65 }, () => two.stream.commitFinal());
  assert.ok((await Promise.all(requests)).every(value => value === null));
  two.stream.close();
});
