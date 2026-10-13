import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ChevronLeft, ChevronRight, Mic, MicOff, Minus, Pencil, Plus, RotateCcw, ScrollText } from "lucide-react";
import { STORAGE_KEYS } from "@/config";
import { OpenAILiveCaptions } from "@/lib/call/openai-live-captions";
import { DeepgramLiveCaptions, pcm16FromFloat, type CaptionStatus } from "@/lib/call/deepgram-live-captions";
import { advanceScriptCursor, fitScriptLines, scriptWords } from "@/lib/prompter/follow-script";
import { loadProviderSelection, type ProviderKind, type SelectedProvider } from "@/lib/storage/provider-secrets";
import { CallMicCapture } from "@/pages/app/components/speech/CallMicCapture";

const SCRIPT_KEY = "veil_prompter_script_v1";
const SIZE_KEY = "veil_prompter_font_size_v1";
const DELAY_KEY = "veil_prompter_delay_v1";
type LiveConfig = { provider: "openai" | "deepgram"; key: string; model: string };
type LiveStream = OpenAILiveCaptions | DeepgramLiveCaptions;

const vault = {
  get: (kind: ProviderKind) => invoke<string | null>("get_provider_secret", { kind }),
  save: (kind: ProviderKind, secret: string) => invoke<void>("save_provider_secret", { kind, secret }),
  remove: (kind: ProviderKind) => invoke<void>("remove_provider_secret", { kind }),
};

function keyFrom(provider: SelectedProvider): string {
  return Object.entries(provider.variables)
    .find(([name]) => name.toUpperCase() === "API_KEY")?.[1]?.trim() ?? "";
}

function selectedMicId(): string {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.SELECTED_AUDIO_DEVICES) ?? "null");
    return typeof value?.input?.id === "string" ? value.input.id : "default";
  } catch {
    return "default";
  }
}

export default function Prompter() {
  const [script, setScript] = useState(() => localStorage.getItem(SCRIPT_KEY) ?? "");
  const [mode, setMode] = useState<"edit" | "read">("edit");
  const [cursor, setCursor] = useState(0);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<CaptionStatus | "off">("off");
  const [config, setConfig] = useState<LiveConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [error, setError] = useState("");
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem(SIZE_KEY));
    return saved >= 12 && saved <= 30 ? saved : 14;
  });
  const [delay, setDelay] = useState<"minimal" | "low">(() =>
    localStorage.getItem(DELAY_KEY) === "low" ? "low" : "minimal");
  const [streamVersion, setStreamVersion] = useState(0);
  const [heard, setHeard] = useState("");
  const [readerWidth, setReaderWidth] = useState(680);
  const [readerHeight, setReaderHeight] = useState(150);
  const [fontFamily, setFontFamily] = useState("sans-serif");
  const readerRef = useRef<HTMLDivElement>(null);
  const words = useMemo(() => scriptWords(script), [script]);
  const readingSize = Math.min(fontSize, Math.max(8, (readerHeight - 8) / 3 / 1.65));
  const layout = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = `500 ${readingSize}px ${fontFamily}`;
    const measure = (text: string) => (context?.measureText(text).width ?? text.length * readingSize * 0.6) + 4;
    return { measure, lines: fitScriptLines(words, readerWidth, measure, readingSize * 0.3) };
  }, [words, readerWidth, readingSize, fontFamily]);
  const lines = layout.lines;
  const wordsRef = useRef(words);
  const cursorRef = useRef(0);
  const lastCaptionRef = useRef("");
  const streamRef = useRef<LiveStream | null>(null);
  const speakingRef = useRef(false);
  const spokenSamplesRef = useRef(0);
  const recentFramesRef = useRef<Float32Array[]>([]);
  const recentSamplesRef = useRef(0);

  useEffect(() => { wordsRef.current = words; }, [words]);
  useEffect(() => { localStorage.setItem(SCRIPT_KEY, script); }, [script]);
  useEffect(() => { localStorage.setItem(SIZE_KEY, String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem(DELAY_KEY, delay); }, [delay]);
  useLayoutEffect(() => {
    const element = readerRef.current;
    if (!element) return;
    setFontFamily(getComputedStyle(element).fontFamily);
    const observer = new ResizeObserver(([entry]) => {
      setReaderWidth(Math.max(80, entry.contentRect.width));
      setReaderHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const currentRequest = ++request;
      setConfigLoading(true);
      const [aiResult, sttResult] = await Promise.allSettled([
          loadProviderSelection("ai", STORAGE_KEYS.SELECTED_AI_PROVIDER, localStorage, vault),
          loadProviderSelection("stt", STORAGE_KEYS.SELECTED_STT_PROVIDER, localStorage, vault),
        ]);
      if (!active || currentRequest !== request) return;
      try {
        if (aiResult.status === "rejected" && sttResult.status === "rejected") {
          throw new Error("Saved speech credentials unavailable");
        }
        const empty: SelectedProvider = { provider: "", variables: {} };
        const ai = aiResult.status === "fulfilled" ? aiResult.value : empty;
        const stt = sttResult.status === "fulfilled" ? sttResult.value : empty;
        const openaiKey = (ai.provider === "openai" ? keyFrom(ai) : "") ||
          (stt.provider === "openai-whisper" ? keyFrom(stt) : "");
        const deepgramKey = stt.provider === "deepgram-stt" ? keyFrom(stt) : "";
        const model = Object.entries(stt.variables)
          .find(([name]) => name.toUpperCase() === "MODEL")?.[1] || "nova-2";
        setConfig(openaiKey ? { provider: "openai", key: openaiKey, model: "" } :
          deepgramKey ? { provider: "deepgram", key: deepgramKey, model } : null);
        setError("");
      } catch {
        setConfig(null);
        setError("Could not load the saved speech provider. Check Veil settings.");
      } finally {
        setConfigLoading(false);
      }
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.SELECTED_AI_PROVIDER ||
          event.key === STORAGE_KEYS.SELECTED_STT_PROVIDER) void load();
    };
    window.addEventListener("storage", onStorage);
    return () => { active = false; window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    if (!listening || !config) return;
    let live = true;
    const onCaption = (text: string) => {
      if (!live) return;
      const next = advanceScriptCursor(wordsRef.current, cursorRef.current, lastCaptionRef.current, text);
      lastCaptionRef.current = text;
      setHeard(text.split(/\s+/).slice(-12).join(" "));
      if (next !== cursorRef.current) {
        cursorRef.current = next;
        setCursor(next);
        if (next === wordsRef.current.length) setListening(false);
      }
    };
    const onStatus = (value: CaptionStatus) => {
      if (!live) return;
      setStatus(value);
      if (value === "fallback") {
        setError("Live transcription disconnected. Check the microphone, provider key, and connection.");
        setListening(false);
      }
    };
    try {
      streamRef.current = config.provider === "openai"
        ? new OpenAILiveCaptions(config.key, 16000, onCaption, onStatus, tauriFetch, undefined, { delay })
        : new DeepgramLiveCaptions(config.key, config.model, 16000, onCaption, onStatus);
    } catch {
      setError("Could not start live transcription. Check the saved provider key.");
      setListening(false);
      return;
    }
    lastCaptionRef.current = "";
    setHeard("");
    spokenSamplesRef.current = 0;
    speakingRef.current = false;
    recentFramesRef.current = [];
    recentSamplesRef.current = 0;
    const timer = setInterval(() => {
      if (streamRef.current instanceof OpenAILiveCaptions && speakingRef.current &&
          spokenSamplesRef.current >= 16000 * 20) {
        // Deltas already advance the script. Finalize only to bound long turns.
        streamRef.current.commit();
        spokenSamplesRef.current = 0;
      }
    }, 250);
    return () => {
      live = false;
      clearInterval(timer);
      streamRef.current?.close();
      streamRef.current = null;
      setStatus("off");
    };
  }, [listening, config, delay, streamVersion]);

  const onFrame = useCallback((samples: Float32Array) => {
    const stream = streamRef.current;
    if (!stream) return;
    if (!speakingRef.current) {
      recentFramesRef.current.push(new Float32Array(samples));
      recentSamplesRef.current += samples.length;
      while (recentSamplesRef.current > 16000 * 0.45 && recentFramesRef.current.length > 1) {
        recentSamplesRef.current -= recentFramesRef.current.shift()!.length;
      }
      return;
    }
    spokenSamplesRef.current += samples.length;
    if (!stream.sendPcm(pcm16FromFloat(samples))) {
      setError("Live transcription stopped. Check your provider connection.");
      setListening(false);
    }
  }, []);
  const onSpeechStart = useCallback(() => {
    speakingRef.current = true;
    const stream = streamRef.current;
    if (stream) for (const frame of recentFramesRef.current) {
      spokenSamplesRef.current += frame.length;
      if (!stream.sendPcm(pcm16FromFloat(frame))) {
        setError("Live transcription stopped. Check your provider connection.");
        setListening(false);
        break;
      }
    }
    recentFramesRef.current = [];
    recentSamplesRef.current = 0;
  }, []);
  const onSpeechEnd = useCallback(() => {
    speakingRef.current = false;
    if (streamRef.current instanceof OpenAILiveCaptions && spokenSamplesRef.current >= 16000 * 0.2) {
      streamRef.current.commit();
      spokenSamplesRef.current = 0;
    }
  }, []);
  const setPosition = (position: number) => {
    const bounded = Math.max(0, Math.min(position, words.length));
    cursorRef.current = bounded;
    setCursor(bounded);
    lastCaptionRef.current = "";
    setHeard("");
    // Ignore transcripts still in flight from before a manual seek/restart.
    if (listening) {
      streamRef.current?.close();
      streamRef.current = null;
      setStreamVersion((version) => version + 1);
    }
  };
  const lineIndex = lines.findIndex(({ end }) => cursor < end);
  const currentLine = lineIndex < 0 ? Math.max(0, lines.length - 1) : lineIndex;
  const moveLine = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(currentLine + direction, lines.length - 1));
    setPosition(lines[next]?.start ?? 0);
  };
  const start = () => {
    if (!words.length) { setError("Paste a script first."); return; }
    if (!config) { setError("Set an OpenAI or Deepgram key in Veil settings first."); return; }
    setError("");
    if (cursorRef.current === words.length) setPosition(0);
    setMode("read");
    setListening(true);
  };
  const stop = () => {
    streamRef.current?.close();
    streamRef.current = null;
    setListening(false);
    setStatus("off");
  };

  return (
    <main className="h-screen w-screen bg-background text-foreground p-3 flex flex-col gap-2 overflow-hidden">
      <header className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ScrollText className="h-5 w-5 text-primary shrink-0" />
          <div>
            <h1 className="font-semibold text-sm">Teleprompter</h1>
            <p className="text-[11px] text-muted-foreground">
              {mode === "read" ? (cursor === words.length ? "Finished" : listening ? status === "live" ? "Following your voice" : "Connecting live captions…" : "Paused") :
                "Paste what you want to say"}
            </p>
          </div>
        </div>
        {mode === "read" && <span className="text-[11px] text-muted-foreground tabular-nums">
          {Math.min(cursor, words.length)} / {words.length} words
        </span>}
      </header>

      <div className="flex items-center justify-between gap-2 shrink-0 text-xs">
        <div className="flex items-center gap-1" role="group" aria-label="Text size">
          <span className="text-muted-foreground mr-1">Text</span>
          <button type="button" aria-label="Smaller text" disabled={fontSize <= 12} onClick={() => setFontSize((size) => Math.max(12, size - 2))}
            className="p-2 rounded-md border border-input hover:bg-muted disabled:opacity-30"><Minus className="h-3 w-3" /></button>
          <input aria-label="Text size" type="range" min={12} max={30} step={2} value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))} className="w-20 accent-primary" />
          <button type="button" aria-label="Larger text" disabled={fontSize >= 30} onClick={() => setFontSize((size) => Math.min(30, size + 2))}
            className="p-2 rounded-md border border-input hover:bg-muted disabled:opacity-30"><Plus className="h-3 w-3" /></button>
          <output className="w-9 text-center tabular-nums text-muted-foreground">{fontSize}px</output>
        </div>
        {config?.provider === "openai" && <label className="flex items-center gap-1 text-muted-foreground">
          Tracking
          <select aria-label="Tracking speed" value={delay} onChange={(event) => {
            stop();
            setDelay(event.target.value as "minimal" | "low");
          }} className="rounded-md border border-input bg-background text-foreground p-1.5">
            <option value="minimal">Fastest</option>
            <option value="low">More accurate</option>
          </select>
        </label>}
      </div>

      {mode === "edit" ? <>
        <textarea
          aria-label="Teleprompter script"
          value={script}
          onChange={(event) => { setScript(event.target.value); setPosition(0); }}
          placeholder="Paste your speech or notes here…"
          maxLength={50000}
          style={{ fontSize }}
          className="flex-1 min-h-0 w-full resize-none rounded-lg border border-input bg-muted/30 p-3 leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {configLoading ? "Loading live captions…" : config ?
              `Mic audio goes to ${config.provider === "openai" ? "OpenAI" : "Deepgram"} only while listening. Script stays local.` :
              "Set an OpenAI or Deepgram key in Veil settings."}
          </span>
          <button type="button" disabled={!words.length} onClick={() => { setError(""); setMode("read"); }}
            className="rounded-md border border-input px-3 py-2 text-xs hover:bg-muted disabled:opacity-50 shrink-0">Preview</button>
          <button type="button" onClick={start} disabled={configLoading || !words.length}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50 shrink-0">
            Start reading
          </button>
        </div>
      </> : <>
        <div ref={readerRef} aria-label="Current script" className="flex-1 min-h-0 flex flex-col justify-center gap-1 rounded-lg bg-muted/40 border border-border px-3 py-2">
          {[-1, 0, 1].map((offset) => {
            const line = lines[currentLine + offset];
            const lineWords = line ? words.slice(line.start, line.end) : [];
            const lineWidth = lineWords.reduce((width, word) => width + layout.measure(word.text), 0) + Math.max(0, lineWords.length - 1) * readingSize * 0.3;
            const fittedSize = Math.min(readingSize, readingSize * (readerWidth - 4) / Math.max(1, lineWidth));
            return <div key={offset} style={{ fontSize: fittedSize, minHeight: readingSize * 1.65, columnGap: fittedSize * 0.3 }}
              className={`flex items-center justify-center whitespace-nowrap text-center font-medium leading-relaxed ${offset === 0 ? "text-foreground" : "text-muted-foreground/60"}`}>
              {line?.start === undefined ? null : words.slice(line.start, line.end).map((word, index) => {
                const position = line.start + index;
                return <button type="button" key={position} aria-label={`Read from ${word.text}`} title="Click to read from here"
                  aria-current={position === cursor ? "step" : undefined} onClick={() => setPosition(position)}
                  className={`shrink-0 rounded px-0.5 hover:bg-primary/20 focus-visible:outline focus-visible:outline-primary ${position < cursor ? "text-emerald-500" :
                    position === cursor ? "bg-primary/15 text-primary" : ""}`}>{word.text}</button>;
              })}
            </div>;
          })}
        </div>
        <div className="shrink-0 h-4 text-[11px] text-muted-foreground truncate" title={heard}>
          {heard ? `Heard: ${heard}` : "Follows your speech · Click any word to jump there"}
        </div>
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous line" title="Previous line" disabled={currentLine === 0} onClick={() => moveLine(-1)} className="rounded-md border border-input p-2 hover:bg-muted disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next line" title="Next line" disabled={currentLine === lines.length - 1} onClick={() => moveLine(1)} className="rounded-md border border-input p-2 hover:bg-muted disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" aria-label="Restart script" title="Restart script" onClick={() => setPosition(0)} className="rounded-md border border-input p-2 hover:bg-muted"><RotateCcw className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { stop(); setMode("edit"); }} className="rounded-md border border-input px-3 py-2 text-xs flex items-center gap-1.5 hover:bg-muted"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            <button type="button" onClick={listening ? stop : start} className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs flex items-center gap-1.5">
              {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              {listening ? "Pause" : "Listen"}
            </button>
          </div>
        </div>
      </>}
      {error && <p role="alert" className="shrink-0 text-xs text-destructive">{error}</p>}
      {listening && config && <CallMicCapture key={streamVersion} deviceId={selectedMicId()} onSpeechEnd={onSpeechEnd}
        onSpeechStart={onSpeechStart} onFrame={onFrame} onError={(message) => {
          setError(`Microphone unavailable: ${message}`);
          setListening(false);
        }} />}
    </main>
  );
}
