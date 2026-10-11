# Listen call evaluation — 2026-10-11

## Real Windows call on `3476cd4`

The user confirmed that the 19:21 UTC session was a real Windows call and that answer cards appeared and answered questions. They reported that the wording felt too much like AI. The session lasted until 19:37 UTC. This review uses locally saved records and does not reproduce the call transcript.

| Measure | Observed |
| --- | ---: |
| Finalized utterances saved | 69 (34 system, 35 mic) |
| Automatic answer attempts | 9 answered, 0 failed or canceled |
| Answer now attempts | 16 answered, 0 failed or canceled |
| System-audio ready to final STT | p50 879 ms, p95 2,759 ms |
| Automatic question end to first generated text | p50 3,922 ms, p95 5,702 ms |
| Automatic question end to completion | p50 4,319 ms, p95 5,868 ms |

The automatic timings come from individual answer attempts. A turn's single stage-timing row can be replaced when Answer now is pressed again on that turn. First generated text is not the same as first *visible useful* card; that UI timestamp was not captured during this call. The user's visual report confirms cards appeared, but does not establish exact visible latency or answer accuracy for every turn.

Review of saved decisions found two automatic answers that were not useful for the live moment: one responded to rhetorical questions inside a long narration, and one treated a cut-off explanation as a question. A brief imperative was also routed as a question, though no automatic request was started for that turn. These cases informed the router changes in `9192a34`. JEV was off and did not control visible answers.

## Packaged synthetic speech on `9192a34`

Windows SAPI speech was played through system audio into the packaged Veil window. The locally configured OpenAI model was GPT-6 Sol, and **Fast OpenAI answers** was on. Times below are from the end of SAPI speech to the text observed by Windows UI Automation. This is a small diagnostic set, not a latency distribution or a substitute for a real call.

| Spoken scenario | Transcript visible | First answer visible | Outcome |
| --- | ---: | ---: | --- |
| Cross-validation feature selection and scaling | 45 ms | 3,914 ms | Correctly identified validation leakage and fold-local fitting. |
| Cut-off algebra explanation fragment | 57 ms | None during 8-second observation | Correctly stayed silent. |
| Scaling before cross-validation, with **Answer now** | 49 ms | 3,989 ms | Manual fallback answered correctly. |
| Python mutable default argument | 53 ms | 3,354 ms | Answered with the reuse risk and a `None` default fix. |

No provider or transcription error appeared in these runs. The revised short-card prompt produced direct prose without the earlier `Notes` and `Open` labels in the inspected answers. The packaged test harness now matches the current Fast-mode control label.

## Visible timing for the next call

While the packaged Veil window has Listen expanded, run `pwsh scripts/observe_packaged_listen.ps1 -ProcessId PID -OutputPath "$env:TEMP\veil-visible-call.jsonl" -DurationSeconds 180`. After the call, run `py scripts/report_visible_call_latency.py --db PATH_TO_veil.db --events "$env:TEMP\veil-visible-call.jsonl" --session SESSION_ID`. The observer stores timestamps and hashes of prompts, without transcript or answer text. Use a new output path for each run. Its readout can see a window covered by another app, so confirm actual on-screen visibility with the user.

In a separate synthetic question on `9192a34`, the observer recorded first answer text 91 ms after the saved first provider chunk and completion 90 ms after the saved completion timestamp. Detected question end to first UI text was 4,343 ms for that single case. These are diagnostic checks of the observer, not real-call latency results.

## Remaining gate

Run a short real call on the revised packaged build with an ordinary question and unrelated conversation. Confirm that the new router stays quiet when help is unnecessary, the answer appears in the panel, the wording sounds natural, and the user can still press Answer now. Record misses, false cards, errors, cancellations, and visible latency. Do not treat the synthetic results above as proof of this final live gate.
