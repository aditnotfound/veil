import type { CaptionStatus } from "./deepgram-live-captions";

type SocketLike = Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "close" | "onopen" | "onmessage" | "onerror" | "onclose">;
type SocketFactory = (url: string, protocols: string[]) => SocketLike;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type PendingEvent = { type: "audio"; audio: string; bytes: number } | { type: "commit" };

const TARGET_RATE = 24_000;
const MAX_PENDING_BYTES = 512 * 1024;

/** Keep sample positions continuous across the small frames emitted by capture. */
export class Pcm16Resampler {
  private readonly inputRate: number;
  private inputSeen = 0;
  private outputSent = 0;
  private previous = 0;

  constructor(inputRate: number) {
    if (!Number.isInteger(inputRate) || inputRate < 8000 || inputRate > 96000) {
      throw new Error("Invalid live audio sample rate");
    }
    this.inputRate = inputRate;
  }

  process(frame: ArrayBuffer): ArrayBuffer {
    if (!frame.byteLength || frame.byteLength % 2) throw new Error("Invalid PCM frame");
    const input = new DataView(frame);
    const count = frame.byteLength / 2;
    const start = this.inputSeen;
    const end = start + count - 1;
    const output: number[] = [];
    while (true) {
      const position = this.outputSent * this.inputRate / TARGET_RATE;
      const left = Math.floor(position);
      const fraction = position - left;
      if (position > end || (fraction > 1e-9 && left >= end)) break;
      const first = left < start ? this.previous : input.getInt16((left - start) * 2, true);
      const second = fraction < 1e-9 ? first : input.getInt16((left + 1 - start) * 2, true);
      output.push(Math.max(-32768, Math.min(32767, Math.round(first + (second - first) * fraction))));
      this.outputSent++;
    }
    this.previous = input.getInt16((count - 1) * 2, true);
    this.inputSeen += count;
    const result = new ArrayBuffer(output.length * 2);
    const view = new DataView(result);
    output.forEach((sample, index) => view.setInt16(index * 2, sample, true));
    return result;
  }
}

function base64Pcm(frame: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(frame)));
}

/**
 * OpenAI Realtime transcription is a display-only stream. Completed clip STT
 * remains the source of saved call turns, answers, and the session ledger.
 */
export class OpenAILiveCaptions {
  private readonly onCaption: (text: string) => void;
  private readonly onStatus: (status: CaptionStatus) => void;
  private readonly fetcher: Fetcher;
  private readonly socketFactory: SocketFactory;
  private socket: SocketLike | null = null;
  private readonly resampler: Pcm16Resampler;
  private readonly abort = new AbortController();
  private readonly connectDeadline: ReturnType<typeof setTimeout>;
  private pending: PendingEvent[] = [];
  private pendingBytes = 0;
  private ready = false;
  private closed = false;
  private current = "";
  private completed: string[] = [];

  constructor(
    apiKey: string,
    sampleRate: number,
    onCaption: (text: string) => void,
    onStatus: (status: CaptionStatus) => void,
    fetcher: Fetcher = fetch,
    socketFactory: SocketFactory = (url, protocols) => new WebSocket(url, protocols)
  ) {
    if (!apiKey) throw new Error("OpenAI live captions require an API key");
    this.onCaption = onCaption;
    this.onStatus = onStatus;
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.resampler = new Pcm16Resampler(sampleRate);
    this.onStatus("connecting");
    this.connectDeadline = setTimeout(() => this.fail(), 12_000);
    void this.connect(apiKey);
  }

  private async connect(apiKey: string) {
    try {
      const response = await this.fetcher("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            type: "transcription",
            audio: { input: {
              format: { type: "audio/pcm", rate: TARGET_RATE },
              transcription: { model: "gpt-live-transcribe" },
              turn_detection: null,
            } },
          },
        }),
        signal: this.abort.signal,
      });
      if (!response.ok) throw new Error("OpenAI live session unavailable");
      const data: unknown = await response.json();
      const token = typeof data === "object" && data !== null && "value" in data
        ? (data as { value: unknown }).value : null;
      if (typeof token !== "string" || !token.startsWith("ek_")) throw new Error("Invalid live session token");
      if (this.closed) return;
      const socket = this.socketFactory("wss://api.openai.com/v1/realtime?intent=transcription",
        ["realtime", `openai-insecure-api-key.${token}`]);
      this.socket = socket;
      socket.onopen = () => {
        if (this.closed) return;
        socket.send(JSON.stringify({ type: "session.update", session: {
          type: "transcription",
          audio: { input: {
            format: { type: "audio/pcm", rate: TARGET_RATE },
            transcription: { model: "gpt-live-transcribe" },
            turn_detection: null,
          } },
        } }));
      };
      socket.onmessage = (event) => this.acceptMessage(event.data);
      socket.onerror = () => this.fail();
      socket.onclose = () => this.fail();
    } catch {
      this.fail();
    }
  }

  sendPcm(frame: ArrayBuffer): boolean {
    if (this.closed) return false;
    try {
      const converted = this.resampler.process(frame);
      if (!converted.byteLength) return true;
      const event: PendingEvent = { type: "audio", audio: base64Pcm(converted), bytes: converted.byteLength };
      return this.queueOrSend(event);
    } catch {
      this.fail();
      return false;
    }
  }

  commit(): void {
    if (!this.closed) this.queueOrSend({ type: "commit" });
  }

  /** The durable batch transcript has replaced this temporary display text. */
  resetDisplay(): void {
    this.completed = [];
    this.current = "";
  }

  private queueOrSend(event: PendingEvent): boolean {
    if (this.ready) return this.sendEvent(event);
    if (event.type === "audio") this.pendingBytes += event.bytes;
    if (this.pendingBytes > MAX_PENDING_BYTES) {
      this.fail();
      return false;
    }
    this.pending.push(event);
    return true;
  }

  private sendEvent(event: PendingEvent): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || socket.bufferedAmount > MAX_PENDING_BYTES) {
      this.fail();
      return false;
    }
    try {
      socket.send(JSON.stringify(event.type === "audio"
        ? { type: "input_audio_buffer.append", audio: event.audio }
        : { type: "input_audio_buffer.commit" }));
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  private acceptMessage(raw: unknown) {
    if (this.closed || typeof raw !== "string") return;
    try {
      const event = JSON.parse(raw);
      if (event.type === "error") return this.fail();
      if (event.type === "session.updated") {
        clearTimeout(this.connectDeadline);
        this.ready = true;
        this.onStatus("live");
        const queued = this.pending;
        this.pending = [];
        this.pendingBytes = 0;
        for (const item of queued) if (!this.sendEvent(item)) break;
        return;
      }
      if (event.type === "conversation.item.input_audio_transcription.delta" &&
        typeof event.delta === "string") {
        this.current += event.delta;
        this.emitCaption();
      } else if (event.type === "conversation.item.input_audio_transcription.completed" &&
        typeof event.transcript === "string") {
        const final = event.transcript.trim();
        if (final) this.completed.push(final);
        this.current = "";
        this.emitCaption();
      }
    } catch {
      // Ignore malformed provider messages.
    }
  }

  private emitCaption() {
    // Keep interim display bounded; saved batch turns hold the full call history.
    const text = [...this.completed, this.current].join(" ").trim().slice(-12000);
    if (text) this.onCaption(text);
  }

  private fail() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.pending = [];
    this.pendingBytes = 0;
    clearTimeout(this.connectDeadline);
    this.abort.abort();
    this.onStatus("fallback");
    this.socket?.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.pending = [];
    this.pendingBytes = 0;
    clearTimeout(this.connectDeadline);
    this.abort.abort();
    this.socket?.close();
  }
}
