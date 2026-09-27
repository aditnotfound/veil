# Listen model benchmark: GPT-6 Sol and Luna

On September 27, 2026, I ran eight paired spoken prompts through the packaged
Windows Veil Smoke Test app. Each prompt was spoken by Windows SAPI into a fresh
Listen session with automatic question detection. The only changed provider
setting was the OpenAI answer model. Both models used the `live-short` profile
with `reasoning_effort: none`. The configured OpenAI and STT keys stayed in
Veil's OS credential store.

| Measure | GPT-6 Sol | GPT-6 Luna |
| --- | ---: | ---: |
| Question transcribed and answer visible | 8/8 | 8/8 |
| Provider errors | 0 | 0 |
| Median answer request to first model text | 1,234 ms | 861 ms |
| Median answer request to complete answer | 1,948 ms | 1,229 ms |
| Median spoken question end to first visible answer | 2,931 ms | 2,454 ms |

The eight prompts covered arithmetic, Python dictionary lookup, Dijkstra with
negative weights, JavaScript `map`, Python mutable defaults, binary search's
sorting requirement, another arithmetic question, and database lost updates.
Both models gave correct short answers to all eight. The saved answer-card
records confirmed the requested model for every run. Luna was faster to first
model text in all eight pairs, although one Luna run took longer end to end
because transcription took longer.

This is a small synthetic replay, not a statistically reliable claim that Luna
is always faster or equally capable. It does not test noisy real calls,
interruption, long context, personal grounding, or difficult reasoning.
Transcription and capture remain material parts of visible latency. A Sol
override is available for **Go deeper**; the local smoke app uses it while
Luna handles the initial short card.

After rebuilding on September 28, the packaged app retained Luna. A fresh
automatic Python dictionary question reached visible answer text in 6,148 ms
from speech end, including 3,544 ms to visible transcription. An **Answer now**
arithmetic question reached visible answer text in 2,506 ms. A declarative
sentence was transcribed and correctly produced no answer. None showed a
provider error. These runs illustrate why the model-only median should not be
reported as full Listen latency.

The repeatable path is `scripts/test_packaged_listen.ps1` against a packaged
Windows build. The script checks transcript detection, answer visibility,
question-end timing, and provider errors. The `call_turn_timings` and
`call_answer_cards` tables provide model-specific timing and full answer text.
