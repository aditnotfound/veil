# Complex spoken Listen evaluation — 2026-09-29

## Setup and limits

- Tested the packaged Windows `pluely.exe` from commit `d5226d6` with Windows SAPI speech played through system audio, Veil Listen auto-detect, GPT-6 Luna initial cards, and the locally configured GPT-6 Sol deep override. Fast OpenAI call cards was enabled in this profile. The response's actual service tier was not recorded.
- These are synthetic spoken questions, not a real multi-person call or a noisy-room test. The UI timing is measured from the end of SAPI speech to first visible answer text. The same question was repeated for math reliability checks; this is a small diagnostic set, not a statistical benchmark.
- The initial card is explicitly labeled unverified. Deep output is a draft and was checked here against independent calculations.

| Spoken scenario | First visible card | Quality observation |
| --- | ---: | --- |
| Python payments API creates duplicate records after timeout retries | 3.15 s | Useful: idempotency key, database uniqueness, one transaction, original result on retry, body mismatch and concurrent retry checks. STT split the question and wrote “safe” as “save,” but the bounded conversation context preserved the task. |
| Classifier with 1% positives gets 99% accuracy by predicting negative | 1.72 s | Useful: positive-class precision and recall, confusion matrix, PR curve, calibration, operating threshold, subgroup checks, and error costs. STT split the context into three utterances. |
| Random split scores 95%, unseen-user split scores 70% | 1.94 s | Useful: identified user-level leakage, recommended a user-disjoint split, untouched test set, and a temporal holdout when deployment calls for it. STT split the context into three utterances. |
| Remainder of 7 to the power 2026 divided by 1000 | 3.46 s on the deep-path run | Initial Luna cards: **649**, **249**, **729** across three runs. Only 649 is correct. The Sol deep draft on the third run corrected 729 to **649** at 11.44 s. The first run's UI timing check failed because the harness expected “2026” but STT wrote “2,026”; the saved card confirms the app answered. |
| Three-digit numbers with strictly increasing digits summing to 12 | 2.54 s and 3.25 s | Initial Luna cards: one contradicted itself and ended at **5**; one correctly gave **7** and all seven cases. The Sol deep draft was correct at 8.25 s on the second run. |

Independent math checks: `pow(7, 2026, 1000) == 649`. In fact, `7^20 ≡ 1 (mod 1000)` and `2026 = 20·101 + 6`, so the remainder is the final three digits of `7^6 = 117649`. The valid increasing digit triples summing to 12 are `(1,2,9)`, `(1,3,8)`, `(1,4,7)`, `(1,5,6)`, `(2,3,7)`, `(2,4,6)`, and `(3,4,5)`.

## Finding and bounded follow-up

The practical coding and ML cards were useful in this set. The short Luna path was unreliable on contest-style math: **2 of 5** initial cards were correct across two repeated problems. The two Sol deep drafts were correct here, but took longer and remain unverified in the product. A keyword-presence check would have falsely passed the contradictory digit-count card because it contained “7” before changing its answer to “5.”

Before relying on Veil for hard math, add a hard-question route that withholds an unverified numeric short answer, uses a stronger reasoning model, and checks the result where a deterministic local calculation is possible. Evaluate that route on a broader held-out problem set with exact answers, latency, and false-confidence counts. Keep ordinary call cards on the fast route.
