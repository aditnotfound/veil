import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
import {
  safeLocalStorage,
  shouldUsePluelyAPI,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  listListenModes,
} from "@/lib";
import { Message } from "@/types/completion";
import type { ListenModeWithPrompt } from "@/types";
import { CallSessionCore, type AnswerJob, type FinalUtterance } from "@/lib/call/session-core";
import { createCallSession, appendCallUtterance, endCallSession, searchCallUtterances } from "@/lib/database/call-session.action";
import { formatCallEvidence } from "@/lib/call/local-search";
import { estimateWavStartAt } from "@/lib/call/audio-timing";
import { saveCallTurnTiming, type CallTurnTiming } from "@/lib/database/call-timing.action";
import { saveCallTurnDecision } from "@/lib/database/call-decision.action";
import { saveCallJevShadow, type StoredJevShadowStatus } from "@/lib/database/call-jev-shadow.action";
import { saveCallAnswerCard, saveCallDeepAnswer } from "@/lib/database/call-answer-card.action";
import { appendCallSessionLedger } from "@/lib/database/call-session-ledger.action";
import { deleteCallSessionPlanRevision, saveCallSessionPlan } from "@/lib/database/call-session-plan.action";
import type { AnswerStreamEvent } from "@/lib/call/answer-card";
import { buildJevShadowRequest, requestJevShadow } from "@/lib/call/jev-shadow";
import { DeepgramLiveCaptions, pcm16FromBase64, pcm16FromFloat, type CaptionStatus } from "@/lib/call/deepgram-live-captions";
import { routeCallTurn, normalizeTurn, callCardPrompt, deepCallPrompt, type AnsweredTurn, type AutoResponseMode, type CallDecision } from "@/lib/call/decision-router";
import { formatSessionLedgerEvidence, selectSessionLedgerEntries } from "@/lib/call/session-ledger";
import { buildSessionPlannerSnapshot, formatSessionPlanEvidence, parseSessionPlan, SESSION_PLANNER_MILESTONE, SESSION_PLANNER_PROMPT, SessionPlannerCoordinator, type ActiveSessionPlan } from "@/lib/call/session-planner";
import { selectedModelName, withModelOverride } from "@/lib/call/deep-provider";
export type { AutoResponseMode } from "@/lib/call/decision-router";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

// OPTIMIZED VAD defaults - matches backend exactly for perfect performance
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012, // Much less sensitive - only real speech
  peak_threshold: 0.035, // Higher threshold - filters clicks/noise
  silence_chunks: 20, // ~0.46s of required silence at nominal 44.1 kHz
  min_speech_chunks: 7, // ~0.16s - captures short answers
  pre_speech_chunks: 12, // ~0.27s - enough to catch word start
  noise_gate_threshold: 0.003, // Stronger noise filtering
  max_recording_duration_secs: 180, // 3 minutes default
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export type AutoResponsePace = "fast" | "balanced" | "relaxed";

const AUTO_RESPONSE_PACE_MS: Record<AutoResponsePace, number> = {
  fast: 0,
  balanced: 250,
  relaxed: 750,
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Transcription timed out (${ms / 1000}s)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [lastAnswerPrompt, setLastAnswerPrompt] = useState<string>("");
  const [deepAIResponse, setDeepAIResponse] = useState<string>("");
  const [isDeepProcessing, setIsDeepProcessing] = useState(false);
  const [deepAnswerStatus, setDeepAnswerStatus] = useState<"draft" | null>(null);
  const [deepAnswerError, setDeepAnswerError] = useState("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0); // For continuous mode
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);
  const [autoResponseMode, setAutoResponseModeState] =
    useState<AutoResponseMode>("after_pause");
  const [autoResponsePace, setAutoResponsePaceState] =
    useState<AutoResponsePace>("balanced");
  const [jevShadowEnabled, setJevShadowEnabledState] = useState(false);
  const [jevShadowStatus, setJevShadowStatus] = useState("Off");
  const [sessionPlannerEnabled, setSessionPlannerEnabledState] = useState(false);
  const [sessionPlannerStatus, setSessionPlannerStatus] = useState("Off");
  const [deepModelOverride, setDeepModelOverrideState] = useState(
    () => safeLocalStorage.getItem("call_deep_model_override") ?? ""
  );
  const [micEnabled, setMicEnabled] = useState(true);
  const [micError, setMicError] = useState("");
  const [liveCaptionsEnabled, setLiveCaptionsEnabled] = useState(
    () => safeLocalStorage.getItem("call_live_captions_enabled") === "true"
  );
  const [systemLiveStatus, setSystemLiveStatus] = useState<CaptionStatus | "off">("off");
  const [micLiveStatus, setMicLiveStatus] = useState<CaptionStatus | "off">("off");
  const [partialSystemCaption, setPartialSystemCaption] = useState("");
  const [partialMicCaption, setPartialMicCaption] = useState("");

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");
  const [listenModes, setListenModes] = useState<ListenModeWithPrompt[]>([]);
  const [selectedListenModeId, setSelectedListenModeId] = useState<
    string | null
  >(() => safeLocalStorage.getItem(STORAGE_KEYS.SELECTED_LISTEN_MODE_ID));

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    jevApiKey,
    allAiProviders,
    systemPrompt,
    setSystemPrompt,
    selectedAudioDevices,
  } = useApp();
  const callCoreRef = useRef(new CallSessionCore());
  const lastAnsweredRef = useRef<AnsweredTurn | null>(null);
  const completedCardRef = useRef<{
    prompt: string;
    answer: string;
    turnId?: string;
  } | null>(null);
  const answerInFlightRef = useRef(false);
  const deepInFlightRef = useRef(false);
  const seenSystemSequencesRef = useRef(new Set<number>());
  const nextMicSequenceRef = useRef(0);
  const latestCompletedSystemSequenceRef = useRef(0);
  const latestShownStartedAtRef = useRef(0);
  const pendingSttRef = useRef(0);
  const jevShadowControllersRef = useRef(new Set<AbortController>());
  const sessionPlannerRef = useRef(new SessionPlannerCoordinator());
  const activeSessionPlanRef = useRef<ActiveSessionPlan | null>(null);
  const startingCaptureRef = useRef(false);
  const systemLiveRef = useRef<DeepgramLiveCaptions | null>(null);

  const cancelAnswerForSpeech = useCallback(() => {
    callCoreRef.current.cancelAnswer();
    if (answerInFlightRef.current) {
      answerInFlightRef.current = false;
      setLastAnswerPrompt(completedCardRef.current?.prompt ?? "");
      setLastAIResponse(completedCardRef.current?.answer ?? "");
    }
    if (deepInFlightRef.current) {
      deepInFlightRef.current = false;
      setDeepAIResponse("");
      setDeepAnswerStatus(null);
      setDeepAnswerError("");
    }
    setIsAIProcessing(false);
    setIsDeepProcessing(false);
  }, []);

  const jevShadowKey = jevApiKey;
  const jevShadowAvailable = Boolean(jevShadowKey);
  const sessionPlannerAvailable = Boolean(selectedAIProvider.provider);

  const abortJevShadows = useCallback(() => {
    for (const controller of jevShadowControllersRef.current) controller.abort();
    jevShadowControllersRef.current.clear();
  }, []);

  const setJevShadowEnabled = useCallback((enabled: boolean) => {
    if (enabled && !jevShadowAvailable) {
      setJevShadowStatus("Add a TypeSafe JEV API key in Dev Space first");
      return;
    }
    setJevShadowEnabledState(enabled);
    setJevShadowStatus(enabled ? "Waiting for a finalized system turn" : "Off");
    if (!enabled) abortJevShadows();
  }, [jevShadowAvailable, abortJevShadows]);

  useEffect(() => {
    if (!jevShadowEnabled || jevShadowAvailable) return;
    abortJevShadows();
    setJevShadowEnabledState(false);
    setJevShadowStatus("Off");
  }, [jevShadowEnabled, jevShadowAvailable, abortJevShadows]);

  const launchJevShadow = useCallback((utterance: FinalUtterance,
    mode: AutoResponseMode, superseded: boolean) => {
    if (!jevShadowEnabled || mode === "off") return;
    const recordSkipped = (status: StoredJevShadowStatus) => {
      void saveCallJevShadow({
        turnId: utterance.id, sessionId: utterance.sessionId, mode,
        status, choice: null, confidence: null, latencyMs: null,
      }).catch(() => console.error("Failed to save JEV shadow outcome"));
    };
    if (superseded) return recordSkipped("superseded");
    if (!jevShadowKey) return recordSkipped("unavailable");
    if (utterance.text.length > 2_000 || utterance.text.trim().length < 3) {
      return recordSkipped("out_of_scope");
    }
    if (jevShadowControllersRef.current.size >= 2) return recordSkipped("backpressure");

    const controller = new AbortController();
    jevShadowControllersRef.current.add(controller);
    const body = buildJevShadowRequest(
      utterance, mode, callCoreRef.current.historyBefore(utterance.id).slice(-4),
      lastAnsweredRef.current?.normalizedText ?? null
    );
    void requestJevShadow(body, jevShadowKey, tauriFetch, controller.signal)
      .then(async (result) => {
        await saveCallJevShadow({
          turnId: utterance.id, sessionId: utterance.sessionId, mode,
          status: result.status, choice: result.choice,
          confidence: result.confidence, latencyMs: result.latencyMs,
        });
        if (callCoreRef.current.activeSessionId === utterance.sessionId) {
          setJevShadowStatus(result.status === "valid"
            ? `${result.choice} · ${Math.round(result.latencyMs)} ms (shadow only)`
            : `${result.status} · ${Math.round(result.latencyMs)} ms (shadow only)`);
        }
      })
      .catch(() => console.error("Failed to save JEV shadow outcome"))
      .finally(() => jevShadowControllersRef.current.delete(controller));
  }, [jevShadowEnabled, jevShadowKey]);
  const launchJevShadowRef = useRef(launchJevShadow);
  useEffect(() => { launchJevShadowRef.current = launchJevShadow; }, [launchJevShadow]);

  const setSessionPlannerEnabled = useCallback((enabled: boolean) => {
    if (enabled && !sessionPlannerAvailable) {
      setSessionPlannerStatus("Select and configure an AI provider first");
      return;
    }
    setSessionPlannerEnabledState(enabled);
    activeSessionPlanRef.current = null;
    if (enabled) {
      const sessionId = callCoreRef.current.activeSessionId;
      if (sessionId) sessionPlannerRef.current.start(sessionId);
      setSessionPlannerStatus(`Waiting for ${SESSION_PLANNER_MILESTONE} finalized turns`);
    } else {
      sessionPlannerRef.current.stop();
      setSessionPlannerStatus("Off");
    }
  }, [sessionPlannerAvailable]);

  useEffect(() => {
    if (!sessionPlannerEnabled || sessionPlannerAvailable) return;
    sessionPlannerRef.current.stop();
    activeSessionPlanRef.current = null;
    setSessionPlannerEnabledState(false);
    setSessionPlannerStatus("Off");
  }, [sessionPlannerEnabled, sessionPlannerAvailable]);

  const launchSessionPlanner = useCallback((utterance: FinalUtterance) => {
    if (!sessionPlannerEnabled) return;
    const utterances = callCoreRef.current.orderedUtterances();
    if (utterances.length < SESSION_PLANNER_MILESTONE ||
        utterances.length % SESSION_PLANNER_MILESTONE !== 0) return;
    const snapshot = buildSessionPlannerSnapshot(utterances);
    const job = sessionPlannerRef.current.begin();
    if (!snapshot || !job || job.sessionId !== utterance.sessionId) return;
    const startedAt = Date.now();
    setSessionPlannerStatus(`Refreshing revision ${job.revision} asynchronously`);
    void (async () => {
      try {
        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!job.isCurrent()) return;
        const provider = allAiProviders.find((item) => item.id === selectedAIProvider.provider);
        if (!usePluelyAPI && !provider) throw new Error("AI provider config not found");
        let response = "";
        for await (const chunk of fetchAIResponse({
          provider: usePluelyAPI ? undefined : provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: SESSION_PLANNER_PROMPT,
          history: [],
          historyOrder: "chronological",
          knowledgeMode: "none",
          responseProfile: "deep",
          userMessage: snapshot.text,
          imagesBase64: [],
          signal: job.signal,
        })) {
          if (!job.isCurrent()) return;
          response += chunk;
          if (response.length > 20_000) throw new Error("Planner response exceeded its limit");
        }
        if (!job.isCurrent()) return;
        const parsed = parseSessionPlan(response, snapshot.allowedIds);
        const plan: ActiveSessionPlan = {
          ...parsed,
          sessionId: job.sessionId,
          revision: job.revision,
          throughUtteranceId: snapshot.throughUtteranceId,
        };
        const variables = selectedAIProvider.variables ?? {};
        const model = variables.model || variables.MODEL ||
          variables.deployment || variables.deployment_name || "";
        await saveCallSessionPlan({
          plan,
          provider: usePluelyAPI ? "pluely-managed" : selectedAIProvider.provider,
          model,
          startedAt,
          completedAt: Date.now(),
        });
        if (!job.isCurrent()) {
          await deleteCallSessionPlanRevision(job.sessionId, job.revision).catch(() => {});
          return;
        }
        activeSessionPlanRef.current = plan;
        setSessionPlannerStatus(`Revision ${job.revision} ready · candidate only`);
      } catch (plannerError) {
        if (!job.isCurrent()) return;
        console.warn("Asynchronous session planner failed:", plannerError);
        setSessionPlannerStatus("Planner refresh failed; local context remains active");
      }
    })();
  }, [sessionPlannerEnabled, allAiProviders, selectedAIProvider]);
  const launchSessionPlannerRef = useRef(launchSessionPlanner);
  useEffect(() => { launchSessionPlannerRef.current = launchSessionPlanner; }, [launchSessionPlanner]);
  const micLiveRef = useRef<DeepgramLiveCaptions | null>(null);
  const systemSpeechActiveRef = useRef(false);
  const micSpeechActiveRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const toggleLiveCaptions = useCallback(async () => {
    const enabled = !liveCaptionsEnabled;
    try {
      if (capturing) await invoke("set_call_live_captions", { enabled });
      safeLocalStorage.setItem("call_live_captions_enabled", String(enabled));
      setLiveCaptionsEnabled(enabled);
      if (!enabled) {
        setPartialSystemCaption("");
        setPartialMicCaption("");
      }
    } catch {
      setError("Could not change live caption streaming. Batch transcription is still active.");
    }
  }, [capturing, liveCaptionsEnabled]);

  useEffect(() => {
    if (!capturing || !liveCaptionsEnabled || selectedSttProvider.provider !== "deepgram-stt") {
      setSystemLiveStatus("off");
      setMicLiveStatus("off");
      return;
    }
    const variables = Object.fromEntries(
      Object.entries(selectedSttProvider.variables).map(([key, value]) => [key.toUpperCase(), value])
    );
    const apiKey = variables.API_KEY?.trim();
    if (!apiKey) {
      setSystemLiveStatus("fallback");
      setMicLiveStatus("fallback");
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const createStream = (sampleRate: number, source: "system" | "mic") => {
      const status = source === "system" ? setSystemLiveStatus : setMicLiveStatus;
      const caption = source === "system" ? setPartialSystemCaption : setPartialMicCaption;
      const active = source === "system" ? systemSpeechActiveRef : micSpeechActiveRef;
      try {
        return new DeepgramLiveCaptions(apiKey, variables.MODEL || "nova-2", sampleRate,
          (text) => { if (!disposed && active.current) caption(text); },
          (value) => { if (!disposed) status(value); });
      } catch {
        status("fallback");
        return null;
      }
    };
    if (micEnabled) micLiveRef.current = createStream(16000, "mic");
    else setMicLiveStatus("off");
    const subscribe = async () => {
      const stop = await listen<{ sampleRate: number; pcmBase64: string }>(
        "call-system-audio-frame", (event) => {
          if (disposed) return;
          const { sampleRate, pcmBase64 } = event.payload;
          if (!systemLiveRef.current) systemLiveRef.current = createStream(sampleRate, "system");
          try { systemLiveRef.current?.sendPcm(pcm16FromBase64(pcmBase64)); }
          catch { setSystemLiveStatus("fallback"); systemLiveRef.current?.close(); }
        }
      );
      if (disposed) stop();
      else unlisten = stop;
    };
    subscribe().catch(() => { if (!disposed) setSystemLiveStatus("fallback"); });
    return () => {
      disposed = true;
      unlisten?.();
      systemLiveRef.current?.close();
      micLiveRef.current?.close();
      systemLiveRef.current = null;
      micLiveRef.current = null;
    };
  }, [capturing, liveCaptionsEnabled, selectedSttProvider, micEnabled]);

  const handleMicFrame = useCallback((samples: Float32Array) => {
    micLiveRef.current?.sendPcm(pcm16FromFloat(samples));
  }, []);

  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }

    const savedAutoMode = safeLocalStorage.getItem(
      STORAGE_KEYS.AUTO_RESPONSE_MODE
    );
    if (
      savedAutoMode === "off" ||
      savedAutoMode === "on_question" ||
      savedAutoMode === "after_pause"
    ) {
      setAutoResponseModeState(savedAutoMode);
    }

    const savedPace = safeLocalStorage.getItem(STORAGE_KEYS.AUTO_RESPONSE_PACE);
    if (
      savedPace === "fast" ||
      savedPace === "balanced" ||
      savedPace === "relaxed"
    ) {
      setAutoResponsePaceState(savedPace);
    }
  }, []);

  const setAutoResponseMode = useCallback((mode: AutoResponseMode) => {
    setAutoResponseModeState(mode);
    safeLocalStorage.setItem(STORAGE_KEYS.AUTO_RESPONSE_MODE, mode);
    if (mode === "off") {
      abortJevShadows();
      setJevShadowEnabledState(false);
      setJevShadowStatus("Off");
    }
  }, [abortJevShadows]);

  const setAutoResponsePace = useCallback((pace: AutoResponsePace) => {
    setAutoResponsePaceState(pace);
    safeLocalStorage.setItem(STORAGE_KEYS.AUTO_RESPONSE_PACE, pace);
  }, []);

  const setDeepModelOverride = useCallback((value: string) => {
    setDeepModelOverrideState(value);
    safeLocalStorage.setItem("call_deep_model_override", value);
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Handle continuous recording progress events AND error events
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Progress updates (every second)
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        // Recording started
        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        // Recording stopped
        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          // Don't show error - this is expected behavior
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  // Handle single speech detection event (both VAD and continuous modes)
  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let speechStartUnlisten: (() => void) | undefined;
    let disposed = false;

    const setupEventListener = async () => {
      try {
        const unlistenStart = await listen("speech-start", () => {
          if (!capturing || !callCoreRef.current.activeSessionId) return;
          systemSpeechActiveRef.current = true;
          setPartialSystemCaption("");
          cancelAnswerForSpeech();
        });
        if (disposed) unlistenStart();
        else speechStartUnlisten = unlistenStart;
        const unlisten = await listen("call-speech-segment", async (event) => {
          let sttStarted = false;
          let sessionId = "";
          let timing: CallTurnTiming | null = null;
          let audioReadyPerf = 0;
          try {
            if (!capturing) return;
            sessionId = callCoreRef.current.activeSessionId;
            if (!sessionId) return;
            const payload = event.payload as {
              sequence: number;
              audioBase64: string;
              speechEndedAt?: number;
            };
            const sequence = payload.sequence;
            if (!Number.isSafeInteger(sequence) || sequence < 1 ||
                typeof payload.audioBase64 !== "string") return;
            if (seenSystemSequencesRef.current.has(sequence)) return;
            seenSystemSequencesRef.current.add(sequence);
            systemSpeechActiveRef.current = false;
            const emittedAt = Date.now();
            audioReadyPerf = performance.now();
            timing = {
              turnId: `${sessionId}:system:${sequence}`,
              sessionId,
              source: "system",
              audioReadyAt: emittedAt,
              status: "stt_error",
            };

            const base64Audio = payload.audioBase64;
            // Convert to blob
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });
            const startedAt = estimateWavStartAt(emittedAt, bytes);
            const endedAt = Number.isSafeInteger(payload.speechEndedAt) &&
              payload.speechEndedAt! >= startedAt && payload.speechEndedAt! <= emittedAt
              ? payload.speechEndedAt!
              : emittedAt;

            const usePluelyAPI = await shouldUsePluelyAPI();
            if (!selectedSttProvider.provider && !usePluelyAPI) {
              setError("No speech provider selected.");
              return;
            }

            const providerConfig = allSttProviders.find(
              (p) => p.id === selectedSttProvider.provider
            );

            if (!providerConfig && !usePluelyAPI) {
              setError("Speech provider config not found.");
              return;
            }

            sttStarted = true;
            pendingSttRef.current += 1;
            setIsProcessing(true);

            const sttPromise = fetchSTT({
              provider: providerConfig,
              selectedProvider: selectedSttProvider,
              audio: audioBlob,
            });

            try {
              const transcription = await withTimeout(sttPromise, 30000);

              timing.audioToSttMs = performance.now() - audioReadyPerf;
              sttStarted = false;
              if (callCoreRef.current.activeSessionId === sessionId) {
                pendingSttRef.current = Math.max(0, pendingSttRef.current - 1);
                setIsProcessing(pendingSttRef.current > 0);
              }
              if (callCoreRef.current.activeSessionId !== sessionId) {
                timing.status = "canceled";
                return;
              }

              if (transcription.trim()) {
                if (!systemSpeechActiveRef.current) setPartialSystemCaption("");
                timing.status = "transcribed";
                const utterance: FinalUtterance = {
                  id: `${sessionId}:system:${sequence}`,
                  sessionId,
                  source: "system",
                  sequence,
                  startedAt,
                  endedAt,
                  text: transcription.trim(),
                };
                if (!callCoreRef.current.appendFinal(utterance)) return;
                let utterancePersisted = true;
                try {
                  await appendCallUtterance(utterance);
                  await appendCallSessionLedger(utterance).catch((ledgerError) => {
                    console.error("Failed to update candidate session ledger:", ledgerError);
                    setError("Transcript saved, but candidate session memory could not be updated.");
                  });
                } catch (persistError) {
                  utterancePersisted = false;
                  console.error("Failed to save call utterance:", persistError);
                  setError("Transcript could not be saved locally.");
                  timing.status = "storage_error";
                }
                if (callCoreRef.current.activeSessionId !== sessionId) {
                  timing.status = "canceled";
                  return;
                }
                const superseded = sequence < latestCompletedSystemSequenceRef.current ||
                  startedAt < latestShownStartedAtRef.current;
                latestCompletedSystemSequenceRef.current = Math.max(
                  latestCompletedSystemSequenceRef.current, sequence
                );
                const decision: CallDecision = superseded
                  ? { action: "silence", reason: "superseded", utteranceId: utterance.id }
                  : routeCallTurn(utterance, autoResponseMode, lastAnsweredRef.current);
                if (utterancePersisted) {
                  await saveCallTurnDecision(sessionId, decision, autoResponseMode, Date.now())
                    .catch((err) => console.error("Failed to save call decision:", err));
                  launchJevShadowRef.current(utterance, autoResponseMode, superseded);
                  launchSessionPlannerRef.current(utterance);
                }
                if (superseded) return;
                latestShownStartedAtRef.current = startedAt;
                cancelAnswerForSpeech();
                // Dual-source label: system audio path is always "System"
                setLastTranscription(`System: ${transcription.trim()}`);

                if (decision.action === "short_answer") {
                  const paceMs = AUTO_RESPONSE_PACE_MS[autoResponsePace];
                  const job = callCoreRef.current.beginAnswer();
                  try {
                    await delay(paceMs, job.signal);
                  } catch {
                    timing.status = "canceled";
                    return;
                  }
                  if (!job.isCurrent()) {
                    timing.status = "canceled";
                    return;
                  }
                  const answerStartedPerf = performance.now();
                  timing.waitBeforeAnswerMs = answerStartedPerf - audioReadyPerf - timing.audioToSttMs;

                  const effectiveSystemPrompt = useSystemPrompt
                    ? systemPrompt || DEFAULT_SYSTEM_PROMPT
                    : contextContent || DEFAULT_SYSTEM_PROMPT;

                  const previousMessages = callCoreRef.current.historyBefore(utterance.id);

                  const answered = await processWithAI(
                    transcription.trim(),
                    callCardPrompt(effectiveSystemPrompt),
                    previousMessages,
                    job,
                    (firstChunkPerf) => {
                      if (!timing) return;
                      timing.answerToFirstChunkMs = firstChunkPerf - answerStartedPerf;
                      timing.audioToFirstChunkMs = firstChunkPerf - audioReadyPerf;
                    },
                    utterance.id
                  );
                  timing.answerTotalMs = performance.now() - answerStartedPerf;
                  if (answered && job.isCurrent()) {
                    lastAnsweredRef.current = {
                      normalizedText: normalizeTurn(utterance.text),
                      endedAt: utterance.endedAt,
                    };
                  }
                  if (timing.status !== "storage_error") {
                    timing.status = !job.isCurrent() ? "canceled" : answered ? "answered" : "answer_error";
                  }
                }
              } else {
                if (!systemSpeechActiveRef.current) setPartialSystemCaption("");
                setError("Received empty transcription");
              }
            } catch (sttError: any) {
              if (!systemSpeechActiveRef.current) setPartialSystemCaption("");
              if (callCoreRef.current.activeSessionId !== sessionId) return;
              console.error("STT Error:", sttError);
              setError(sttError.message || "Failed to transcribe audio");
              setIsPopoverOpen(true);
            }
          } catch (err) {
            setError("Failed to process speech");
          } finally {
            if (sttStarted && callCoreRef.current.activeSessionId === sessionId) {
              pendingSttRef.current = Math.max(0, pendingSttRef.current - 1);
              setIsProcessing(pendingSttRef.current > 0);
            }
            if (timing) {
              await saveCallTurnTiming(timing).catch((err) =>
                console.error("Failed to save call timing:", err)
              );
            }
          }
        });
        if (disposed) unlisten();
        else speechUnlisten = unlisten;
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      disposed = true;
      if (speechUnlisten) speechUnlisten();
      if (speechStartUnlisten) speechStartUnlisten();
    };
  }, [
    capturing,
    selectedSttProvider,
    allSttProviders,
    autoResponseMode,
    autoResponsePace,
    useSystemPrompt,
    systemPrompt,
    contextContent,
    cancelAnswerForSpeech,
  ]);

  // Context management functions
  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Load listen modes for overlay chips
  useEffect(() => {
    let cancelled = false;
    const loadModes = async () => {
      try {
        const rows = await listListenModes();
        if (cancelled) return;
        setListenModes(rows);

        const storedModeId = safeLocalStorage.getItem(
          STORAGE_KEYS.SELECTED_LISTEN_MODE_ID
        );
        const storedPromptId = safeLocalStorage.getItem(
          STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID
        );

        const selectedByMode = storedModeId
          ? rows.find((mode) => mode.id === storedModeId)
          : undefined;
        const selectedByPrompt =
          !selectedByMode && storedPromptId
            ? rows.find((mode) => mode.prompt_id === Number(storedPromptId))
            : undefined;

        if (selectedByMode?.prompt_text) {
          setSelectedListenModeId(selectedByMode.id);
          // Prefer app systemPrompt; keep contextContent in sync for custom path
          setSystemPrompt(selectedByMode.prompt_text);
          setUseSystemPrompt(true);
          setContextContent(selectedByMode.prompt_text);
          saveContextSettings(true, selectedByMode.prompt_text);
          if (selectedByMode.prompt_id != null) {
            safeLocalStorage.setItem(
              STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
              selectedByMode.prompt_id.toString()
            );
          }
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            selectedByMode.prompt_text
          );
        } else if (selectedByPrompt) {
          // Highlight matching chip without overriding an unrelated selection
          setSelectedListenModeId(selectedByPrompt.id);
        }
      } catch (error) {
        console.error("Failed to load listen modes:", error);
      }
    };
    loadModes();
    return () => {
      cancelled = true;
    };
  }, [saveContextSettings, setSystemPrompt]);

  const selectListenMode = useCallback(
    (mode: ListenModeWithPrompt) => {
      const promptText = mode.prompt_text?.trim();
      if (!promptText) return;

      setSelectedListenModeId(mode.id);
      safeLocalStorage.setItem(STORAGE_KEYS.SELECTED_LISTEN_MODE_ID, mode.id);

      // Sync into app systemPrompt selection (same as handleSelectPrompt)
      setSystemPrompt(promptText);
      safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, promptText);
      if (mode.prompt_id != null) {
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
          mode.prompt_id.toString()
        );
      }
      safeLocalStorage.removeItem("selected_pluely_prompt");

      // Prefer systemPrompt path; keep contextContent updated for processWithAI
      setUseSystemPrompt(true);
      setContextContent(promptText);
      saveContextSettings(true, promptText);
    },
    [saveContextSettings, setSystemPrompt]
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const effectiveSystemPrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    const previousMessages = callCoreRef.current.historyBefore("");

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  // Start continuous recording manually
  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start a new continuous recording session
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
        liveCaptions: liveCaptionsEnabled && selectedSttProvider.provider === "deepgram-stt",
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id, liveCaptionsEnabled, selectedSttProvider.provider]);

  // Ignore current recording (stop without transcription)
  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      // Stop the capture without processing
      await invoke<string>("stop_system_audio_capture");

      // Reset states
      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      existingJob?: AnswerJob,
      onFirstChunk?: (at: number) => void,
      answerTurnId?: string
    ) => {
      const job = existingJob ?? callCoreRef.current.beginAnswer();
      if (!job.isCurrent()) return false;
      let succeeded = false;

      try {
        answerInFlightRef.current = true;
        setIsAIProcessing(true);
        setLastAnswerPrompt(transcription);
        setLastAIResponse("");
        setDeepAIResponse("");
        setDeepAnswerStatus(null);
        setDeepAnswerError("");
        deepInFlightRef.current = false;
        setIsDeepProcessing(false);
        setError("");

        let fullResponse = "";

        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!job.isCurrent()) return false;
        if (!selectedAIProvider.provider && !usePluelyAPI) {
          setError("No AI provider selected.");
          return false;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          setError("AI provider config not found.");
          return false;
        }

        let historyWithEvidence: Message[] = previousMessages;
        const sessionId = callCoreRef.current.activeSessionId;
        if (sessionId) {
          try {
            const planEvidence = formatSessionPlanEvidence(
              activeSessionPlanRef.current?.sessionId === sessionId
                ? activeSessionPlanRef.current
                : null
            );
            if (planEvidence) historyWithEvidence = [
              ...historyWithEvidence, { role: "user", content: planEvidence },
            ];
            const recentIds = callCoreRef.current.historyEntriesBefore(answerTurnId ?? "")
              .map(({ id }) => id);
            const ledgerEntries = selectSessionLedgerEntries(
              callCoreRef.current.orderedUtterances(), answerTurnId ?? "", recentIds
            );
            const ledgerEvidence = formatSessionLedgerEvidence(ledgerEntries);
            if (ledgerEvidence) historyWithEvidence = [
              ...historyWithEvidence, { role: "user", content: ledgerEvidence },
            ];
            const ledgerSourceIds = ledgerEntries.map(({ sourceUtteranceId }) => sourceUtteranceId);
            const older = await searchCallUtterances(
              sessionId, transcription, answerTurnId, [...recentIds, ...ledgerSourceIds], 4
            );
            if (!job.isCurrent()) return false;
            const evidence = formatCallEvidence(older);
            if (evidence) historyWithEvidence = [
              ...historyWithEvidence, { role: "user", content: evidence },
            ];
          } catch (searchError) {
            if (!job.isCurrent()) return false;
            console.warn("Long-call search unavailable:", searchError);
            setError("Earlier call facts could not be searched locally.");
          }
        }
        let failed = false;
        let firstChunkSeen = false;
        const answerStartedAt = Date.now();
        const streamEvents: AnswerStreamEvent[] = [];
        try {
          for await (const chunk of fetchAIResponse({
            provider: usePluelyAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: historyWithEvidence,
            historyOrder: "chronological",
            knowledgeMode: "local",
            onKnowledgeError: () => {
              if (job.isCurrent()) setError("Personal knowledge could not be searched locally.");
            },
            userMessage: transcription,
            imagesBase64: [],
            signal: job.signal,
          })) {
            if (!job.isCurrent()) return false;
            if (chunk) streamEvents.push({ at: Date.now(), delta: chunk });
            if (chunk && !firstChunkSeen) {
              firstChunkSeen = true;
              onFirstChunk?.(performance.now());
            }
            fullResponse += chunk;
            setLastAIResponse((prev) => job.isCurrent() ? prev + chunk : prev);
          }
        } catch (aiError: any) {
          failed = true;
          if (job.isCurrent()) setError(aiError.message || "Failed to get AI response");
        }

        if (job.isCurrent() && fullResponse && !failed) {
          const timestamp = Date.now();
          setConversation((prev) => job.isCurrent() ? ({
            ...prev,
            messages: [
              {
                id: generateMessageId("user", timestamp),
                role: "user" as const,
                content: transcription,
                timestamp,
              },
              {
                id: generateMessageId("assistant", timestamp + 1),
                role: "assistant" as const,
                content: fullResponse,
                timestamp: timestamp + 1,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }) : prev);
          completedCardRef.current = {
            prompt: transcription,
            answer: fullResponse,
            turnId: answerTurnId,
          };
          succeeded = true;
          if (sessionId && answerTurnId) {
            const variables = selectedAIProvider.variables ?? {};
            const model = variables.model || variables.MODEL ||
              variables.deployment || variables.deployment_name || "";
            try {
              await saveCallAnswerCard({
                turnId: answerTurnId,
                sessionId,
                provider: usePluelyAPI ? "pluely-managed" : selectedAIProvider.provider,
                model,
                answerText: fullResponse,
                streamEvents,
                startedAt: answerStartedAt,
                completedAt: Date.now(),
              });
            } catch (persistError) {
              console.error("Failed to save completed call card:", persistError);
              if (job.isCurrent()) setError("Answer shown, but its call-review record could not be saved.");
            }
          }
        }
      } catch (err) {
        if (job.isCurrent()) setError("Failed to get AI response");
      } finally {
        if (job.isCurrent()) {
          answerInFlightRef.current = false;
          if (!succeeded) {
            setLastAnswerPrompt(completedCardRef.current?.prompt ?? "");
            setLastAIResponse(completedCardRef.current?.answer ?? "");
          }
          setIsAIProcessing(false);
        }
        // No auto-restart - user manually controls when to start next recording
      }
      return succeeded;
    },
    [selectedAIProvider, allAiProviders]
  );

  const goDeeper = useCallback(async () => {
    const completed = completedCardRef.current;
    if (!completed || deepInFlightRef.current || answerInFlightRef.current) return;

    const job = callCoreRef.current.beginAnswer();
    deepInFlightRef.current = true;
    setIsDeepProcessing(true);
    setDeepAIResponse("");
    setDeepAnswerStatus(null);
    setDeepAnswerError("");

    try {
      const usePluelyAPI = await shouldUsePluelyAPI();
      if (!job.isCurrent()) return;
      const provider = allAiProviders.find((item) => item.id === selectedAIProvider.provider);
      if (!usePluelyAPI && !provider) throw new Error("AI provider config not found.");
      const deepSelectedProvider = withModelOverride(selectedAIProvider, deepModelOverride);

      const effectiveSystemPrompt = useSystemPrompt
        ? systemPrompt || DEFAULT_SYSTEM_PROMPT
        : contextContent || DEFAULT_SYSTEM_PROMPT;
      const history: Message[] = callCoreRef.current.historyBefore(completed.turnId ?? "");
      const planEvidence = formatSessionPlanEvidence(
        activeSessionPlanRef.current?.sessionId === callCoreRef.current.activeSessionId
          ? activeSessionPlanRef.current
          : null
      );
      if (planEvidence) history.push({ role: "user", content: planEvidence });
      const recentIds = callCoreRef.current.historyEntriesBefore(completed.turnId ?? "")
        .map(({ id }) => id);
      const ledgerEvidence = formatSessionLedgerEvidence(selectSessionLedgerEntries(
        callCoreRef.current.orderedUtterances(), completed.turnId ?? "", recentIds
      ));
      if (ledgerEvidence) history.push({ role: "user", content: ledgerEvidence });
      history.push({
        role: "assistant",
        content: `Initial live-call suggestion (unverified):\n${completed.answer}`,
      });

      let fullResponse = "";
      const answerStartedAt = Date.now();
      const streamEvents: AnswerStreamEvent[] = [];
      for await (const chunk of fetchAIResponse({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: deepSelectedProvider,
        systemPrompt: deepCallPrompt(effectiveSystemPrompt),
        history,
        historyOrder: "chronological",
        knowledgeMode: "local",
        responseProfile: "deep",
        onKnowledgeError: () => {
          if (job.isCurrent()) setDeepAnswerError("Personal knowledge could not be searched locally.");
        },
        userMessage: completed.prompt,
        imagesBase64: [],
        signal: job.signal,
      })) {
        if (!job.isCurrent()) return;
        if (chunk) streamEvents.push({ at: Date.now(), delta: chunk });
        fullResponse += chunk;
        setDeepAIResponse((previous) => job.isCurrent() ? previous + chunk : previous);
      }
      if (!job.isCurrent()) return;
      if (!fullResponse.trim()) throw new Error("Deep answer returned no text.");
      setDeepAnswerStatus("draft");
      if (completed.turnId) {
        const model = selectedModelName(deepSelectedProvider);
        try {
          await saveCallDeepAnswer({
            turnId: completed.turnId,
            sessionId: callCoreRef.current.activeSessionId,
            provider: usePluelyAPI ? "pluely-managed" : selectedAIProvider.provider,
            model,
            answerText: fullResponse,
            streamEvents,
            startedAt: answerStartedAt,
            completedAt: Date.now(),
          });
        } catch (persistError) {
          console.error("Failed to save deep call answer:", persistError);
          if (job.isCurrent()) setDeepAnswerError("Draft shown, but its call record could not be saved.");
        }
      }
    } catch (deepError) {
      if (job.isCurrent()) {
        setDeepAIResponse("");
        setDeepAnswerStatus(null);
        setDeepAnswerError(
          deepError instanceof Error ? deepError.message : "Deep answer failed."
        );
      }
    } finally {
      if (job.isCurrent()) {
        deepInFlightRef.current = false;
        setIsDeepProcessing(false);
      }
    }
  }, [allAiProviders, selectedAIProvider, useSystemPrompt, systemPrompt, contextContent, deepModelOverride]);

  const handleMicSegment = useCallback(async (audio: Blob, startedAt: number) => {
    micSpeechActiveRef.current = false;
    const sessionId = callCoreRef.current.activeSessionId;
    if (!sessionId || !micEnabled) return;
    const sequence = ++nextMicSequenceRef.current;
    const endedAt = Date.now();
    const audioReadyPerf = performance.now();
    const timing: CallTurnTiming = {
      turnId: `${sessionId}:mic:${sequence}`,
      sessionId,
      source: "mic",
      audioReadyAt: endedAt,
      status: "stt_error",
    };
    pendingSttRef.current += 1;
    setIsProcessing(true);
    try {
      const usePluelyAPI = await shouldUsePluelyAPI();
      if (!selectedSttProvider.provider && !usePluelyAPI) {
        throw new Error("No speech provider selected");
      }
      const provider = allSttProviders.find((p) => p.id === selectedSttProvider.provider);
      if (!provider && !usePluelyAPI) {
        throw new Error("Speech provider config not found");
      }
      const transcription = (await withTimeout(fetchSTT({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: selectedSttProvider,
        audio,
      }), 30000)).trim();
      timing.audioToSttMs = performance.now() - audioReadyPerf;
      if (callCoreRef.current.activeSessionId !== sessionId) {
        timing.status = "canceled";
        return;
      }
      if (!transcription) throw new Error("Empty microphone transcription");
      if (!micSpeechActiveRef.current) setPartialMicCaption("");
      timing.status = "transcribed";
      const utterance: FinalUtterance = {
        id: `${sessionId}:mic:${sequence}`,
        sessionId,
        source: "mic",
        sequence,
        startedAt,
        endedAt,
        text: transcription,
      };
      if (!callCoreRef.current.appendFinal(utterance)) return;
      let ledgerPersisted = true;
      try {
        await appendCallUtterance(utterance);
        await appendCallSessionLedger(utterance).catch((ledgerError) => {
          ledgerPersisted = false;
          console.error("Failed to update microphone candidate ledger:", ledgerError);
          setMicError("Transcript saved, but candidate session memory could not be updated.");
        });
      } catch (err) {
        console.error("Failed to save microphone utterance:", err);
        setMicError("Microphone transcript could not be saved locally.");
        timing.status = "storage_error";
        return;
      }
      if (callCoreRef.current.activeSessionId !== sessionId) return;
      launchSessionPlannerRef.current(utterance);
      const decision = routeCallTurn(utterance, autoResponseMode, lastAnsweredRef.current);
      await saveCallTurnDecision(sessionId, decision, autoResponseMode, Date.now())
        .catch((err) => console.error("Failed to save microphone decision:", err));
      if (ledgerPersisted) setMicError("");
      if (startedAt >= latestShownStartedAtRef.current) {
        latestShownStartedAtRef.current = startedAt;
        cancelAnswerForSpeech();
        setLastTranscription(`Mic: ${transcription}`);
      }
    } catch (err) {
      if (!micSpeechActiveRef.current) setPartialMicCaption("");
      if (callCoreRef.current.activeSessionId !== sessionId) return;
      const message = err instanceof Error ? err.message : String(err);
      setMicError(`Microphone transcription failed: ${message}`);
    } finally {
      if (callCoreRef.current.activeSessionId === sessionId) {
        pendingSttRef.current = Math.max(0, pendingSttRef.current - 1);
        setIsProcessing(pendingSttRef.current > 0);
      }
      await saveCallTurnTiming(timing).catch((err) =>
        console.error("Failed to save microphone timing:", err)
      );
    }
  }, [micEnabled, selectedSttProvider, allSttProviders, autoResponseMode, cancelAnswerForSpeech]);

  const handleMicError = useCallback((message: string) => {
    setMicError(`Microphone capture failed: ${message}`);
  }, []);

  const handleMicSpeechStart = useCallback(() => {
    if (!callCoreRef.current.activeSessionId) return;
    micSpeechActiveRef.current = true;
    setPartialMicCaption("");
    cancelAnswerForSpeech();
  }, [cancelAnswerForSpeech]);

  const toggleMic = useCallback(() => {
    setMicEnabled((enabled) => !enabled);
    setMicError("");
    setPartialMicCaption("");
  }, []);

  const startCapture = useCallback(async () => {
    if (startingCaptureRef.current || callCoreRef.current.activeSessionId) return;
    startingCaptureRef.current = true;
    let newSessionId = "";
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;

      // Set up conversation
      const conversationId = generateConversationId("sysaudio");
      await createCallSession(conversationId, Date.now());
      newSessionId = conversationId;
      callCoreRef.current.start(conversationId);
      activeSessionPlanRef.current = null;
      if (sessionPlannerEnabled) sessionPlannerRef.current.start(conversationId);
      seenSystemSequencesRef.current.clear();
      nextMicSequenceRef.current = 0;
      latestCompletedSystemSequenceRef.current = 0;
      latestShownStartedAtRef.current = 0;
      pendingSttRef.current = 0;
      lastAnsweredRef.current = null;
      completedCardRef.current = null;
      answerInFlightRef.current = false;
      deepInFlightRef.current = false;
      systemSpeechActiveRef.current = false;
      micSpeechActiveRef.current = false;
      setPartialSystemCaption("");
      setPartialMicCaption("");
      setLastAnswerPrompt("");
      setLastAIResponse("");
      setDeepAIResponse("");
      setDeepAnswerStatus(null);
      setDeepAnswerError("");
      setIsDeepProcessing(false);
      setLastTranscription("");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });

      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);

      // If continuous mode
      if (isContinuous) {
        setCapturing(true);
        setIsRecordingInContinuousMode(false);
        return;
      }

      // VAD mode: Start recording immediately
      // Stop any existing capture
      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start capture with VAD config
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
        liveCaptions: liveCaptionsEnabled && selectedSttProvider.provider === "deepgram-stt",
      });
      setCapturing(true);
    } catch (err) {
      callCoreRef.current.stop();
      setCapturing(false);
      if (newSessionId) {
        await endCallSession(newSessionId, Date.now()).catch(console.error);
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    } finally {
      startingCaptureRef.current = false;
    }
  }, [vadConfig, selectedAudioDevices.output.id, liveCaptionsEnabled, selectedSttProvider.provider, sessionPlannerEnabled]);

  const stopCapture = useCallback(async () => {
            const sessionId = callCoreRef.current.activeSessionId;
    callCoreRef.current.stop();
    sessionPlannerRef.current.stop();
    activeSessionPlanRef.current = null;
    setSessionPlannerEnabledState(false);
    setSessionPlannerStatus("Off");
    abortJevShadows();
    setJevShadowEnabledState(false);
    setJevShadowStatus("Off");
    pendingSttRef.current = 0;
    lastAnsweredRef.current = null;
    completedCardRef.current = null;
    answerInFlightRef.current = false;
    deepInFlightRef.current = false;
    systemSpeechActiveRef.current = false;
    micSpeechActiveRef.current = false;
    setPartialSystemCaption("");
    setPartialMicCaption("");
    setMicError("");
    setCapturing(false);
    try {
      // Stop the audio capture
      await invoke<string>("stop_system_audio_capture");

      // Reset ALL states
      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsDeepProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setLastTranscription("");
      setLastAIResponse("");
      setLastAnswerPrompt("");
      setDeepAIResponse("");
      setDeepAnswerStatus(null);
      setDeepAnswerError("");
      setError("");
      setIsPopoverOpen(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    } finally {
      if (sessionId) {
        await endCallSession(sessionId, Date.now()).catch((err) => {
          console.error("Failed to end call session:", err);
          setError("Call session could not be finalized locally.");
        });
      }
    }
  }, [abortJevShadows]);

  // Manual stop for continuous recording
  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      // Show processing state immediately
      setIsProcessing(true);

      // Trigger manual stop event
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false); // Clear processing state on error
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      const sessionId = callCoreRef.current.activeSessionId;
      callCoreRef.current.stop();
      sessionPlannerRef.current.stop();
      activeSessionPlanRef.current = null;
      abortJevShadows();
      if (sessionId) endCallSession(sessionId, Date.now()).catch(console.error);
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, [abortJevShadows]);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(async () => {
    const priorSessionId = callCoreRef.current.activeSessionId;
    callCoreRef.current.stop();
    sessionPlannerRef.current.stop();
    activeSessionPlanRef.current = null;
    abortJevShadows();
    const nextId = generateConversationId("sysaudio");
    try {
      if (priorSessionId) await endCallSession(priorSessionId, Date.now());
      if (capturing) {
        await createCallSession(nextId, Date.now());
        callCoreRef.current.start(nextId);
        if (sessionPlannerEnabled) sessionPlannerRef.current.start(nextId);
        seenSystemSequencesRef.current.clear();
        nextMicSequenceRef.current = 0;
        latestCompletedSystemSequenceRef.current = 0;
        latestShownStartedAtRef.current = 0;
        pendingSttRef.current = 0;
        lastAnsweredRef.current = null;
        completedCardRef.current = null;
        answerInFlightRef.current = false;
        deepInFlightRef.current = false;
      }
    } catch (err) {
      console.error("Failed to start new call session:", err);
      setError("New call session could not be saved locally.");
      return;
    }
    setConversation({
      id: nextId,
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLastTranscription("");
    setLastAIResponse("");
    setLastAnswerPrompt("");
    setDeepAIResponse("");
    setDeepAnswerStatus(null);
    setDeepAnswerError("");
    setPartialSystemCaption("");
    setPartialMicCaption("");
    setMicError("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsDeepProcessing(false);
    setIsPopoverOpen(capturing);
    setUseSystemPrompt(true);
  }, [capturing, abortJevShadows, sessionPlannerEnabled]);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);

      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  // Keyboard shortcuts for continuous mode recording (local shortcuts)
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      // Enter: Start recording (when not recording) or Stop & Send (when recording)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      // Escape: Ignore recording (when recording)
      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      // Space: Start recording (when not recording) - only if not typing in input
      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    lastAnswerPrompt,
    deepAIResponse,
    isDeepProcessing,
    deepAnswerStatus,
    deepAnswerError,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // AI processing
    processWithAI,
    goDeeper,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    listenModes,
    selectedListenModeId,
    selectListenMode,
    startNewConversation,
    // Window resize
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Continuous recording
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
    // Auto-response settings
    autoResponseMode,
    setAutoResponseMode,
    autoResponsePace,
    setAutoResponsePace,
    jevShadowEnabled,
    jevShadowAvailable,
    jevShadowStatus,
    setJevShadowEnabled,
    sessionPlannerEnabled,
    sessionPlannerAvailable,
    sessionPlannerStatus,
    setSessionPlannerEnabled,
    deepModelOverride,
    setDeepModelOverride,
    micEnabled,
    micError,
    toggleMic,
    handleMicSegment,
    handleMicError,
    handleMicSpeechStart,
    micDeviceId: selectedAudioDevices.input.id,
    liveCaptionsEnabled,
    toggleLiveCaptions,
    liveCaptionsAvailable: selectedSttProvider.provider === "deepgram-stt",
    systemLiveStatus,
    micLiveStatus,
    partialSystemCaption,
    partialMicCaption,
    handleMicFrame,
  };
}
