import test from "node:test";
import assert from "node:assert/strict";
import { buildFtsQuery, buildCallSearchQuery, formatCallEvidence } from "../src/lib/call/local-search.ts";

test("speech becomes bounded FTS terms without raw MATCH operators", () => {
  assert.equal(buildFtsQuery('What did we agree on for calibration?'), '"agree"* OR "calibration"*');
  const hostile = buildFtsQuery('" OR call_utterances_fts MATCH * --');
  assert.ok(!hostile.includes(' --'));
  assert.ok(!hostile.includes(' MATCH '));
  assert.equal(buildFtsQuery('??? and the'), '');
  assert.ok(buildFtsQuery('alpha beta gamma', 2).split(' OR ').length === 2);
});

test("call search has parameterized pivot and bounded recent exclusions", () => {
  const plan = buildCallSearchQuery('private-session-key', 'October agreement', 'pivot', ['one', 'two'], 500);
  assert.ok(plan);
  assert.equal(plan.args.at(-1), 8);
  assert.deepEqual(plan.args.slice(1, 4), ['private-session-key', 'one', 'two']);
  assert.ok(!plan.sql.includes('October agreement'));
  assert.ok(!plan.sql.includes('private-session-key'));
  assert.equal(buildCallSearchQuery('session', 'the and'), null);
  assert.equal(buildCallSearchQuery('session', 'October', undefined, [], Number.NaN)?.args.at(-1), 4);
});

test("retrieved call evidence remains source-linked and capped", () => {
  const turns = Array.from({ length: 8 }, (_, i) => ({
    id: `turn-${i}`, source: i % 2 ? 'system' : 'mic', text: 'a'.repeat(600),
  }));
  const evidence = formatCallEvidence(turns);
  assert.ok(evidence.includes('[C:turn-0] You:'));
  assert.ok(evidence.includes('[C:turn-1] Call audio:'));
  assert.ok(!evidence.includes('[C:turn-4]'));
  assert.ok(evidence.length < 2000);
});
