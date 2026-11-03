import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { routeCallTurn, ROUTER_VERSION } from "../src/lib/call/decision-router.ts";

const input = process.argv[3] ?? new URL("../tests/fixtures/listen-realistic-cases.json", import.meta.url);
const corpus = JSON.parse(readFileSync(input, "utf8"));
const cases = corpus.cases.map((item, i) => {
  const turn = { id: item.id, sessionId: item.id, source: item.source ?? "system", sequence: 2,
    startedAt: 20000, endedAt: 22000, text: item.text };
  const started = performance.now();
  const previousAnswer = item.previousAnswer ? { normalizedText: "previous answered question", endedAt: 19000 } : null;
  const decision = routeCallTurn(turn, "after_pause", previousAnswer);
  return { ...item, actual: decision.action !== "silence", reason: decision.reason,
    correct: (decision.action !== "silence") === item.answer, routerMs: performance.now() - started };
});
const tp = cases.filter(x => x.answer && x.actual).length;
const fp = cases.filter(x => !x.answer && x.actual).length;
const fn = cases.filter(x => x.answer && !x.actual).length;
const report = { routerVersion: ROUTER_VERSION, description: corpus.description, mode: "after_pause",
  total: cases.length, truePositive: tp, falsePositive: fp, falseNegative: fn,
  precision: tp / (tp + fp), recall: tp / (tp + fn),
  timingScope: "Local routing only; excludes audio capture, STT, retrieval, model generation and visible rendering.", cases };
const output = JSON.stringify(report, null, 2) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], output);
console.log(JSON.stringify({ ...report, cases: cases.filter(x => !x.correct) }, null, 2));
