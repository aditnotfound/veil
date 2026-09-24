import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableAnswer } from "../src/lib/call/answer-result.ts";

test("empty provider streams are not treated as visible answers", () => {
  assert.equal(hasUsableAnswer(""), false);
  assert.equal(hasUsableAnswer("  \n\t"), false);
  assert.equal(hasUsableAnswer("A streamed answer"), true);
});
