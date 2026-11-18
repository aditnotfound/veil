import test from "node:test";
import assert from "node:assert/strict";
import { formatCoreMemories, formatMemoryHits, parseMemoryImport } from "../src/lib/memory/format.ts";
import { buildCallMemorySnapshot, callMemoryInputs, parseCallMemory } from "../src/lib/memory/consolidate.ts";
import { chunkText } from "../src/lib/knowledge/chunk.ts";

test("memory import accepts JSON exports, bullet lists, and paragraphs", () => {
  assert.deepEqual(parseMemoryImport('[{"text":"Prefers short answers"},"Advisor is Prof. Rao", ""]'),
    ["Prefers short answers", "Advisor is Prof. Rao"]);
  assert.deepEqual(parseMemoryImport('{"memories":[{"content":"Works on ASR"}]}'), ["Works on ASR"]);
  assert.deepEqual(parseMemoryImport("- Likes ramen\n* Plays guitar\n1. Lives in Pune\n- likes ramen"),
    ["Likes ramen", "Plays guitar", "Lives in Pune"]);
  assert.deepEqual(parseMemoryImport("First paragraph\nstill first.\n\nSecond one."),
    ["First paragraph still first.", "Second one."]);
});

test("core memories respect the shared budget and recalled memories are labeled", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, text: "x".repeat(100) }));
  const core = formatCoreMemories(items);
  assert.ok(core.length < 1700);
  assert.ok(core.startsWith("## Core memory"));
  const hits = formatMemoryHits([{ id: "a", kind: "memory", sourceId: "", title: "", text: "Asked about sample size",
    layer: "call", memoryKind: "qa", origin: "call:s1", tags: "[]", updatedAt: Date.UTC(2026, 10, 10), pinned: false,
    score: 1, similarity: 0.6, relevance: 3, lexical: false }]);
  assert.match(hits, /\[M:a\] \(from a call, saved 2026-11-10 · qa\)/);
});

const utterance = (i, source, text) => ({ id: `u${i}`, sessionId: "s1", source, sequence: i, startedAt: 1000 + i, endedAt: 1001 + i, text });

test("call memory snapshots skip trivial calls and keep the opening of long ones", () => {
  assert.equal(buildCallMemorySnapshot([utterance(1, "system", "Hi there")]), null);
  const long = Array.from({ length: 400 }, (_, i) => utterance(i, i % 2 ? "mic" : "system", `Turn ${i} ${"words ".repeat(12)}`));
  const snapshot = buildCallMemorySnapshot(long);
  assert.ok(snapshot.length <= 14_500);
  assert.match(snapshot, /^System: Turn 0 /);
  assert.match(snapshot, /middle of the call omitted/);
  assert.match(snapshot, /Turn 399/);
});

test("call memory parsing is bounded and becomes dated call-layer memories", () => {
  const draft = parseCallMemory('```json\n{"summary":"Thesis check-in with Prof. Rao.","topics":["sample size"],"qa":[{"question":"Why 48 participants?","answer":"Budget limits."},{"question":"","answer":"x"}],"facts":["I run experiments on Fridays", 7],"followups":["Send revised draft by Dec 1"]}\n```');
  assert.equal(draft.qa.length, 1);
  assert.deepEqual(draft.facts, ["I run experiments on Fridays"]);
  const inputs = callMemoryInputs(draft, "s1", Date.UTC(2026, 10, 17));
  assert.deepEqual(inputs.map((input) => input.kind), ["episode", "qa", "fact", "followup"]);
  assert.ok(inputs.every((input) => input.layer === "call" && input.origin === "call:s1"));
  assert.match(inputs[1].text, /^Asked on 2026-11-17: Why 48 participants\? — You answered: Budget limits\.$/);
  assert.throws(() => parseCallMemory("no json here"));
});

test("chunks follow document sections and carry their heading", () => {
  const paper = ["Abstract", "We study speech.", "", "1 Introduction", "Speech matters.", "",
    "4.2 Results", "Accuracy was 91.2% on held-out data.", "", "Limitations", "Small sample of 48 people."].join("\n");
  const chunks = chunkText(paper);
  assert.deepEqual(chunks.map((chunk) => chunk.split("\n")[0]), ["[Abstract]", "[1 Introduction]", "[4.2 Results]", "[Limitations]"]);
  assert.match(chunks[2], /91\.2%/);
  const long = chunkText("Sentence one is here. ".repeat(300));
  assert.ok(long.length > 1 && long.every((chunk) => chunk.length <= 1420));
});
