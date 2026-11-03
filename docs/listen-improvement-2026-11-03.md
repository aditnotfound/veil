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

An additional exploratory set of 26 synthetic routing examples exposed four
unwanted responses to meeting logistics and one missed "walk us through"
request on `deterministic-v8`. The v9 router recognizes these narrow logistics
and plural walkthrough requests; it routes all 26 development examples as
labeled, and contrast tests preserve nearby technical questions. The set was
used to change the router and is therefore not an independent evaluation; its
labels are judgment calls and do not establish real-call precision or recall.
It is reproducible with `node --experimental-strip-types
scripts/benchmark_listen_routing.mjs OUTPUT tests/fixtures/listen-logistics-development.json`.

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

## Targeted synthetic playback after the capture fix

The packaged `fc1938e` build started and stopped Listen using Ctrl+Shift+M. The
first attempt played to the Windows default output while Veil had a different
explicit output selected, so it produced no system transcript. A subsequent
original synthetic cross-validation question was rendered to Veil's selected
speakers after more than five seconds of silence. Both system and microphone
transcripts appeared; the microphone picked up the speaker playback. The
automatic answer correctly explained validation-fold leakage and fold-local
scaling. Capture was then stopped and the UI returned to its idle state.

This single diagnostic is not a live call, a p50/p95 result, or a measured
first-useful-visible time. From playback end to first provider text was 8,864 ms;
the first provider chunk was just `F`. Final STT took 1,889 ms from audio-ready,
the subsequent wait was 320 ms, and answer start to first provider text was
2,887 ms. Audio-ready occurred 3,768 ms after playback ended. The detected last
speech time was 704 ms earlier than playback end, so the recorded
question-end-to-first-chunk was 9,568 ms. The full answer was inspected in the
window later, but its first useful on-screen timestamp was not captured.

An independent Windows loopback probe of the same selected speaker observed
packets during the synthetic playback but none after it became idle. Veil's VAD
previously advanced its silence counter only when samples arrived, which can
delay finalizing the question after the device stops delivering packets. The new
idle clock injects bounded VAD-only silence after two 100 ms ticks without real
samples while a speech segment is active; real audio resets the clock. It does
not inject fabricated PCM into the live-caption stream. Simulated idle and
resumption tests alone do not prove safety under real device jitter or establish
the latency improvement.

On a subsequent packaged build with that idle fix and the earlier v8 router,
the same synthetic recording was played to the same speaker endpoint. The
estimated detected-speech-end to audio-ready delay fell from 4,472 ms to
1,270 ms; generated first text fell from 9,568 ms to 4,720 ms. A sampled
accessibility observation captured a clearly useful, accurate explanation at
5,376 ms after detected speech end. This was a single before/after comparison,
not a distribution or a real-call result; the window was observed by polling,
and actual human visibility or the precise first useful instant is not proven.

Two more synthetic spoken cases exercised the same packaged build. An
idempotency answer first observed at 4,651 ms after detected speech end gave a
useful key-and-unique-constraint approach, later adding a transaction and an
outbox. An ML answer first observed at 4,615 ms correctly recommended grouping
by patient, but said to leave validation untouched during tuning without
specifying a separate tuning set; that wording can mislead, since validation
data is often used for tuning. Neither case establishes percentile performance
or overall answer quality. Three cases are far below the 20-case ordinary
benchmark minimum, and none was a live conversation with another person.

## Further spoken development run

The v9 packaged build was exercised with a predeclared synthetic inventory of
20 ordinary prompts, five quiet utterances, and two reasoning prompts. The
selected mode was `on_question`, which is narrower than the fixture's original
`after_pause` routing diagnostic. Eighteen ordinary cases had useful
accessibility-observed text within their observation windows, one slow
cross-validation answer was generated after its window, and the direct
"walk us through" request was intentionally silent in question-only mode.
These are not 20 independent visible-usefulness passes. Observation was via a
Windows accessibility tree, which does not establish physical screen visibility.

The latest reviewed useful snapshots for the 18 observed cases had a 4,926 ms
median from estimated detected speech end, ranging from 4,067 to 6,042 ms. These
are sampled upper bounds for those snapshots, not a first-useful latency
distribution; they omit the delayed case and the unanswered instruction. Among
19 generated ordinary answers, first provider text had a 3,953 ms median and a
16,243 ms maximum. That is not a visible-useful metric. The 16,243 ms outlier
included 13,431 ms from audio-ready to final STT. All five synthetic logistics
or ordinary-conversation utterances stayed silent in these checks. The
patient-grouping follow-up was coherent, and two fictional personal questions
were answered without inventing facts; these are not evidence of general Prep
retrieval quality. A synthetic counting problem produced the correct answer 84
in the saved card, but its first visible time was not observed; a separate
proof instruction was silent in question-only mode. Playback is not a real call.
The compact Auto answers toggle previously always re-enabled question-only mode,
even if Questions + requests had been selected before switching it off. It now
remembers the most recently enabled mode across restarts and labels the active
scope. This change was not present in the run and does not establish why that
particular setting was active. A packaged interaction test remains necessary.

For short PCM system-audio clips sent to the configured OpenAI STT provider,
the next revision starts at most one duplicate request to that same provider
after three seconds if the first is still pending. The first successful result
wins and the other is canceled; stopping the session aborts both. Long clips and
other STT providers retain the existing retry path. This can incur a second
transcription charge and does not guarantee lower latency. Unit tests cover fast
success, slow rescue, both winners, failures, and cancellation; an actual
packaged before/after test of the tail improvement remains necessary.

The subsequent packaged build started and stopped Listen with the global
shortcut. In one speaker-playback smoke test, it correctly explained why an
index slows database writes. A useful answer was observed in the accessibility
tree 6,555 ms after detected speech end. STT took 2,270 ms, so the three-second
backup was not triggered; this does not demonstrate a real tail-latency
improvement or physical visibility. UI automation could not access the
microphone and settings buttons in that window, so the mode toggle's off/on
interaction and preservation of a selected scope remain unverified in the
packaged app. Listen was stopped and the app left open.

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

## Live transcription boundary prerequisite

Inspection found that rejected short VAD segments emitted `speech-discarded`
without flushing the last live PCM frame or committing the corresponding live
transcription buffer. The next accepted segment could therefore include audio
from the rejected segment. Native capture now flushes before that discard event,
and the OpenAI caption stream commits the rejected buffer invisibly. A regression
test covers a late rejected transcript followed by a valid question. This is a
boundary correction, not activation of live transcription as an answer source;
batch STT remains authoritative. Packaged audio verification and reliable
correlation of live final transcripts to saved turns still remain.

The caption client now exposes `commitFinal()`, which returns the provider's
completed transcript and receipt time for that commit. It associates provider
item IDs with commit order, ignores duplicate acknowledgments, preserves
timed-out slots so later turns cannot be shifted, and resolves pending requests
to null on close or failure. Display resets do not erase pending final results.
Queues are bounded and overflow falls back rather than guessing. Tests cover
reversed completion order, early finalization, display reset, duplicate
acknowledgments, timeout, discarded commits, and close. This API is not yet used
to select answer transcripts: native/provider boundary alignment and live versus
batch agreement still need measurement before changing the authoritative path.
