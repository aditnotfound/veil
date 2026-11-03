import test from "node:test";
import assert from "node:assert/strict";
import { persistCallDerivedData } from "../src/lib/call/persist-derived.ts";

test("independent ledger and decision writes start together and both finish before continuing", async () => {
  const started = [];
  let finishLedger;
  let finishDecision;
  const ledger = new Promise(resolve => { finishLedger = resolve; });
  const decision = new Promise(resolve => { finishDecision = resolve; });
  let settled = false;
  const pending = persistCallDerivedData(
    () => { started.push("ledger"); return ledger; },
    () => { started.push("decision"); return decision; },
  ).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.deepEqual(started, ["ledger", "decision"]);
  finishDecision();
  await Promise.resolve();
  assert.equal(settled, false);
  finishLedger();
  assert.deepEqual((await pending).map(result => result.status), ["fulfilled", "fulfilled"]);
});

test("failure of one derived write does not suppress the other", async () => {
  let decisionSaved = false;
  const [ledger, decision] = await persistCallDerivedData(
    () => { throw new Error("ledger unavailable"); },
    async () => { decisionSaved = true; },
  );
  assert.equal(ledger.status, "rejected");
  assert.equal(decision.status, "fulfilled");
  assert.equal(decisionSaved, true);
});
