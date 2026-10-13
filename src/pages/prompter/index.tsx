import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { ChevronLeft, ChevronRight, Mic, MicOff, Pencil, RotateCcw, ScrollText } from "lucide-react";
import { STORAGE_KEYS } from "@/config";
import { OpenAILiveCaptions } from "@/lib/call/openai-live-captions";
import { DeepgramLiveCaptions, pcm16FromFloat, type CaptionStatus } from "@/lib/call/deepgram-live-captions";
import { advanceScriptCursor, scriptLines, scriptWords } from "@/lib/prompter/follow-script";
import { loadProviderSelection, type ProviderKind, type SelectedProvider } from "@/lib/storage/provider-secrets";
import { CallMicCapture } from "@/pages/app/components/speech/CallMicCapture";

const SCRIPT_KEY = "veil_prompter_script_v1";
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
  const words = useMemo(() => scriptWords(script), [script]);
  const lines = useMemo(() => scriptLines(words), [words]);
  const wordsRef = useRef(words);
  const cursorRef = useRef(0);
  const lastCaptionRef = useRef("");
  const streamRef = useRef<LiveStream | null>(null);
  const speakingRef = useRef(false);
  const spokenSamplesRef = useRef(0);
  const lastCommitRef = useRef(0);
  const recentFramesRef = useRef<Float32Array[]>([]);
  const recentSamplesRef = useRef(0);

  useEffect(() => { wordsRef.current = words; }, [words]);
  useEffect(() => { localStorage.setItem(SCRIPT_KEY, script); }, [script]);

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
      if (next !== cursorRef.current) {
        cursorRef.current = next;
        setCursor(next);
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
        ? new OpenAILiveCaptions(config.key, 16000, onCaption, onStatus, tauriFetch)
        : new DeepgramLiveCaptions(config.key, config.model, 16000, onCaption, onStatus);
    } catch {
      setError("Could not start live transcription. Check the saved provider key.");
      setListening(false);
      return;
    }
    lastCaptionRef.current = "";
    spokenSamplesRef.current = 0;
    speakingRef.current = false;
    recentFramesRef.current = [];
    recentSamplesRef.current = 0;
    lastCommitRef.current = Date.now();
    const timer = setInterval(() => {
      if (streamRef.current instanceof OpenAILiveCaptions && speakingRef.current &&
          spokenSamplesRef.current >= 16000 * 0.9 && Date.now() - lastCommitRef.current >= 1200) {
        streamRef.current.commit();
        spokenSamplesRef.current = 0;
        lastCommitRef.current = Date.now();
      }
    }, 150);
    return () => {
      live = false;
      clearInterval(timer);
      streamRef.current?.close();
      streamRef.current = null;
      setStatus("off");
    };
  }, [listening, config]);

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
    lastCommitRef.current = Date.now();
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
      lastCommitRef.current = Date.now();
    }
  }, []);
  const setPosition = (position: number) => {
    const bounded = Math.max(0, Math.min(position, words.length));
    cursorRef.current = bounded;
    setCursor(bounded);
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
    setMode("read");
    setListening(true);
  };
  const stop = () => { setListening(false); setStatus("off"); };

  return (
    <main className="h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-3 overflow-hidden">
      <header className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ScrollText className="h-5 w-5 text-primary shrink-0" />
          <div>
            <h1 className="font-semibold text-sm">Teleprompter</h1>
            <p className="text-[11px] text-muted-foreground">
              {mode === "read" ? (listening ? status === "live" ? "Following your voice" : "Connecting live captions…" : "Paused") :
                "Paste what you want to say"}
            </p>
          </div>
        </div>
        {mode === "read" && <span className="text-[11px] text-muted-foreground tabular-nums">
          {Math.min(cursor, words.length)} / {words.length} words
        </span>}
      </header>

      {mode === "edit" ? <>
        <textarea
          aria-label="Teleprompter script"
          value={script}
          onChange={(event) => setScript(event.target.value)}
          placeholder="Paste your speech or notes here…"
          maxLength={50000}
          className="flex-1 min-h-0 w-full resize-none rounded-lg border border-input bg-muted/30 p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {configLoading ? "Loading live captions…" : config ?
              `Mic audio goes to ${config.provider === "openai" ? "OpenAI" : "Deepgram"} only while listening. Script stays local.` :
              "Set an OpenAI or Deepgram key in Veil settings."}
          </span>
          <button type="button" onClick={start} disabled={configLoading || !words.length}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50 shrink-0">
            Start reading
          </button>
        </div>
      </> : <>
        <div aria-live="polite" aria-label="Current script" className="flex-1 min-h-0 grid grid-rows-3 gap-1 rounded-xl bg-muted/40 border border-border px-5 py-3">
          {[-1, 0, 1].map((offset) => {
            const line = lines[currentLine + offset];
            return <div key={offset} className={`flex items-center justify-center gap-x-1.5 overflow-hidden text-center text-lg font-semibold leading-snug ${offset === 0 ? "text-foreground" : "text-muted-foreground/60"}`}>
              {line?.start === undefined ? null : words.slice(line.start, line.end).map((word, index) => {
                const position = line.start + index;
                return <span key={position} className={position < cursor ? "text-emerald-500" :
                  position === cursor ? "rounded bg-primary/15 px-0.5 text-primary" : ""}>{word.text}</span>;
              })}
            </div>;
          })}
        </div>
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous line" title="Previous line" onClick={() => moveLine(-1)} className="rounded-md border border-input p-2 hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" aria-label="Next line" title="Next line" onClick={() => moveLine(1)} className="rounded-md border border-input p-2 hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
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
      {listening && config && <CallMicCapture deviceId={selectedMicId()} onSegment={onSpeechEnd}
        onSpeechStart={onSpeechStart} onFrame={onFrame} onError={(message) => {
          setError(`Microphone unavailable: ${message}`);
          setListening(false);
        }} />}
    </main>
  );
}
