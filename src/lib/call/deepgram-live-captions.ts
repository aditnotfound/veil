/** Optional live captions. The batch STT path remains the durable final transcript. */
export type CaptionStatus = "connecting" | "live" | "fallback";

type SocketLike = Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "close" | "onopen" | "onmessage" | "onerror" | "onclose">;
type SocketFactory = (url: string, protocols: string[]) => SocketLike;

const MAX_BUFFERED_BYTES = 256 * 1024;

export function pcm16FromFloat(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return bytes;
}

export function pcm16FromBase64(encoded: string): ArrayBuffer {
  const decoded = atob(encoded);
  if (decoded.length % 2 !== 0) throw new Error("Invalid PCM frame");
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes.buffer;
}

export class DeepgramLiveCaptions {
  private socket: SocketLike;
  private committed: string[] = [];
  private closed = false;
  private keepAlive: ReturnType<typeof setInterval>;
  private onCaption: (text: string) => void;
  private onStatus: (status: CaptionStatus) => void;

  constructor(
    apiKey: string,
    model: string,
    sampleRate: number,
    onCaption: (text: string) => void,
    onStatus: (status: CaptionStatus) => void,
    socketFactory: SocketFactory = (url, protocols) => new WebSocket(url, protocols)
  ) {
    if (!apiKey || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
      throw new Error("Live captions require a Deepgram key and valid audio sample rate");
    }
    this.onCaption = onCaption;
    this.onStatus = onStatus;
    const url = new URL("wss://api.deepgram.com/v1/listen");
    url.searchParams.set("model", model || "nova-2");
    url.searchParams.set("encoding", "linear16");
    url.searchParams.set("sample_rate", String(sampleRate));
    url.searchParams.set("channels", "1");
    url.searchParams.set("interim_results", "true");
    url.searchParams.set("endpointing", "400");
    this.onStatus("connecting");
    // Deepgram's documented client-side authentication. The key is never in the URL.
    this.socket = socketFactory(url.toString(), ["token", apiKey]);
    this.socket.onopen = () => this.onStatus("live");
    this.socket.onerror = () => this.fail();
    this.socket.onclose = () => this.fail();
    this.socket.onmessage = (event) => this.acceptMessage(event.data);
    this.keepAlive = setInterval(() => {
      if (!this.closed && this.socket.readyState === 1) {
        try { this.socket.send(JSON.stringify({ type: "KeepAlive" })); }
        catch { this.fail(); }
      }
    }, 5000);
  }

  sendPcm(frame: ArrayBuffer): boolean {
    if (this.closed || this.socket.readyState !== 1) return false;
    if (!frame.byteLength || frame.byteLength % 2 || this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.fail();
      return false;
    }
    try { this.socket.send(frame); return true; }
    catch { this.fail(); return false; }
  }

  private acceptMessage(raw: unknown) {
    if (this.closed || typeof raw !== "string") return;
    try {
      const message = JSON.parse(raw);
      if (message.type === "Error") {
        this.fail();
        return;
      }
      if (message.type !== "Results") return;
      const piece = message.channel?.alternatives?.[0]?.transcript;
      if (typeof piece !== "string") return;
      const text = piece.trim();
      if (message.is_final && text) this.committed.push(text);
      const caption = [...this.committed, ...(!message.is_final && text ? [text] : [])]
        .join(" ").trim();
      if (caption) this.onCaption(caption);
      if (message.speech_final) this.committed = [];
    } catch {
      // Malformed provider messages cannot become captions or crash capture.
    }
  }

  private fail() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAlive);
    this.onStatus("fallback");
    this.socket.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAlive);
    if (this.socket.readyState === 1) {
      this.socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.socket.close();
  }
}
