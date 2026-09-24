import test from "node:test";
import assert from "node:assert/strict";
import { applyLiveAnswerProfile } from "../src/lib/call/live-answer-profile.ts";

test("short OpenAI GPT-6 call cards use low effort", () => {
  for (const model of ["gpt-6-astra"]) {
    const body = { model, messages: [] };
    applyLiveAnswerProfile(body, "openai", "live-short");
    assert.equal(body.reasoning_effort, "low");
  }
});

test("latency-critical GPT-6 Sol and Luna cards disable extra reasoning", () => {
  for (const model of ["gpt-6-sol", "gpt-6-luna", "gpt-6-sol-mini"]) {
    const body = { model, messages: [] };
    applyLiveAnswerProfile(body, "openai", "live-short");
    assert.equal(body.reasoning_effort, "none");
  }
});

test("deep answers, other models, custom providers and explicit settings remain unchanged", () => {
  for (const [provider, profile, model] of [
    ["openai", "deep", "gpt-6-sol"],
    ["openai", "default", "gpt-6-sol"],
    ["openai", "live-short", "gpt-4o"],
    ["custom-openai", "live-short", "gpt-6-sol"],
  ]) {
    const body = { model, messages: [] };
    applyLiveAnswerProfile(body, provider, profile);
    assert.equal(body.reasoning_effort, undefined);
  }
  const explicit = { model: "gpt-6-sol", reasoning_effort: "high" };
  applyLiveAnswerProfile(explicit, "openai", "live-short");
  assert.equal(explicit.reasoning_effort, "high");
});
