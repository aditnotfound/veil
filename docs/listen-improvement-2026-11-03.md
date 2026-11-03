# Automatic Listen improvement measurements

Goal: improve relevance, personal grounding and speed. Ordinary first-useful-card
targets are p50 <= 2,000 ms and p95 <= 4,000 ms from the end of speech. These
targets are not achieved or verified by the routing results below. The older PRD
has stricter launch gates; those gates remain distinct and unchanged.

## Routing development baseline

Run `node scripts/benchmark_listen_routing.mjs` from the repository root.
The original 40 synthetic development cases cover coding, ML, personal questions,
followups, ordinary conversation, microphone speech and hard requests. They are
authored examples, not recorded calls or an independent evaluation set.

| Measure | deterministic-v6 baseline | deterministic-v7 development |
| --- | ---: | ---: |
| Answer-worthy requests detected | 12/21 | 21/21 |
| Unwanted answers | 5/19 | 0/19 |
| Precision | 70.6% | 100% |
| Recall | 57.1% | 100% |

The saved JSON reports retain every case and decision. Local router execution
times exclude audio capture, STT, knowledge retrieval, model generation and UI
rendering. They cannot establish end-to-end speed or answer correctness.

A later 27-case synthetic challenge exposed seven mistakes in v7: six unwanted
cards and one missed request. The v8 changes correct those examples while the
original development suite still passes. Because v8 was adjusted using this
challenge, it is now a development set too; its 27/27 result is not independent
evidence of generalization. Punctuation-free short followups such as “and
memory” are deliberately suppressed unless a question mark is present; “why
not” and “how so” still work without punctuation after a recent answer.

Changes: recognize questions after a setup sentence; suppress call logistics
such as screen sharing and requests to wait or repeat; recognize mathematical
imperatives; allow short followups only within 30 seconds of a successful answer.
Off, microphone exclusion, duplicate suppression and cancellation still apply.
The recent transcript supplies the previous subject to the answer model.

Follow-up context now also includes the last completed Veil suggestion when
its question precedes the current turn in the same session and the suggestion
finished before the current turn began. It is bounded and labeled as potentially
wrong and not necessarily spoken; it is not evidence for personal claims.
Later, canceled, missing, cross-session and same-turn suggestions are excluded.
Tests check construction and boundaries, not whether a model uses the context well.

Clearly marked proof, derivation, AIME and multi-step math requests now select
the deep answer profile for automatic and manual answers. This uses the configured
deep-model override when supplied, keeps guidance bounded, and retains the draft
and grounding instructions. Ordinary requests keep the existing short or guided
profile. Detection is heuristic and can miss difficult work; a selected provider's
explicit reasoning settings are preserved. The automatic deep result streams in
the existing answer card and remains unverified. Unit tests cover routing and
prompt choice; actual mathematical correctness and elapsed time remain unmeasured.
The heuristic also covers spoken remainder questions using “divided by” and
digit-counting questions like the earlier spoken evaluations. A routing test
does not establish that transcription will preserve the triggering words.

Validation: 88 Node tests passed; TypeScript checking passed. This milestone
does not update the running packaged binary. A fresh release build and runtime
verification will follow the remaining pipeline changes.

## Historical timing diagnostic

Read-only aggregate of the existing local database on November 3, 2026:
93 saved automatic attempts, all marked answered. Question-end-to-first-model-text
p50 was 4,009 ms and p95 was 6,120 ms. Attempt-start-to-first-model-text p50 was
1,605 ms and p95 was 2,885 ms. Across 351 transcribed system turns, audio-ready
to final STT p50 was 1,139 ms and p95 was 2,951 ms.

These are mixed historical sessions with different settings and audio origins.
They do not prove on-screen usefulness, source support, correctness, or current
model performance. Manual Answer now timings are excluded from the automatic
summary. No private transcripts, profile data or credentials are in this report.

Code inspection confirms live captions are display-only: the automatic answer
path still waits for batch STT, transcript/ledger persistence and the configured
pace delay. The answer model is therefore not the only latency source.

The VAD capture now flushes a partially filled live PCM frame immediately before
emitting a completed segment, including forced 30-second segments. Previously,
up to 200 ms of live audio could be emitted after the segment event that caused
the client to commit the live stream. The remaining frame is emitted at most
once. This improves the boundary but does not establish that live and batch
segments contain identical audio: idle audio, discarded VAD segments, stream
startup and failure still need explicit correlation. Live finals therefore remain
display-only. [OpenAI's transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
requires matching completion events to committed input items by `item_id`; their
completion order across turns is not guaranteed. End-to-end event ordering and
latency have not yet been measured on the packaged app.

The automatic path now saves the utterance first, then starts its independent
ledger and routing-record writes together instead of serially. Both writes are
settled before the answer starts; ledger and decision errors remain separate.
The session and newer routed questions are checked again after the writes so a
delayed older decision cannot replace a newer answer. A controlled asynchronous
test verifies overlap and failure isolation, and router tests cover the delayed
decision guard. SQLite contention may reduce or erase the savings; actual
question-to-useful-card latency remains unmeasured on this revision.

The completed-card exporter stores provider-generated checkpoints, not window
observations, and excludes unanswered questions. Its legacy latency report no
longer claims that those records can pass a visible-usefulness gate. The new
`scripts/report_visible_useful_benchmark.py` takes a complete question inventory
and a reviewed outcome for every question, including misses and unobserved
cases. It reports the user's 2 s / 4 s target separately from the PRD's stricter
1.5 s / 3 s target, with sample minimums of 20 and 200 ordinary questions.
Passing also requires every ordinary question to have a reviewed useful window
timestamp. Hard questions are counted separately. These input labels and
timestamps still require independent review; the script does not verify the
screen, classify correctness, or establish real-call performance by itself.
An illustrative input schema is in `tests/fixtures/visible-useful-benchmark-example.json`.

## Local knowledge retrieval diagnostic

The synthetic 12-target lexical benchmark ran at 100, 1,000 and 10,000 chunks.
All exact-anchor queries returned their target in the top seven; none of the
paraphrase-only queries did. At 10,000 chunks the first-pass p95 for exact
queries was 0.68 ms, while the paraphrase-only p95 was 36.56 ms. These times are
SQLite query execution only, not total retrieval or call response time. The corpus
is small and artificially constructed; results are not real-user recall estimates.

Short followups with pronouns or omitted subjects now augment their local
knowledge query with up to two earlier finalized spoken turns. The current user
message is unchanged. An integration test exercises the actual FTS index and
finds a synthetic topic through earlier context; other questions retain their
original query. This is lexical context expansion, not semantic retrieval: the
paraphrase-only gap and relevance in real conversations remain unverified.

## Remaining goal work

On November 3, a synthetic spoken cross-validation question was played while
Listen displayed active capture on the packaged `1ca3b9c` build. The UI showed
no transcript or answer during the observation, so there is no usable latency or
quality measurement. The capture shortcut did not stop Listen: inspection found
that the registered callback omitted `capturing` from its effect dependencies.
The test process was terminated to stop the microphone and loopback capture.
The callback now updates when capture state changes. The shortcut fix and audio
routing still need verification in a new packaged build; the interrupted empty
session is not treated as a successful or complete call.

The Windows loopback implementation also had two plausible causes for silent
capture: its new audio thread did not initialize COM before WASAPI calls, and it
stopped after a three-second event timeout. Initialization errors were converted
to a plausible 44.1 kHz sample rate, leaving the UI in a listening state. The
thread now initializes and releases COM, startup errors propagate to the UI, and
idle timeouts continue waiting with backoff. Simulated wait and shutdown tests and
a Windows Rust check pass. The previous failure's exact cause is not proven; a
packaged playback test is still required. The WASAPI dependency reports all
non-signaled waits as timeouts, so a permanently broken event handle cannot yet
be distinguished from an idle output device by this logic.

- Evaluate separate realistic cases after freezing the development changes.
- Measure current controlled audio-to-visible-useful-card latency, failures and
  correctness; distinguish partial text from a useful answer.
- Improve the largest measured pipeline delays while keeping finalized turns
  durable and ordered, and preventing stale answers after stop or interruption.
- Check actual answers against known coding/ML rubrics and synthetic personal
  Prep sources, including missing facts, conflicting sources and followups.
- Route difficult requests to sufficiently careful reasoning; evaluate math and
  technical quality independently from ordinary-card speed.
- Build and verify the packaged app; push subsequent tested milestones.
- Leave real-call verification explicitly pending until the user tests it.
