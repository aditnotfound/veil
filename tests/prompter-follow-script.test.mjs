import test from "node:test";
import assert from "node:assert/strict";
import { advanceScriptCursor, fitScriptLines, scriptLines, scriptWords } from "../src/lib/prompter/follow-script.ts";

test("prompter follows cumulative live words without replaying old captions", () => {
  const words = scriptWords("Good evening everyone. Today we explain the new result.");
  const first = advanceScriptCursor(words, 0, "", "Good evening");
  assert.equal(first, 2);
  assert.equal(advanceScriptCursor(words, first, "Good evening", "Good evening everyone today"), 4);
  assert.equal(advanceScriptCursor(words, 4, "Good evening everyone today", "Good evening everyone today"), 4);
});

test("follows missed and misheard words once the following phrase establishes position", () => {
  const words = scriptWords("We use gradient descent to minimize the loss on our training data.");
  let cursor = advanceScriptCursor(words, 0, "", "we use");
  assert.equal(cursor, 2);
  cursor = advanceScriptCursor(words, cursor, "we use", "we use radiant decent to minimize");
  assert.equal(cursor, 6);
  cursor = advanceScriptCursor(words, cursor, "we use radiant decent to minimize", "we use radiant decent to minimize loss our training data");
  assert.equal(cursor, words.length);
});

test("handles fillers, repetitions and typo corrections without jumping repeated passages", () => {
  const words = scriptWords("Today we explain validation. Today we explain validation. Then we deploy safely.");
  const first = "today we um we explain validation";
  let cursor = advanceScriptCursor(words, 0, "", first);
  assert.equal(cursor, 4);
  const corrected = "Today we explain validation.";
  cursor = advanceScriptCursor(words, cursor, first, corrected);
  assert.equal(cursor, 4);
  cursor = advanceScriptCursor(words, cursor, corrected, corrected + " today we explain validation");
  assert.equal(cursor, 8);
  assert.equal(advanceScriptCursor(words, cursor, corrected + " today we explain validation", corrected + " today we explain validation"), 8);
});

test("anchors across separate word deltas after an omitted phrase", () => {
  const words = scriptWords("We built an early prototype before testing. Separate validation data prevents leakage.");
  let before = "";
  let cursor = 0;
  for (const caption of ["Separate", "Separate validation", "Separate validation data", "Separate validation data prevents leakage"]) {
    cursor = advanceScriptCursor(words, cursor, before, caption);
    before = caption;
  }
  assert.equal(cursor, words.length);
});

test("common words and unrelated speech do not skip ahead, and partial words wait", () => {
  const words = scriptWords("Feature selection belongs inside every fold. This protects the model from leakage in the training set.");
  assert.equal(advanceScriptCursor(words, 0, "", "in the"), 0);
  assert.equal(advanceScriptCursor(words, 0, "", "Can you turn the music off please"), 0);
  assert.equal(advanceScriptCursor(words, 0, "", "Featur"), 0);
  assert.equal(advanceScriptCursor(words, 0, "Featur", "Feature selection"), 2);
});

test("rejoins within the next paragraph using several informative words", () => {
  const words = scriptWords("First we discuss a long introduction about building and testing software with our team every morning.\nGradient clipping prevents exploding gradients during training.");
  assert.equal(advanceScriptCursor(words, 0, "", "Gradient clipping prevents exploding gradients"), words.length - 2);
  assert.equal(advanceScriptCursor(words, 10, "", "a long introduction"), 10);
});

test("pixel-based lines fit variable-width text and preserve every word on resize", () => {
  const words = scriptWords("WWW iii WWW iii iii iii.\nNext paragraph stays separate.");
  const measure = (text) => [...text].reduce((width, char) => width + (char === "W" ? 16 : 4), 0);
  for (const width of [100, 220, 500]) {
    const lines = fitScriptLines(words, width, measure, 4);
    assert.equal(lines.flatMap(({ start, end }) => words.slice(start, end)).length, words.length);
    assert.ok(lines.some(({ start }) => words[start].text === "Next"));
    for (const { start, end } of lines) {
      const used = words.slice(start, end).reduce((sum, word) => sum + measure(word.text), 0) + (end - start - 1) * 4;
      assert.ok(used <= width || end - start === 1);
    }
  }
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
