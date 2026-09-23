import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSessionLedgerEntries,
  selectSessionLedgerEntries,
  formatSessionLedgerEvidence,
} from "../src/lib/call/session-ledger.ts";

const turn = (id, text, source = "system", startedAt = 1_000) => ({
  id, sessionId: "call", source, sequence: Number(id.replace(/\D/g, "")) || 1,
  startedAt, endedAt: startedAt + 500, text,
});

test("ledger derives only source-linked candidate excerpts", () => {
  const entries = deriveSessionLedgerEntries(turn(
    "turn1", "We decided to use model B with 32 layers, and I will send it tomorrow."
  ));
  assert.deepEqual(entries.map(({ kind }) => kind), ["number", "decision", "commitment"]);
  assert.ok(entries.every(({ sourceUtteranceId, excerpt }) =>
    sourceUtteranceId === "turn1" && excerpt.includes("model B")
  ));
  assert.deepEqual(
    deriveSessionLedgerEntries(turn("turn2", "How many samples were held out?"))
      .map(({ kind }) => kind),
    ["unresolved_question"]
  );
});

test("ledger selection excludes current and recent turns and keeps source markers", () => {
  const turns = [
    turn("turn1", "The calibration set has 48 artifacts.", "mic", 1_000),
    turn("turn2", "We decided to rerun the control.", "system", 2_000),
    turn("turn3", "What was the earlier sample count?", "system", 3_000),
  ];
  const entries = selectSessionLedgerEntries(turns, "turn3", ["turn2"]);
  assert.deepEqual([...new Set(entries.map(({ sourceUtteranceId }) => sourceUtteranceId))], ["turn1"]);
  const evidence = formatSessionLedgerEvidence(entries);
  assert.match(evidence, /candidate session ledger/i);
  assert.match(evidence, /\[C:turn1\]/);
  assert.match(evidence, /not verified facts/i);
  assert.doesNotMatch(evidence, /turn2/);
  assert.doesNotMatch(evidence, /turn3/);
});

test("ordinary short speech produces no ledger candidate", () => {
  assert.deepEqual(deriveSessionLedgerEntries(turn("turn1", "Okay, thank you.")), []);
});
