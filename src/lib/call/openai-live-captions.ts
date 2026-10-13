import type { CaptionStatus } from "./deepgram-live-captions";

type SocketLike = Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "close" | "onopen" | "onmessage" | "onerror" | "onclose">;
type SocketFactory = (url: string, protocols: string[]) => SocketLike;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type PendingEvent = { type: "audio"; audio: string; bytes: number } | { type: "commit" };
type TranscriptPart = { text: string; completed: boolean };
type LiveCaptionOptions = { delay?: "minimal" | "low" | "medium" | "high" | "xhigh" };

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
  // Final events can arrive out of order; commit acknowledgments fix display order.
  private pendingCommits: { visible: boolean }[] = [];
  private itemOrder: string[] = [];
  private items = new Map<string, TranscriptPart>();
  private earlyParts = new Map<string, TranscriptPart>();
  private hiddenItemIds = new Set<string>();
  private readonly options: LiveCaptionOptions;

  constructor(
    apiKey: string,
    sampleRate: number,
    onCaption: (text: string) => void,
    onStatus: (status: CaptionStatus) => void,
    fetcher: Fetcher = fetch,
    socketFactory: SocketFactory = (url, protocols) => new WebSocket(url, protocols),
    options: LiveCaptionOptions = {}
  ) {
    if (!apiKey) throw new Error("OpenAI live captions require an API key");
    this.onCaption = onCaption;
    this.onStatus = onStatus;
    this.fetcher = fetcher;
    this.socketFactory = socketFactory;
    this.options = options;
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
              transcription: { model: "gpt-live-transcribe", ...this.options },
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
            transcription: { model: "gpt-live-transcribe", ...this.options },
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
    if (this.closed) return;
    this.pendingCommits.push({ visible: true });
    this.queueOrSend({ type: "commit" });
  }

  /** The durable batch transcript has replaced this temporary display text. */
  resetDisplay(): void {
    for (const commit of this.pendingCommits) commit.visible = false;
    for (const id of this.itemOrder) this.hiddenItemIds.add(id);
    for (const id of this.earlyParts.keys()) this.hiddenItemIds.add(id);
    // Only recent completed items can still deliver late provider events.
    while (this.hiddenItemIds.size > 128) {
      this.hiddenItemIds.delete(this.hiddenItemIds.values().next().value!);
    }
    this.itemOrder = [];
    this.items.clear();
    this.earlyParts.clear();
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
      if (event.type === "input_audio_buffer.committed" &&
        typeof event.item_id === "string") {
        const commit = this.pendingCommits.shift();
        if (!commit?.visible || this.hiddenItemIds.has(event.item_id)) {
          this.hiddenItemIds.add(event.item_id);
          this.earlyParts.delete(event.item_id);
          return;
        }
        this.itemOrder.push(event.item_id);
        this.items.set(event.item_id,
          this.earlyParts.get(event.item_id) ?? { text: "", completed: false });
        this.earlyParts.delete(event.item_id);
        this.emitCaption();
        return;
      }
      if ((event.type === "conversation.item.input_audio_transcription.delta" ||
        event.type === "conversation.item.input_audio_transcription.completed") &&
        typeof event.item_id === "string") {
        if (this.hiddenItemIds.has(event.item_id)) return;
        const part = this.items.get(event.item_id) ??
          this.earlyParts.get(event.item_id) ?? { text: "", completed: false };
        if (event.type === "conversation.item.input_audio_transcription.delta" &&
          typeof event.delta === "string" && !part.completed) {
          part.text += event.delta;
        } else if (event.type === "conversation.item.input_audio_transcription.completed" &&
          typeof event.transcript === "string") {
          part.text = event.transcript.trim();
          part.completed = true;
        }
        if (this.items.has(event.item_id)) {
          this.items.set(event.item_id, part);
          this.emitCaption();
        } else if (this.ready && (this.earlyParts.has(event.item_id) || this.earlyParts.size < 16)) {
          // gpt-live-transcribe emits words BEFORE commit, while the person speaks.
          // Display them immediately; the acknowledgment later fixes turn order.
          this.earlyParts.set(event.item_id, part);
          this.emitCaption();
        }
      }
    } catch {
      // Ignore malformed provider messages.
    }
  }

  private emitCaption() {
    // Bound memory during long reading/call sessions, not just the emitted string.
    while (this.itemOrder.length > 64 && this.items.get(this.itemOrder[0])?.completed) {
      const id = this.itemOrder.shift()!;
      this.items.delete(id);
      this.hiddenItemIds.add(id);
    }
    while (this.hiddenItemIds.size > 128) this.hiddenItemIds.delete(this.hiddenItemIds.values().next().value!);
    // Keep interim display bounded; saved batch turns hold the full call history.
    const text = [...this.itemOrder.map((id) => this.items.get(id)?.text ?? ""),
      ...Array.from(this.earlyParts.values(), (part) => part.text)]
      .filter(Boolean).join(" ").trim().slice(-12000);
    if (text) this.onCaption(text);
  }

  private fail() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.pending = [];
    this.pendingBytes = 0;
    this.pendingCommits = [];
    this.itemOrder = [];
    this.items.clear();
    this.earlyParts.clear();
    this.hiddenItemIds.clear();
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
    this.pendingCommits = [];
    this.itemOrder = [];
    this.items.clear();
    this.earlyParts.clear();
    this.hiddenItemIds.clear();
    clearTimeout(this.connectDeadline);
    this.abort.abort();
    this.socket?.close();
  }
}
