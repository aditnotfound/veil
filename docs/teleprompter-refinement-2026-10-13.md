# Teleprompter refinement check — October 13, 2026

The reader now starts at 14px and saves the user's 12–30px size choice. Lines are
measured using the rendered font and available window space. Preview works with
the microphone off, and clicking a word moves the reading position there.

Speech matching uses bounded local sequence alignment. It tolerates omitted or
misheard words when subsequent matching words establish the position. Fillers,
restarts, corrections, and repeated passages are covered by regression cases.
It does not advance on a timer or invent words that have not been recognized.

The OpenAI adapter previously held transcript deltas until a commit was
acknowledged. It now emits pre-commit deltas immediately and reconciles them with
the final item without duplicating text. The teleprompter requests `minimal`
transcription delay by default; the More accurate option requests `low`. Audio
continues through one streaming connection. Final commits happen at speech end
or after 20 seconds of continuous audio, rather than cutting speech every 1.2s.

Reference: [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

## Live provider check

Used Windows synthetic speech, streamed in real time directly to the existing
OpenAI adapter. This bypasses microphone capture and is not a human reading test.
The spoken fixture deliberately omitted words and said “gradient decent” where
the script contained “gradient descent.” No key, audio, or transcript is logged
by the check script.

| Measurement | Result |
| --- | ---: |
| Fixture duration | 12,585 ms |
| First caption after audio streaming started | 922 ms |
| Caption updates before final commit | 31 |
| Script cursor at end | 29 / 29 words |
| Longest local matching operation | 1.91 ms |
| Connection status | Live |

The first-caption measurement is from the beginning of audio streaming, not a
per-word latency percentile. It excludes connection setup. No production latency
guarantee or microphone accuracy claim follows from this one synthetic fixture.

The opt-in check is `scripts/check_prompter_stream.mjs`. It accepts a mono PCM16
WAV, a corresponding UTF-8 script text file, and `OPENAI_API_KEY` in the process
environment. Default automated tests do not call a provider.

## Release checks

- All 76 Node tests passed, including pre-commit delta delivery and phrase recovery.
- TypeScript/frontend build and packaged Windows Tauri release build passed.
- In the packaged window, Preview stayed paused; changing 14px to 30px and 12px
  changed the amount of script in each line. The endpoints disabled the matching
  size button. Clicking a later word moved the cursor from 0 to 31 of 48 words.
- Restored 14px, closed and reopened the teleprompter, and verified that the size
  and Fastest setting persisted. The user's saved script was preserved.
- The screen-protected window cannot be visually judged from its captured image;
  packaged controls were checked through the Windows accessibility state. A
  human microphone reading and visual comfort check remain unverified.
