import { readFileSync } from "node:fs";
import { evaluateRouter } from "../src/lib/call/evaluate-router.ts";

const [file, mode = "after_pause"] = process.argv.slice(2);
if (!file || !["off", "on_question", "after_pause"].includes(mode)) {
  console.error("Usage: node scripts/evaluate_call_router.mjs LABELED_REPLAY.json [off|on_question|after_pause]");
  process.exit(2);
}
try {
  const corpus = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(corpus.sessions)) throw new Error("Missing sessions array");
  const result = evaluateRouter(corpus.sessions, mode);
  console.log(JSON.stringify({ mode, ...result }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
