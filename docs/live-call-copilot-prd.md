# Product requirements: Veil Live Call Copilot

**Version:** 0.1 working specification

**Date:** 23 September 2026

**Repository baseline:** `aditnotfound/veil` at `0fe977866efeba0a9b739a63dab4acfe3cef9928`

**Owner:** Veil personal fork

**Status:** Implementation authorized; acceptance gates below are proposed targets until measured on representative calls.

## 1. Product decision

Veil will become a desktop call copilot that can listen to both sides of a conversation, keep an accurate record, and present concise, relevant help while the call is happening. It will remain usable through the existing Ask workflow. The first release focuses on **private, on-screen suggestions** controlled by the user. It will not speak to the other participants or take actions in their apps.

The design separates four capabilities:

1. **Hear and remember:** capture and transcribe microphone and system audio as distinct sources, with timestamps and corrections.
2. **Decide:** determine whether help is warranted and which kind. JEV is a candidate fast decision engine, not the source of prose or facts.
3. **Ground and answer:** retrieve relevant local knowledge and generate a short suggestion with a text model. A stronger model handles difficult work separately.
4. **Verify:** make uncertainty, source support, and response status visible. Measure speed to a *useful* suggestion, not speed to a spinner or filler sentence.

The Minecraft agent supplies a useful planner/controller pattern. Its recorded game result does not establish Veil's call latency, accuracy, or generality.

## 2. Problem and target user

During a live call, the user may need a fact from their own files, a concise way to phrase an answer, a reminder of something said earlier, or help solving a difficult technical question. Today's Veil Listen mode can transcribe and answer a finished system-audio segment, but it does not maintain a complete, two-sided call record. It also waits for a pause, performs batch transcription, applies an optional fixed delay, and can retrieve knowledge with a separate network embedding call before the answer starts. Those steps make suggestions late or context-poor.

**Primary user:** the owner of the Veil desktop app, using Windows first, with remote-call audio and a microphone. Calls may include interviews, technical discussions, meetings, and research conversations. The user can read brief text in an overlay while continuing to talk. macOS and Linux support must be preserved and validated before claiming platform parity.

**Jobs to be done:**

- “When someone asks me a question, show the most useful answer or clarification before the conversation moves on.”
- “Remember what both of us said, including names, numbers, constraints, and commitments.”
- “Use my supplied information quickly without inventing personal facts.”
- “When the question is hard, give me an honest first step and work toward a correct deeper answer.”
- “Let me stop, correct, delete, and inspect what the assistant heard and used.”

## 3. Goals, boundaries, and truthfulness

### Goals

**G1. Relevance:** a proactive card appears only when it has a likely use. Silence is a successful outcome when no help is needed.

**G2. Speed:** ordinary questions receive a useful short card quickly, measured from the end of the relevant spoken question. Live captions should update sooner; deep answers may take longer.

**G3. Context:** every finalized utterance is stored in session order whether or not Veil answers it. The model sees a bounded recent transcript and a maintained fact/commitment ledger.

**G4. Grounding:** personal claims refer to a user-provided knowledge source or a specific call utterance. Conflicts, stale data, and unavailable retrieval are disclosed.

**G5. Hard-question quality:** difficult math/AI questions take a deep path with enough reasoning and checks. The product does not trade away correctness to meet ordinary-card latency.

**G6. Control and privacy:** capture and external processing are visible and stoppable. Raw audio is not retained by default. User data remains in local storage unless sent to a configured model/STT/embedding provider for an active request.

### Boundaries for the first release

- Text overlay only; no synthetic voice speaking into the call.
- No autonomous messages, app actions, or changes to external accounts.
- No guarantee of an instant or universally correct Olympiad-level proof. A fast opening is separate from a checked final solution.
- No assertion of fully offline operation while cloud models or cloud embeddings are selected.
- JEV remains optional until a controlled ablation proves it improves Veil's own results.

## 4. Core user flows

### 4.1 Start and prepare

The user opens Listen mode, sees selected microphone, selected system-output source, transcription provider, answer models, and whether cloud processing is active. A single Start action opens a new call session. Capture indicators show each source independently. If one source cannot be captured, the UI names the missing source and allows a one-sided session only by explicit user choice. Existing Ask mode and keyboard shortcuts remain available.

Before or during a call, the user may select a knowledge collection, add notes/files, and choose a Listen prompt mode (general, meeting, coding, etc.). The app indexes knowledge ahead of calls and shows indexing status. A source that fails indexing remains unavailable without damaging the last working version.

### 4.2 Listen and suggest

Partial captions appear as speech arrives and may revise. Finalized utterances become immutable session entries unless the user explicitly corrects them. A correction creates a new revision with the original retained locally for audit/undo. The overlay identifies **You** and **Call audio**; it does not pretend to identify a named speaker from a mixed system stream.

Veil may prepare retrieval privately while a question forms. It shows a substantive card only after the question is stable enough to avoid misleading the user. A card contains a short answer, a clarification question, a relevant fact, or a useful next step. It can be dismissed or pinned. Newer low-value cards do not displace a pinned or actively read card.

### 4.3 Ask and deepen

The user can press a hotkey to request an answer from the current call context, even when automatic suggestions are off. A **Go deeper** action starts a separate job that can use a stronger model and tools. The fast card remains visible, labeled as an initial suggestion. A deep response is labeled `draft`, `grounded`, or `checked` based on the evidence actually available. A new question cancels or deprioritizes obsolete work; no stale text may appear in the current card.

### 4.4 Review and end

Stop immediately ceases both audio streams and outbound requests. The session remains locally available as a timestamped transcript with suggestions, sources, corrections, and errors. The user can rename, summarize, export, and delete it. Long-term personal knowledge is **not** silently updated from a call; promoting a call fact to the knowledge library requires a deliberate user action.

## 5. Functional requirements

Each ID is a testable product requirement. “Must” means required before the feature is enabled by default.

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| CAP-01 | Capture microphone and system audio as separate streams on Windows. | A replay and a real call show source-labeled utterances from both sides; mute one side and only that stream stops. |
| CAP-02 | Timestamp audio and transcript events with a monotonic clock and stable per-source sequence. | Out-of-order and duplicate event fixtures produce one correctly ordered final transcript. |
| CAP-03 | Detect permission denial, mute, device disconnect, sleep/resume, and audio-stream failure. | Each injected or manual case shows a specific state; Stop releases resources; reconnect does not duplicate capture. |
| STT-01 | Provide incremental captions and a final transcript per turn, with batch STT fallback. | Partial text appears before the final on representative audio; final revisions replace partial text rather than appending duplicates. |
| STT-02 | Avoid unsupported claims of speaker identity or word confidence. | UI source labels come from separate captured tracks; unavailable confidence is never fabricated. |
| SES-01 | Persist **all** finalized utterances, not only those answered. | End/restart/reopen preserves the full call transcript and source order. |
| SES-02 | Maintain recent turns and a compact ledger of people, facts, numbers, decisions, commitments, and unresolved questions, each linked to utterances. | A follow-up referring to earlier context resolves correctly in held-out long-call replays, or asks for clarification. |
| SES-03 | Keep model prompts bounded as the call grows. | A two-hour replay stays within configured token/memory budgets and keeps explicitly referenced earlier facts retrievable. |
| DEC-01 | Offer an automatic mode that can choose silence, fact, short answer, clarification, retrieval, or deep answer. | Negative and positive held-out turns meet the false-trigger and relevance gates below. |
| DEC-02 | Run an optional JEV router only on defined ambiguous decisions and validate its choice against allowed actions. | Malformed, late, unavailable, and rate-limited JEV responses fall back safely. |
| DEC-03 | Refresh any high-level plan asynchronously without blocking captions or ordinary answers. | A slow plan call leaves the active session responsive; outdated plans are discarded. |
| ANS-01 | Stream a short, glanceable suggestion, with evidence and uncertainty when needed. | User review finds it directly useful; unsupported personal facts are not presented as known. |
| ANS-02 | Provide a separate deep path for difficult math/AI questions. | Held-out expert-graded set reports final correctness, proof adequacy, and full-solution latency separately. |
| ANS-03 | Cancel or reject stale answer jobs by session, utterance revision, and plan version. | A new question, transcript correction, Stop, or restart cannot display tokens from an obsolete job. |
| KNO-01 | Ingest notes and supported files with source title, section/page or line when available, updated time, and content hash. | Search results link to the correct source span; corrupt/unsupported files yield actionable errors. |
| KNO-02 | Combine a local lexical fast path with dense retrieval when useful, under a strict top-K/time/token budget. | Retrieval quality and p95 tests meet gates at small and large library sizes. |
| KNO-03 | Update indexes atomically and retain the prior valid version on failure. | Fault injection during embedding/write never leaves an existing source partially missing. |
| KNO-04 | Keep retrieved text as evidence, not higher-priority instructions. | Prompt-injection fixtures cannot redirect behavior or fabricate a cited fact. |
| UX-01 | Show source, capture, transcription, answer, retrieval, and error states without hiding the current useful card. | Manual usability test across ordinary, interrupted, and degraded calls. |
| UX-02 | Provide Start/Stop, mute each source, dismiss/pin card, Ask now, Go deeper, correct transcript, inspect source, export, and delete. | Each control works in a packaged Windows build and survives UI rerender where appropriate. |
| DAT-01 | Store transcripts locally, omit raw-audio retention by default, and allow session deletion and retention choices. | Deletion removes associated records and cached session facts; raw audio is absent after default sessions. |
| SEC-01 | Keep provider keys out of webview localStorage, logs, exports, and repository files. | Migration test and storage/log inspection; model calls still work with keychain-backed configuration. |
| COMP-01 | Preserve existing Ask, Listen fallback, saved chats, knowledge, and meetings through additive migrations. | Upgrade test from an existing `veil.db` and smoke tests of old workflows. |

## 6. Suggestion policy and response states

The default automatic mode should be conservative. It may answer an explicit question, surface a directly relevant known fact, or note a clear commitment. It should stay silent for greetings, filler, background speech, duplicate turns, an already answered question, or unclear audio. The user can select `Off`, `Questions`, or `Proactive`; `Off` still records a session if capture is on and allows manual Ask.

Every displayed answer has a lifecycle: `preparing` → `initial` → `grounded` → optional `checked`. `Initial` means useful but not fully verified; it cannot be used to claim proof completeness. `Grounded` means its personal or document facts are supported by displayed source spans. `Checked` requires an actual verification step appropriate to the task, not a second unexamined model opinion. If the response cannot be supported, Veil displays a concise uncertainty or clarification instead of a fabricated answer.

Cards include the question/utterance they answer, creation time, model/provider, and citations to knowledge or transcript spans when relevant. They cannot silently change after the user might have read them; a corrected card is a visible revision.

### 6.1 JEV decision experiment contract

The reviewed `rmalde/minecraft-agent` harness uses an asynchronous Astra/Sol planner and a bounded JEV choice request; its executor and environment checks remain deterministic. Veil should borrow that division of labor, not its Minecraft observations or actions. [TypeSafe describes JEV as a text-input, typed-decision model](https://docs.typesafe.ai/concepts/system-one); it cannot consume live audio or write the answer card. The [harness README](https://github.com/rmalde/minecraft-agent) uses `typesafe/jev-1.13` through OpenRouter's `/api/alpha/decisions` endpoint. Treat that endpoint and model slug as versioned integration details to verify again before rollout.

For each eligible finalized **system** turn, create a small structured state: transcript text, source, a bounded number of recent finalized turns, current automatic mode, most recently answered turn, and whether retrieval is ready. Exclude raw audio, unused personal documents, provider keys, and unrelated session history. The first JEV question chooses only `silence` or `short_answer`, so it can be compared with today's deterministic router. Add `clarify`, `fact`, `retrieve`, and `deep` only after those actions have working implementations and labeled evaluation sets. A response outside the offered choices, malformed response, timeout, missing credential, or cancellation is recorded as such; the deterministic router remains authoritative. Never treat JEV's confidence on one turn as proof that its choice is correct.

Run JEV in **shadow mode**, off by default, before allowing it to change the UI. A user who enables the experiment must see that finalized call text is sent to the selected decision provider and may incur charges. The shadow request must not delay captions, transcription, or answer generation. Journal its model/version, offered choices, choice or error status, elapsed time, and associated utterance ID without duplicating transcript text. On a held-out replay, compare both routers on the same turns, report invalid/timeout rate and cost as well as usefulness/false suggestions, and check that a policy using JEV still meets the first-useful-card and false-trigger gates.

The optional asynchronous session planner is also off by default. Every eight finalized turns it sends at most the newest 24 turns and 8,000 transcript characters to the selected answer provider, with personal-library retrieval disabled for the planner call. Its strict JSON result may contain only an objective, active topic, source utterance IDs, and up to eight source-linked unresolved questions. Unknown fields, prose outside JSON, unavailable source IDs, and unsourced unresolved questions are rejected. The planner has a cancellation/revision coordinator independent of answer streaming; a new milestone or Stop invalidates old work, and a plan that becomes stale during storage is deleted. Valid drafts are persisted with session, revision, provider/model, through-utterance ID, and timing, then supplied to later answers as an explicitly unverified candidate. The settings disclosure states that transcript text is sent to the selected provider and may incur charges. A slow or failed planner leaves captions, the deterministic router, local ledger, retrieval, and answers operational.

## 7. Knowledge requirements

Knowledge has three tiers, with different update and retrieval rules:

1. **Immediate call context:** recent finalized utterances and partial text in memory. Partial text is speculative and never durable evidence.
2. **Session memory:** durable transcript plus a concise, source-linked ledger. Corrections invalidate dependent ledger facts. Summaries never replace the full transcript.
3. **Personal library:** explicitly ingested notes/files and approved call facts, indexed locally with provenance and versioning.

At ingestion, content is normalized and chunked by structure. Local lexical indexing works without a model key; when a dedicated embedding provider is configured, embeddings are created in batches. The complete source and all of its chunks replace the previous version in one transaction after external embedding work succeeds. At query time, local lexical search returns immediate candidates. Cached dense query embeddings and an in-memory vector index can improve recall when they meet latency gates. A small merged/reranked set enters the answer prompt with source IDs, dates, and excerpts. The app must not send every stored vector or every document to the answer model. A failed retrieval must be visible to the coordinator and the answer policy; it cannot silently claim that the library was consulted.

For a factual answer, the acceptance test checks both correctness **and support**. For a hard reasoning problem, retrieved knowledge can supply context or definitions but does not prove a generated solution. Current, contradictory, and stale sources need explicit handling.

## 8. Performance and quality gates

The measurements below are proposed launch gates, not promises or present results. Record per-stage p50/p95 and end-to-end timing on the same hardware, audio, network, provider, and corpus. The key metric starts at the **end of the caller's relevant question** and ends when a user can see the first *useful* card. A spinner, “thinking,” or generic acknowledgment does not qualify.

| Metric | Proposed gate | Measurement set |
| --- | --- | --- |
| First useful ordinary card | p50 ≤ 1.5 s; p95 ≤ 3.0 s after question end | At least 200 held-out ordinary questions across varied call conditions. |
| Unwanted proactive suggestions | Fewer than 1 per 15 minutes | At least 5 hours of held-out calls with negative turns. |
| Stale visible answer chunks | Zero | Deterministic replay of cancellation, revisions, Stop, and restart. |
| Supported personal claims | 100% have a valid cited source/utterance or are marked uncertain | Human review of at least 100 personal-knowledge answers. |
| Retrieval | No regression in labeled recall@K versus the existing dense baseline; p95 recorded at 100, 1,000, and 10,000 chunks | Fixed corpus/query benchmark with cold and warm runs. |
| Long-session durability | No lost or duplicated finalized utterances | At least one 120-minute replay and crash/restart injection. |
| Deep answer quality | Separately reported correctness and proof adequacy; no unverified final proof labeled checked | Held-out hard math and AI/ML set with independent grading. |

The initial numerical timing targets may need revision after instrumentation, but **not** to make a failing implementation look successful. Record baseline and choose thresholds before optimizing or evaluating JEV. Compare the current batch pipeline, a streaming deterministic-router pipeline, and a streaming JEV pipeline under identical inputs. Default JEV adoption requires a real gain in useful response time or relevance without a meaningful accuracy, noise, or cost regression.

**Replay measurement workflow:** Use `python scripts/export_call_replay.py --db PATH_TO_veil.db --out REPLAY.json` to create a local, unlabeled transcript template; `--session ID` limits it to one call. Reviewers label each `usefulSuggestion` without viewing the recorded routing choice and measure `negativeDurationMs` from intervals where a card would be unwelcome. Then run `node scripts/evaluate_call_router.mjs REPLAY.json after_pause`. For a session captured with the optional JEV shadow switch on, run `python scripts/compare_jev_shadow.py --db PATH_TO_veil.db --labels REPLAY.json` to compare recorded choices and fallback behavior on the same labeled turns. The exporter intentionally leaves both labels unset and refuses to overwrite an existing file. The separately recorded `answerSucceeded` field only replays the prior answered-repeat policy; it is not a relevance label, and counterfactual modes need their own answer-success evaluation.

**Synthetic durability workflow:** Run `python scripts/validate_long_call_durability.py --db LONG_CALL.db --report LONG_CALL.json`. The command refuses to overwrite either artifact. It writes a 120-minute, 1,440-turn, two-source journal through child processes, hard-exits twice after inserting an uncommitted sentinel, resumes each time with a ten-turn overlap, exports the result through the normal replay exporter, and fails unless row identity/order, deduplication, rollback recovery, integrity, and foreign keys all remain exact. This proves the local journal/replay layer under deterministic restart injection; it does not substitute for crashing the packaged app during real microphone and loopback capture.

**Local retrieval benchmark:** Run `python scripts/benchmark_local_retrieval.py --assert-gates --output RETRIEVAL.json`. It applies the production TypeScript query tokenizer and the production SQLite FTS5 join/ranking plan to deterministic libraries of 100, 1,000, and 10,000 chunks. Twelve labeled targets are queried once with lexical anchors and once with paraphrases that intentionally omit those anchors. It reports Recall@1/3/7, first-pass p95, warmed p50/p95, index build time, database size, and integrity. The gate requires lexical Recall@7 of at least 0.95 at every scale and a 10,000-chunk first-pass p95 no higher than 100 ms. Paraphrase-only recall is diagnostic and cannot pass the lexical gate off as semantic quality; dense/mixed retrieval needs its own fixed real-document benchmark.

Completed-card quality is reviewed separately so seeing the generated answer cannot influence the router label. Run `python scripts/export_call_card_review.py --db PATH_TO_veil.db --out CARD_REVIEW.json`, inspect displayed checkpoints in order, and label `cardUseful` plus the earliest `firstUsefulCheckpoint`. Run `python scripts/report_useful_card_latency.py LABELED_CARD_REVIEW.json` to report detected-question-end to first-useful-checkpoint p50/p95. The script refuses to pass the PRD gate below 200 reviewed cards or while any reviewed card has no useful checkpoint. Both exports contain private call text; keep them local unless participants consent to sharing. These workflows are starting points for held-out corpora, not substitutes for listening to calls and judging usefulness.

Deep drafts use a third, independent review pass. Run `python scripts/export_deep_answer_review.py --db PATH_TO_veil.db --out DEEP_REVIEW.json`, then give the resulting local file to a grader who did not author the answer. The grader first marks whether an item is an in-scope hard question, then labels correctness, proof adequacy, and whether the draft improperly claims that it is checked, proven, verified, or final without a supplied check. After all labels and a nonempty `graderId` are present, run `python scripts/report_deep_answer_quality.py LABELED_DEEP_REVIEW.json` to report the exact label counts, rates, sample size, and question-end-to-completed-draft p50/p95. The report deliberately has no launch threshold because this PRD has not yet defined one; set a threshold before using the hard set as a release gate. The export contains private call and generated text and must remain local unless participants consent to sharing it.

## 9. Failure behavior and edge cases

| Situation | Required user-visible result |
| --- | --- |
| Partial transcript changes meaning | Speculative work is invalidated. The final turn determines the answer. |
| Two people speak at once | Preserve each captured source; indicate ambiguity rather than merging contradictory words into a confident answer. |
| A question lacks a key constraint | Show one concise clarifying question or a conditional answer with assumptions. |
| Earlier call fact is corrected | Ledger and dependent card become visibly revised; no stale fact stays authoritative. |
| Personal sources disagree | Identify conflict and source dates; do not pick a convenient fact without evidence. |
| Provider timeout, rate limit, or outage | Surface degraded status, use configured fallback if available, and keep capture/transcript alive. |
| JEV returns an invalid choice | Ignore it; use the deterministic router. |
| Retrieval/index update fails | Keep prior complete index; warn when knowledge was not consulted. |
| Device changes, app sleeps, or permission is revoked | Stop affected stream, preserve session, and resume only with correct device/permission state. |
| User stops or deletes | Stop streams and requests, clear ephemeral buffers, and delete selected local records without silently restarting. |
| Very long or noisy call | Bound queues and prompts, drop speculative jobs before finalized utterances, and never let backlog masquerade as a live answer. |

## 10. Privacy, provider, and platform requirements

Before a session starts, the app shows which audio sources are captured and which external services receive audio, transcript excerpts, queries, or knowledge snippets. Credentials are stored through an OS-backed secret mechanism. Local analytics/traces are redacted by default; detailed diagnostics require an explicit toggle. The app provides an easily reached Stop control and retention/deletion settings. Capturing participants may be subject to local rules; the product must not imply that use is universally permitted.

Windows is the first release platform because the current development and verification environment is Windows. macOS Core Audio and Linux PulseAudio paths must have their own capture, permission, device-switch, and packaged-app checks. A Windows pass cannot be used to claim macOS or Linux readiness.

## 11. Release sequence

1. **Baseline and replay:** instrument the existing path; add deterministic audio/provider fixtures and CI. Establish ordinary and hard-question baselines.
2. **Correct session core:** persist every final utterance, restore chronological context, implement job versions and real cancellation, connect Listen sessions to Meetings, and test crash/restart.
3. **Streaming two-track audio:** add microphone plus system capture, incremental transcription, fallback, device recovery, and live-call validation.
4. **Knowledge:** transactional indexing, local lexical search, hot dense retrieval, provenance, conflict handling, and retrieval benchmarks.
5. **Decision experiment:** deterministic router, optional JEV adapter, asynchronous planner, ablation and cost controls.
6. **Answer tiers:** short grounded card, deep hard-question path, source inspection, explicit revision and verification status.
7. **Hardening:** keychain migration, cross-platform validation, dependency review, packaged-app tests, and phased default enablement.

**First engineering slice after this PRD:** implement the session core and replay tests on top of the current batch STT path. This isolates correctness before adding more network calls or audio providers.

## 12. Dependencies and unresolved validations

At the initial repo baseline, the local frontend and Rust checks passed but there were no tracked unit tests. The environment's OpenAI key returned HTTP 401 in a read-only model lookup; it does not validate Astra or Sol access. JEV credentials/access are not currently validated. Streaming transcription, JEV latency, the packaged SQLite FTS5 capability, real microphone/loopback behavior, and hard-question accuracy all require direct tests. A valid key should be configured locally through Veil or an ignored environment file; it should never be pasted into chat.

This PRD intentionally makes JEV a measurable option. The launch criterion is the usefulness and correctness of Veil during real calls, not whether the architecture resembles a game demo.

## 13. Implementation checkpoint (24 September 2026)

This checkpoint records engineering progress; it does not change the acceptance gates above.

| Area | Current evidence | Remaining proof |
| --- | --- | --- |
| Session journal | Additive SQLite migrations store separate source-labeled utterances; replay unit tests cover ordering, duplicates, stop/restart, bounded prompt history, and exclusion of later turns when transcription completes out of order. A reusable durability validator now persists a synthetic 120-minute journal containing 1,440 alternating mic/system turns through separate child processes. Two writers hard-exit with code 91 after an uncommitted sentinel insert; fresh processes reopen the database and replay ten overlapping committed turns. The final database contains exactly 1,440 unique ordered turns, no sentinel rows, 720 turns per source, zero foreign-key violations, and an `ok` integrity result; the normal exporter returns all 1,440 turns in the same order with labels unset. Migration 11 stores completed displayed cards and their streamed text checkpoints locally, linked to the answered utterance. Migration 12 stores an optional completed deep draft separately with its provider/model and checkpoints. Migration 13 stores locally classified candidate session-memory entries as exact excerpts linked to their source utterance. Migration 14 stores valid, source-linked asynchronous planner revisions separately as candidate drafts. Migration 15 adds transcript correction audit rows and answer invalidations. Migration 16 splits invalidation by initial/deep tier and clears only the tier that is actually regenerated. Meetings permits correction of saved source utterances, retains the previous and corrected text in revision history, removes ledger entries sourced by that utterance, removes session planner drafts, and marks answer cards at or after the corrected source as stale. A revision can be restored from Meetings; restoration is recorded as a new audit revision and repeats invalidation and candidate-memory rebuilding rather than erasing history. Stale initial and deep answers can be regenerated in order with the corrected source, bounded source-linked history, local knowledge retrieval, and the currently selected provider. The deep replacement also receives the current initial card and uses the configured call-only deep-model override. Each database replacement succeeds only if the source text is still identical to the text used to start generation, preventing a concurrent correction from making an obsolete answer current. The local ledger is rebuilt from the corrected transcript; a rebuild failure is reported separately from the already-saved correction. Canceled/failed answer streams are not journaled as completed answers, and stale planner writes are removed. Meetings reopens transcript, revisions, candidate memory, planner revisions, and source-linked initial/deep answers, visually separates each from user notes, and includes separate sections in Markdown export. Deletion tests cover transcript, revisions, invalidations, timing, routing, JEV-shadow, initial-card, deep-draft, candidate-ledger, and planner rows with SQLite foreign keys both on and off. A separately saved meeting copy remains until deleted separately. An isolated NSIS installation upgraded a seeded migration-14 database to migration 15 while preserving transcript, initial/deep answers, ledger, and planner rows; correction then produced its audit row, invalidated both answers, and removed dependent candidates. A second isolated NSIS run upgraded that populated migration-15 database to migration 16, preserved the session, corrected transcript, initial/deep answers, and correction audit, split the legacy invalidation into initial/deep rows, passed integrity checking, and verified both regeneration-clearing triggers inside a rolled-back transaction. The upgraded executable remained alive for the smoke interval. Windows uninstall now has an unchecked interactive data-removal choice and an explicit `/DELETEAPPDATA` silent equivalent. An isolated package test proved the default retains both AppData roots and AI/STT credentials, while explicit deletion removes all four; updater-driven uninstalls remain excluded. Meetings exposes 7, 30, and 90-day local Listen retention choices plus a keep-until-delete default and a separately confirmed clear-all control. The selected policy is applied at application startup and when Meetings loads; saved meeting copies remain separately controlled. | Crash the packaged Tauri process during real two-track capture and verify UI reopen, exercise real UI correction/retention/restore/regeneration, and build a model-refined ledger revision path. |
| Capture | Existing system loopback remains and emits a stable sequence with each segment; VAD segments now include the wall-clock time of the last chunk classified as speech, so useful-card timing does not begin after the configured silence wait. Listen mounts the installed microphone VAD independently and has a microphone mute control. Ask's hidden VAD is unmounted during Listen. Optional Deepgram live captions send PCM from both tracks; the toggle can change during capture. Batch STT remains the only durable final transcript. New system-VAD defaults use 20 nominal silence chunks (about 0.46 s at a 1024-sample hop), and runtime thresholds scale with device sample rate; previously saved settings retain their chosen threshold. | Real two-track call, source isolation, mute/reconnect, device-switch, permission tests, and calibration of the detected speech-end boundary against labeled audio. Live Deepgram authentication, partial timing, transcript reconciliation, provider cost, and failure behavior need a credentialed test. Other STT providers still have batch captions only. |
| Answer safety and tiers | Listen passes an abort signal and rejects chunks from obsolete jobs; new speech cancels current work. The UI keeps the last completed card when an interrupted answer is discarded, labels the prompt that card answered separately from the latest transcript, and restores the prior completed card if a new answer fails. Initial cards are explicitly labeled unverified. `Go deeper` starts a separate cancellable stream while preserving the initial card, bypasses the glanceable response-length setting, and labels the result `Deep draft · not independently checked`. Its prompt requires assumptions, evidence/reasoning separation, checks, and honest missing constraints; completed drafts are stored separately. An optional call-only model/deployment override lets the deep path use a stronger model through the selected provider without mutating the fast initial-card configuration; the resolved deep model is stored with the draft. Provider errors throw rather than appearing as answer text. Correcting a saved transcript causes affected initial and deep records to load with a visible `stale` status instead of retaining their prior status. Meetings can regenerate stale initial cards and deep drafts with streamed previews. A deep draft remains disabled until its initial card is current, and successful persistence removes only the regenerated tier's stale marker. The deep-answer export/report harness requires an identified independent grader and records correctness, proof adequacy, improper verification claims, sample size, and full-draft latency without inventing a launch threshold. | Real-provider UI validation of the model override and both saved-answer regeneration paths, interactive source inspection and correction, task-appropriate verification that can earn `grounded`/`checked`, and expert grading on the hard set. No generated deep answer has been independently graded yet. |
| Decision baseline and shadow experiment | A local deterministic router abstains on mic speech, short/noisy turns, greetings/housekeeping, ordinary statements, and recently answered repeats. It routes explicit questions and direct requests to short cards. Routing action/reason/version are stored in migration 7; the default extra wait fell from 1.2 seconds to 250 ms. An off-by-default JEV shadow switch is available when OpenRouter is selected with a key. Its bounded, timed, cancelable choice request runs after the finalized system turn without changing the displayed action. Migration 9 stores only choice/status/confidence/latency per turn; the switch discloses that recent mic and system transcript text is sent to OpenRouter and turns off on Stop. The replay exporter, deterministic evaluator, and `scripts/compare_jev_shadow.py` support same-turn analysis with missing/failed-request coverage reported. An independent off-by-default session planner refreshes every eight finalized turns, bounds its snapshot to 24 turns/8,000 characters, disables personal retrieval, validates an exact source-linked JSON schema, cancels stale revisions without canceling answers, and stores valid revisions as inspectable candidates. Failure leaves the local context and answer path active. | Only `silence` and `short_answer` are available as router actions. JEV responses were tested with fake HTTP responses, and planner responses with strict parser/coordinator fixtures, not provider credentials. No independently labeled real-call corpus or five-hour false-trigger gate exists yet. Packaged toggle/Stop behavior, network latency, cost, plan usefulness, prompt-injection inspection, and privacy inspection need live validation; fact, clarification, retrieval, and deep router actions remain to build and compare. |
| Long-call and personal search | Migration 10 creates local FTS5 indexes for call utterances and knowledge chunks, including rebuild and update/delete triggers. Listen retrieves up to four older finalized call turns outside its recent context and excludes the current/later turn by pivot ID; unavailable retrieval is surfaced. A bounded local candidate ledger classifies exact earlier transcript excerpts as people, facts, numbers, decisions, commitments, or unresolved questions; stronger decision/commitment labels suppress a duplicate generic-fact label. Recent/current turns are excluded, entries carry `[L:id]` and `[C:id]` markers, and ledger sources are excluded from duplicate FTS retrieval. The prompt explicitly says the entries may be stale, mistaken, unresolved, or contradicted. Saved sessions expose the candidate entries for inspection. Transcript correction invalidates its source-linked ledger row, clears candidate planner drafts for the session, conservatively marks answers at or after the corrected source stale, and rebuilds the deterministic ledger from corrected text. Personal context uses bounded local FTS in Listen, or a dense plus lexical-only mix in Ask. Excerpts carry `[C:id]`/`[K:id]` markers in user-priority prompt messages. Notes and files can be indexed locally without an embedding key. When OpenAI is selected, embeddings finish before a native SQLite transaction replaces the source and all chunks; a deliberate mid-insert failure test preserved the prior source and FTS hits. A repeatable benchmark now applies the production tokenizer and SQL ranking plan to deterministic 100, 1,000, and 10,000-chunk libraries. All anchored lexical queries reached Recall@1/3/7 of 1.0; at 10,000 chunks first-pass p95 was 0.8830 ms and warmed p95 was 0.8879 ms on the development machine. Paraphrase-only Recall@7 was 0.0 at every scale, explicitly confirming that the lexical path does not provide semantic recall. | Real-document lexical and mixed/dense Recall@K, p95 on packaged target devices, ledger precision/recall and contradiction handling on held-out long calls, model-refined ledger revisions, source-date/conflict policy, inspected citation validity, real call replay, provider-backed ingestion failure, and packaged UI verification. Grounding remains unmeasured. |
| Timing | Local `call_turn_timings` records audio-ready-to-STT and answer stages without transcript text. `scripts/report_call_latency.py --db PATH` prints diagnostic p50/p95. Completed cards retain timestamped text deltas; separate export/report scripts reconstruct each visible checkpoint and calculate first-useful latency from the detected question end. Missing useful cards remain failures, and fewer than 200 reviews cannot pass. | Representative labeled calls. No real card has been reviewed yet, speech-end boundary accuracy is unmeasured, and the stored diagnostic first-chunk metric remains distinct from first usefulness. |
| Credential storage | The installed `tauri-plugin-keychain` desktop backend exposes no working commands. It was replaced with native OS credential storage through `keyring`. Selected AI/STT provider variables are migrated only after the native save verifies a readback; plaintext localStorage is then reduced to a provider pointer. New selections never write variables to localStorage. Credential service names now derive from the active bundle identifier, preserving the production name while isolating smoke builds. Windows Credential Manager roundtrip and bundle-name tests pass. Explicit uninstall data removal deletes the two exact bundle-scoped generic credential targets through the Windows Credential API; default and update uninstalls retain them. | Packaged upgrade using real existing settings, macOS/Linux stores, custom CURL strings that may contain literal secrets, and full storage/log/export inspection. SEC-01 is not yet complete. |
| Verification | Forty-four Node tests, twenty-two Python SQLite/report/replay/durability/config/benchmark tests, and eight Rust tests pass locally, including native credential, bundle-scoped credential service, knowledge rollback, two-hour hard-exit recovery, production-query lexical retrieval benchmarking, answer/deep/ledger/planner/revision/invalidation deletion, retention parsing/cutoffs and dependent-row pruning, correction restore audit chaining, migration-15-to-16 invalidation preservation, tier-specific initial/deep regeneration, concurrent-correction rejection for both tiers, bounded source-linked regeneration history, exact saved-session joins, transcript correction auditing and stale-answer joins, candidate-ledger classification and prompt bounds, planner snapshot/schema/stale-revision behavior, deep-model override isolation, checkpoint reconstruction, deep-prompt labeling, useful-latency validation, and independent hard-answer rubric validation. TypeScript, Rust tests, production frontend build, the native debug build, and the isolated NSIS release build pass. The explicit smoke-identifier Windows debug executable remained alive through its isolated smoke interval; its database reported migration 15, the revision and invalidation tables, the correction audit/invalidation/cleanup triggers, and SQLite integrity `ok`. Isolated NSIS runs cover migration 14 → 15, a populated migration 15 → 16 upgrade, and both uninstall data branches. The final uninstall smoke used exact Windows generic credential records: default uninstall retained both AppData roots and both provider credentials; explicit deletion removed all four and the install directory. A Windows GitHub Actions workflow repeats Node, Python, frontend, and Rust checks on pushes and pull requests; remote run `35924992516` passed all four gates for Windows uninstall commit `e7bbf96`. Live-caption tests use a mock WebSocket; JEV tests use a fake HTTP transport, including malformed choices, HTTP failure, timeout, and cancellation that ignores abort. | Real-provider UI invocation and regeneration, actual microphone/loopback, Deepgram and answer-provider credentials, a labeled useful-card set, independently graded hard-question set, provider-backed JEV and planner evaluation, macOS/Linux gates. |

The live-caption toggle is off by default. Enabling it sends both sources continuously to Deepgram while their capture streams are active, which can incur additional provider usage alongside batch finalization. The current WebSocket uses Deepgram's documented client-side subprotocol authentication; the key is loaded from the OS store into webview memory for active use. A native streaming transport or short-lived-token route is still preferable. No provider-backed latency or accuracy claim is made from mock transport tests.
