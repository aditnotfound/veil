// Opt-in live check: OPENAI_API_KEY=... node scripts/check_prompter_stream.mjs audio.wav script.txt
// Use a synthetic fixture or audio you are authorized to send. No audio/text/keys are logged.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { OpenAILiveCaptions } from "../src/lib/call/openai-live-captions.ts";
import { advanceScriptCursor, scriptWords } from "../src/lib/prompter/follow-script.ts";

if (!process.env.OPENAI_API_KEY || !process.argv[2] || !process.argv[3]) {
  throw new Error("Provide OPENAI_API_KEY and paths to a PCM WAV and its script text.");
}
const wav = readFileSync(process.argv[2]);
const words = scriptWords(readFileSync(process.argv[3], "utf8"));
let format;
let audio;
for (let offset = 12; offset + 8 <= wav.length;) {
  const kind = wav.toString("ascii", offset, offset + 4);
  const size = wav.readUInt32LE(offset + 4);
  const start = offset + 8;
  if (kind === "fmt ") format = { codec: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
  if (kind === "data") audio = wav.subarray(start, start + size);
  offset = start + size + size % 2;
}
if (!format || format.codec !== 1 || format.channels !== 1 || format.bits !== 16 || !audio?.length) {
  throw new Error("Fixture must be mono PCM16 WAV.");
}
let status = "connecting";
let previous = "";
let cursor = 0;
let startTime;
let firstCaptionMs = null;
let committed = false;
let preCommitUpdates = 0;
const matchingTimes = [];
const stream = new OpenAILiveCaptions(process.env.OPENAI_API_KEY, format.rate, (caption) => {
  if (firstCaptionMs === null) firstCaptionMs = Math.round(performance.now() - startTime);
  if (!committed) preCommitUpdates++;
  const start = performance.now();
  cursor = advanceScriptCursor(words, cursor, previous, caption);
  matchingTimes.push(performance.now() - start);
  previous = caption;
}, (value) => { status = value; }, fetch, undefined, { delay: "minimal" });
try {
  for (let i = 0; status === "connecting" && i < 150; i++) await sleep(100);
  if (status !== "live") throw new Error("Transcription connection failed.");
  startTime = performance.now();
  const frameBytes = Math.floor(format.rate / 10) * 2;
  for (let offset = 0; offset < audio.length; offset += frameBytes) {
    const frame = audio.subarray(offset, offset + frameBytes);
    if (!stream.sendPcm(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength))) throw new Error("Audio stream failed.");
    await sleep(Math.max(0, startTime + (offset + frame.length) / format.rate / 2 * 1000 - performance.now()));
  }
  committed = true;
  stream.commit();
  for (let i = 0; status === "live" && cursor < words.length && i < 80; i++) await sleep(100);
  const result = {
    fixture: "synthetic or user-supplied audio, not a microphone test",
    audioDurationMs: Math.round(audio.length / format.rate / 2 * 1000),
    firstCaptionMs, preCommitUpdates, wordsFollowed: cursor, scriptWords: words.length,
    maxLocalMatchingMs: Number(Math.max(0, ...matchingTimes).toFixed(2)), status,
  };
  console.log(JSON.stringify(result, null, 2));
  if (status !== "live" || preCommitUpdates === 0 || cursor !== words.length) process.exitCode = 1;
} finally {
  stream.close();
}
