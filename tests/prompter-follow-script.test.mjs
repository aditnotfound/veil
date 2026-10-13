import test from "node:test";
import assert from "node:assert/strict";
import { advanceScriptCursor, scriptLines, scriptWords } from "../src/lib/prompter/follow-script.ts";

test("prompter follows cumulative live words without replaying old captions", () => {
  const words = scriptWords("Good evening everyone. Today we explain the new result.");
  const first = advanceScriptCursor(words, 0, "", "Good evening");
  assert.equal(first, 2);
  assert.equal(advanceScriptCursor(words, first, "Good evening", "Good evening everyone today"), 4);
  assert.equal(advanceScriptCursor(words, 4, "Good evening everyone today", "Good evening everyone today"), 4);
});

test("prompter can rejoin after a skipped phrase but ignores unrelated speech", () => {
  const words = scriptWords("The model uses training data. We then evaluate on a separate test set.");
  assert.equal(advanceScriptCursor(words, 0, "", "noise from someone else"), 0);
  assert.equal(advanceScriptCursor(words, 0, "", "We then evaluate"), 8);
});

test("prompter handles corrected interim captions and wraps paragraphs into reading lines", () => {
  const words = scriptWords("Feature selection belongs inside each training fold.\nThen test on untouched data.");
  assert.equal(advanceScriptCursor(words, 0, "Featur", "Feature selection"), 2);
  const lines = scriptLines(words, 35);
  assert.ok(lines.length >= 2);
  assert.equal(lines.flatMap(({ start, end }) => words.slice(start, end)).length, words.length);
  assert.ok(lines.some(({ start }) => words[start].text === "Then"));
});
