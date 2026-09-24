import test from "node:test";
import assert from "node:assert/strict";
import { routeCallTurn, normalizeTurn, deepCallPrompt, shouldCancelAnswerForDecision } from "../src/lib/call/decision-router.ts";

const turn = (text, source = "system", endedAt = 10_000) => ({
  id: `call:${source}:1`, sessionId: "call", source, sequence: 1,
  startedAt: endedAt - 700, endedAt, text,
});

test("conservative router stays silent for social speech and ordinary statements", () => {
  for (const text of [
    "Hello everyone", "Thank you", "Can you hear me?", "How are you?",
    "Do you have any questions?", "We will discuss the project now",
    "I qualified for USAMO twice", "Okay, that sounds good",
    "I think we should move on", "What?", "Um",
  ]) {
    assert.equal(routeCallTurn(turn(text), "after_pause").action, "silence", text);
  }
});

test("question mode accepts explicit questions without punctuation but not instructions", () => {
  for (const text of [
    "What is the calibration set used for", "How did your experiment control for leakage",
    "Could you explain the result", "Is the model running locally",
    "Why did you choose this method?",
  ]) {
    assert.equal(routeCallTurn(turn(text), "on_question").action, "short_answer", text);
  }
  assert.equal(routeCallTurn(turn("Explain the experiment design"), "on_question").action, "silence");
});

test("questions and requests mode handles direct tasks without replying to every pause", () => {
  for (const text of [
    "Explain the experiment design", "Walk me through the proof",
    "Compare GPTQ and AWQ", "Summarize your main finding",
    "Help me understand the graph", "Solve this equation",
  ]) {
    const decision = routeCallTurn(turn(text), "after_pause");
    assert.equal(decision.action, "short_answer", text);
    assert.equal(decision.reason, "direct_request", text);
  }
  assert.equal(routeCallTurn(turn("We should solve this later"), "after_pause").action, "silence");
});

test("only a finalized answer-worthy turn cancels an in-flight answer", () => {
  const question = routeCallTurn(turn("What is the research question?"), "on_question");
  const statement = routeCallTurn(turn("We will review the proposal tomorrow"), "on_question");
  assert.equal(shouldCancelAnswerForDecision(question), true);
  assert.equal(shouldCancelAnswerForDecision(statement), false);
});

test("off, mic source, and recent successful repeat all abstain", () => {
  const question = turn("What is your research question?", "system", 20_000);
  assert.equal(routeCallTurn(question, "off").reason, "mode_off");
  assert.equal(routeCallTurn(turn(question.text, "mic", 20_000), "after_pause").reason, "mic_source");
  const lastAnswered = { normalizedText: normalizeTurn(question.text), endedAt: 10_000 };
  assert.equal(routeCallTurn(question, "after_pause", lastAnswered).reason, "repeat_answered");
  assert.equal(routeCallTurn(turn(question.text, "system", 50_001), "after_pause", lastAnswered).action, "short_answer");
});

test("deep answer prompt labels the result as a draft and requires real checks", () => {
  const prompt = deepCallPrompt("Base rules");
  assert.match(prompt, /step by step/i);
  assert.match(prompt, /This response is a draft/i);
  assert.match(prompt, /never describe it as checked/i);
  assert.match(prompt, /\[C:id\].*\[K:id\]/s);
});
