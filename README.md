# Veil

Invisible desktop AI overlay. Bring your own API keys. Keep chats, transcripts, and personal knowledge on your machine.

Based on the open-source [Pluely](https://github.com/iamsrikanthnani/pluely) project (GPL-3.0).

![Veil overlay](images/app-image.png)

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
