import test from "node:test";
import assert from "node:assert/strict";
import { applyJevAssist, routeCallTurn, routeSequencedSystemTurn, normalizeTurn, deepCallPrompt, shouldCancelAnswerForDecision } from "../src/lib/call/decision-router.ts";

const turn = (text, source = "system", endedAt = 10_000) => ({
  id: `call:${source}:1`, sessionId: "call", source, sequence: 1,
  startedAt: endedAt - 700, endedAt, text,
});

test("JEV rescues only current ambiguous turns with a confident positive decision", () => {
  const ambiguous = routeCallTurn(turn("Perhaps you could walk me through the cache failure"), "after_pause");
  assert.equal(ambiguous.reason, "not_a_request");
  const positive = { status: "valid", choice: "short_answer", confidence: 0.9 };
  assert.deepEqual(applyJevAssist(ambiguous, positive, true), {
    action: "short_answer", reason: "jev_assist", utteranceId: ambiguous.utteranceId,
  });
  for (const result of [
    { ...positive, confidence: 0.84 },
    { ...positive, confidence: null },
    { ...positive, choice: "silence" },
    { ...positive, status: "timeout" },
  ]) assert.deepEqual(applyJevAssist(ambiguous, result, true), ambiguous);
  assert.deepEqual(applyJevAssist(ambiguous, positive, false), ambiguous);
  for (const text of ["Hello everyone", "What is a cache miss?"]) {
    const decision = routeCallTurn(turn(text), "after_pause");
    assert.deepEqual(applyJevAssist(decision, positive, true), decision);
  }
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

test("punctuation-free questions survive short conversational lead-ins", () => {
  for (const text of [
    "So why did the cache miss", "Okay but how does hashing work",
    "Right what is the fallback plan", "And can we deploy this by Friday",
  ]) {
    const decision = routeCallTurn(turn(text), "on_question");
    assert.equal(decision.action, "short_answer", text);
    assert.equal(decision.reason, "explicit_question", text);
  }
  assert.equal(routeCallTurn(turn("Well explain the failure"), "on_question").action, "silence");
  assert.equal(routeCallTurn(turn("Well explain the failure"), "after_pause").reason, "direct_request");
  for (const text of [
    "So do you have any questions", "Okay how are you", "Well I will send the file tomorrow",
    "But what makes this program different is its mentoring structure",
    "Okay what I mean is that the cache needs a reset",
  ]) {
    assert.equal(routeCallTurn(turn(text), "after_pause").action, "silence", text);
  }
});

test("context phrases before a spoken question do not hide the question", () => {
  for (const text of [
    "In Python, why is a mutable default list risky",
    "In Python, y is a mutable list as a default argument risky.",
    "For this algorithm, how can we reduce the memory use",
    "Regarding the cache, what happens on a miss",
  ]) {
    assert.equal(routeCallTurn(turn(text), "on_question").reason, "explicit_question", text);
  }
  assert.equal(routeCallTurn(turn("In Python, y is a mutable list"), "on_question").reason, "not_a_request");
  assert.equal(routeCallTurn(turn("In Python, y is an important variable"), "on_question").reason, "not_a_request");
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

test("out-of-order trailing speech does not suppress an earlier question", () => {
  const trailing = { ...turn("Please give the number only"), id: "call:system:3", sequence: 3 };
  const question = { ...turn("What is 5 plus 6?"), id: "call:system:2", sequence: 2 };
  assert.equal(routeSequencedSystemTurn(trailing, "after_pause", null, 0).action, "silence");
  assert.equal(routeSequencedSystemTurn(question, "after_pause", null, 0).action, "short_answer");

  const newerQuestion = { ...turn("What is 8 plus 9?"), id: "call:system:3", sequence: 3 };
  assert.equal(routeSequencedSystemTurn(newerQuestion, "after_pause", null, 0).action, "short_answer");
  assert.deepEqual(routeSequencedSystemTurn(question, "after_pause", null, 3), {
    action: "silence", reason: "superseded", utteranceId: question.id,
  });
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
