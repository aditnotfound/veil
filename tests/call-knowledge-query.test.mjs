import test from "node:test";
import assert from "node:assert/strict";
import { callKnowledgeQuery } from "../src/lib/call/knowledge-query.ts";
import { buildFtsQuery } from "../src/lib/call/local-search.ts";

test("short ambiguous follow-up retrieves using recent spoken topic", () => {
  const history = [{ content: "System: Tell me about the heliotrope launch" },
    { content: "Mic: The heliotrope launch freeze is Tuesday" }];
  const query = callKnowledgeQuery("Why was that?", history);
  assert.match(buildFtsQuery(query), /heliotrope/);
  assert.match(query, /launch freeze/);
  assert.doesNotMatch(query, /System:|Mic:/);
});

test("ordinary questions do not inherit unrelated history, and context is bounded", () => {
  const history = [{ content: "System: " + "x".repeat(1000) }, { content: "Mic: " + "y".repeat(1000) }, { content: "System: " + "z".repeat(1000) }];
  assert.equal(callKnowledgeQuery("What is a B tree index?", history), "What is a B tree index?");
  const query = callKnowledgeQuery("How does that work?", history);
  assert.ok(query.length <= 800);
  assert.doesNotMatch(query, /x{30}/);
  assert.equal(callKnowledgeQuery("Why that?", [{ content: [{ type: "image" }] }]), "Why that?");
});
