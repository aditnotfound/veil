# Veil

Invisible desktop AI overlay. Bring your own API keys. Keep chats, transcripts, and personal knowledge on your machine.

Based on the open-source [Pluely](https://github.com/iamsrikanthnani/pluely) `0.1.9` tree (GPL-3.0). Veil keeps bring-your-own keys, local data, and unlocks the UI features that upstream gated behind a license server.

![Veil overlay](images/app-image.png)

> **Privacy note:** API keys, chat history, and `veil.db` stay on your machine. Do not commit `.env` files or databases. Contact for security reports is on [SECURITY.md](SECURITY.md) (LinkedIn / X — no personal email in the repo).

## Features

- **Ask** — questions over your screen with screenshots and streaming answers
- **Listen** — system audio capture → STT → optional auto answers
- **Knowledge** — personal notes/docs embedded locally; relevant chunks injected into prompts (RAG)
- **BYO providers** — OpenAI and other curl-configured LLM / STT endpoints
- **Stealth overlay** — always available, minimal chrome

## Quick start (dev)

Prerequisites: Node.js LTS, Rust, Visual Studio C++ Build Tools, WebView2.

```bash
npm install
npm run tauri dev
```

Production build:

```bash
npm run tauri build
```

### Windows uninstall data choice

The interactive NSIS uninstaller leaves **Delete app data** unchecked by default. Leave it unchecked to retain Veil's local database, settings, and provider credentials for a reinstall; select it to remove the bundle's roaming/local AppData and its AI/STT credentials from Windows Credential Manager. A silent uninstall also retains data by default. Use `uninstall.exe /S /DELETEAPPDATA` only when removal of both local data and stored provider credentials is intended. Updater-driven uninstalls preserve data regardless of this flag.

### Local retrieval benchmark

Run `python scripts/benchmark_local_retrieval.py --assert-gates` to measure the exact SQLite FTS5 query at 100, 1,000, and 10,000 chunks. The report separates anchored lexical queries from paraphrase-only diagnostics and reports first-pass plus warmed p50/p95 latency. Its deterministic synthetic corpus is a regression check, not evidence of semantic retrieval quality on real documents.

## Configure

1. Open the dashboard (`Ctrl+Shift+D` on Windows)
2. **Dev space** — add your OpenAI (or other) API key + model
3. **STT** — e.g. OpenAI Whisper / `gpt-4o-transcribe` + model id
4. **Knowledge** — add résumé notes or text files for personal answers

## Shortcuts (Windows defaults)

| Action | Shortcut |
|--------|----------|
| Show / hide overlay | `Ctrl+\` |
| Dashboard | `Ctrl+Shift+D` |
| Screenshot | `Ctrl+Shift+S` |
| Voice / PTT | `Ctrl+Space` (or `Ctrl+Shift+A`) |
| System audio listen | `Ctrl+Shift+M` |

## Links

- [LinkedIn](https://www.linkedin.com/in/adit-patil/)
- [X](https://x.com/aditnotfound)
- [GitHub](https://github.com/aditnotfound)

## License

GPL-3.0. See [LICENSE](LICENSE). Upstream Pluely copyright remains attributed to its original authors.
