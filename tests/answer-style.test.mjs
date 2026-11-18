import test from "node:test";
import assert from "node:assert/strict";
import { createSourceMarkerFilter, stripSourceMarkers } from "../src/lib/functions/source-markers.ts";
import { buildVoicePrompt, normalizeVoice } from "../src/lib/voice.ts";

test("internal source labels never reach the answer", () => {
  assert.equal(stripSourceMarkers("We used 48 people [K:3f2a-91]."), "We used 48 people.");
  assert.equal(stripSourceMarkers("Budget limits ([M:abc], [C:turn-4])."), "Budget limits.");
  assert.equal(stripSourceMarkers("It held up [K:1][K:2] across runs."), "It held up across runs.");
  assert.equal(stripSourceMarkers("Per my notes [P:profile], I lead it."), "Per my notes, I lead it.");
  assert.equal(stripSourceMarkers("See [the docs](https://x.dev) and the range [0, 1]."), "See [the docs](https://x.dev) and the range [0, 1].");
});

test("labels split across streamed chunks are still removed", () => {
  const stream = (chunks) => {
    const filter = createSourceMarkerFilter();
    return chunks.map((chunk) => filter.push(chunk)).join("") + filter.flush();
  };
  assert.equal(stream(["Accuracy was 91% ", "[K:", "abc-12", "] on held-out data."]), "Accuracy was 91% on held-out data.");
  assert.equal(stream(["Because of budget (", "[M:9f", "])", ". Next."]), "Because of budget. Next.");
  assert.equal(stream(["An array like [1, 2", ", 3] works."]), "An array like [1, 2, 3] works.");
  assert.equal(stream(["Unclosed [ bracket at the end"]), "Unclosed [ bracket at the end");
});

test("voice prompt asks for prose, adaptive length, and puts the user's samples first", () => {
  const plain = buildVoicePrompt(normalizeVoice({}));
  assert.match(plain, /No bullet points/);
  assert.match(plain, /Choose the length yourself/);
  assert.match(plain, /em dashes/);
  assert.doesNotMatch(plain, /samples/i);
  const live = buildVoicePrompt(normalizeVoice({ style: " short, dry ", samples: "yeah so I just ran it twice" }), true);
  assert.match(live, /first person as the user/);
  assert.match(live, /"short, dry"/);
  assert.match(live, /<samples>\nyeah so I just ran it twice\n<\/samples>/);
  assert.match(live, /follow the user/);
  assert.equal(normalizeVoice({ samples: "x".repeat(5000) }).samples.length, 4000);
});
