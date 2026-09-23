import test from "node:test";
import assert from "node:assert/strict";
import { buildJevShadowRequest, JEV_SHADOW_ENDPOINT, JEV_SHADOW_MODEL, requestJevShadow } from "../src/lib/call/jev-shadow.ts";

const turn = {
  id: "call:system:2", sessionId: "call", source: "system", sequence: 2,
  startedAt: 1000, endedAt: 2000, text: "Can you explain the method?",
};

test("JEV shadow sends bounded, typed choices and validates the choice", async () => {
  const body = buildJevShadowRequest(turn, "on_question", [
    { content: "old" }, { content: "one" }, { content: "two" },
    { content: "three" }, { content: "four" },
  ], null);
  const state = JSON.parse(body.state);
  assert.deepEqual(state.recent, ["one", "two", "three", "four"]);
  assert.equal(JEV_SHADOW_ENDPOINT, "https://api.typesafe.ai/v1/systemone");
  assert.equal(JEV_SHADOW_MODEL, "jev-latest");
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(Object.keys(body.questions.action.criteria), ["silence", "short_answer"]);
  const result = await requestJevShadow(body, "test-only-key", async (url, init) => {
    assert.equal(url, JEV_SHADOW_ENDPOINT);
    assert.equal(init.headers.Authorization, "Bearer test-only-key");
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: { action: { type: "choice", choice: "short_answer", confidence: 0.8, probabilities: { silence: 0.2, short_answer: 0.8 } } }, usage: { input_tokens: 100, output_tokens: 1 } }), { status: 200 });
  });
  assert.equal(result.status, "valid");
  assert.equal(result.choice, "short_answer");
  assert.equal(result.confidence, 0.8);
});

test("malformed and failed JEV responses never produce a usable choice", async () => {
  const body = buildJevShadowRequest(turn, "after_pause", [], null);
  const malformed = await requestJevShadow(body, "test-only-key", async () =>
    new Response(JSON.stringify({ answers: { action: { type: "choice", choice: "delete_everything" } } }), { status: 200 }));
  assert.equal(malformed.status, "invalid");
  assert.equal(malformed.choice, null);
  const wrongType = await requestJevShadow(body, "test-only-key", async () =>
    new Response(JSON.stringify({ answers: { action: { type: "score", choice: "silence" } } }), { status: 200 }));
  assert.equal(wrongType.status, "invalid");
  const failed = await requestJevShadow(body, "test-only-key", async () => new Response("", { status: 429 }));
  assert.equal(failed.status, "http_error");
  assert.equal(failed.choice, null);
});

test("JEV deadline and user cancellation stay bounded even if transport ignores abort", async () => {
  const body = buildJevShadowRequest(turn, "after_pause", [], null);
  const never = async () => new Promise(() => {});
  const timed = await requestJevShadow(body, "test-only-key", never, undefined, 10);
  assert.equal(timed.status, "timeout");
  const controller = new AbortController();
  controller.abort();
  const canceled = await requestJevShadow(body, "test-only-key", async (_, init) => {
    if (init.signal.aborted) throw new Error("aborted");
    return new Response("{}", { status: 200 });
  }, controller.signal);
  assert.equal(canceled.status, "canceled");
  const laterController = new AbortController();
  const pending = requestJevShadow(body, "test-only-key", never, laterController.signal, 1_000);
  setTimeout(() => laterController.abort(), 10);
  const canceledWithIgnoringTransport = await pending;
  assert.equal(canceledWithIgnoringTransport.status, "canceled");
  assert.ok(canceledWithIgnoringTransport.latencyMs < 100);
});
