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

## Remaining goal work

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
