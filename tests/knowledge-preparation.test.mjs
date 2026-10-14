import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREPARATION, normalizePreparation, formatPreparation, selectKnowledgeExcerpts, formatKnowledgeExcerpts } from "../src/lib/knowledge/preparation.ts";
import { resolveAnswerContext } from "../src/lib/knowledge/answer-context.ts";

const profile = { ...EMPTY_PREPARATION, aboutYou: "I build database tools.", brief: "Discuss deployment trade-offs.", updatedAt: 1000 };
const options = { isEnabled: () => true, loadCurrent: async () => "today's profile", search: async () => "reference" };

test("background is bounded, validated, and empty by default", () => {
  assert.equal(formatPreparation(EMPTY_PREPARATION), "");
  const prep = normalizePreparation({ aboutYou: "x".repeat(6000), audience: 42, updatedAt: 1e30 });
  assert.equal(prep.aboutYou.length, 3000);
  assert.equal(prep.audience, "");
  assert.equal(prep.updatedAt, 0);
  assert.doesNotThrow(() => formatPreparation(prep));
});

test("background and brief have independent inclusion controls and source markers", () => {
  assert.equal(formatPreparation(profile, false), "");
  const both = formatPreparation(profile);
  assert.match(both, /\[P:profile\]/); assert.match(both, /\[P:brief\]/);
  assert.match(both, /not independently verified/);
  const brief = formatPreparation({ ...profile, useProfile: false });
  assert.ok(!brief.includes("database tools"));
  assert.ok(brief.includes("deployment"));
  assert.equal(formatPreparation({ ...profile, useProfile: false, useBrief: false }), "");
});

test("Listen uses its starting snapshot and old empty sessions do not inherit today's profile", async () => {
  let loads = 0;
  const loadCurrent = async () => { loads++; return "wrong profile"; };
  const frozen = await resolveAnswerContext({ ...options, loadCurrent, preparedContext: "original profile" });
  assert.equal(frozen.context, "original profile\n\nreference");
  const empty = await resolveAnswerContext({ ...options, loadCurrent, preparedContext: "" });
  assert.equal(empty.context, "reference"); assert.equal(loads, 0);
});

test("Ask receives current background even with no keyword match", async () => {
  const result = await resolveAnswerContext({ ...options, search: async () => "" });
  assert.equal(result.context, "today's profile"); assert.equal(result.failed, false);
});

test("knowledge off and utility calls never load or search personal data", async () => {
  const unexpected = async () => { throw new Error("must not run"); };
  for (const override of [{ isEnabled: () => false }, { mode: "none" }]) {
    assert.deepEqual(await resolveAnswerContext({ ...options, loadCurrent: unexpected, search: unexpected, preparedContext: "private", ...override }), { context: "", failed: false });
  }
});

test("turning knowledge off during retrieval prevents attachment to the answer", async () => {
  let enabled = true;
  assert.deepEqual(await resolveAnswerContext({ ...options, isEnabled: () => enabled, search: async () => { enabled = false; return "private"; } }), { context: "", failed: false });
});

test("failed search retains explicit background and discloses missing retrieval", async () => {
  const result = await resolveAnswerContext({ ...options, search: async () => { throw new Error("db offline"); } });
  assert.equal(result.failed, true); assert.match(result.context, /today's profile/); assert.match(result.context, /search failed/);
});

test("failed background does not discard available library evidence", async () => {
  const result = await resolveAnswerContext({ ...options, loadCurrent: async () => { throw new Error("invalid saved JSON"); } });
  assert.equal(result.failed, true); assert.match(result.context, /could not be loaded/); assert.match(result.context, /reference/);
});

const row = (id, source = id, tags = "[]") => ({ id, source_id: source, title: "Source", content: "evidence ".repeat(150), tags, updated_at: 1000, pinned: 0 });
test("pins survive no search match, focus tags prefer without excluding, and duplicates are bounded", () => {
  const pin = { ...row("p"), pinned: 1 };
  assert.deepEqual(selectKnowledgeExcerpts([pin], [], []), [pin]);
  const matches = [row("a", "same"), row("b", "same"), row("c", "same"), row("focus", "f", '["work"]'), pin, ...Array.from({length: 10}, (_, i) => row(`rest-${i}`))];
  const selected = selectKnowledgeExcerpts([pin], matches, ["work"]);
  assert.equal(selected.length, 7); assert.equal(selected[0].id, "p"); assert.equal(selected[1].id, "focus");
  assert.equal(selected.filter((r) => r.source_id === "same").length, 2);
  assert.equal(new Set(selected.map((r) => r.id)).size, selected.length);
});

test("library evidence is dated, cited, and kept within an answer context budget", () => {
  const formatted = formatKnowledgeExcerpts(Array.from({length: 20}, (_, i) => row(`item-${i}`)));
  assert.match(formatted, /\[K:item-0\]/); assert.match(formatted, /updated 1970-01-01/);
  assert.ok(!formatted.includes("[K:item-7]")); assert.ok(formatted.length < 6000);
  assert.match(formatted, /not proof a fact is still current/);
});
