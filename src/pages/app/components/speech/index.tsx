import { useState, useCallback, useEffect } from "react";
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  AudioLinesIcon,
  CameraIcon,
  PlusIcon,
  MicIcon,
  MicOffIcon,
  XIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ModeSwitcher } from "./ModeSwitcher";
import { RecordingPanel } from "./RecordingPanel";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { PermissionFlow } from "./PermissionFlow";
import { QuickActions } from "./QuickActions";
import { Warning } from "./Warning";
import { ListenModeChips } from "./ListenModeChips";
import { CallMicCapture } from "./CallMicCapture";
import { TranscriptPanel } from "./TranscriptPanel";
import { useSystemAudioType } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import { MAX_LIVE_GUIDANCE_CHARS } from "@/lib/call/decision-router";

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    isProcessing,
    isAIProcessing,
    sessionUtterances,
    lastAnswerPrompt,
    lastAIResponse,
    deepAIResponse,
    isDeepProcessing,
    deepAnswerStatus,
    deepAnswerError,
    goDeeper,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    isPopoverOpen,
    setIsPopoverOpen,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation,
    conversation,
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    switchCaptureMode,
    isModeSwitching,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    autoResponseMode,
    setAutoResponseMode,
    liveAnswerGuidance,
    setLiveAnswerGuidance,
    autoResponsePace,
    setAutoResponsePace,
    fastOpenAIAnswers,
    setFastOpenAIAnswers,
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
    listenModes,
    selectedListenModeId,
    selectListenMode,
    micEnabled,
    micError,
    toggleMic,
    handleMicSegment,
    handleMicSpeechStart,
    handleMicError,
    micDeviceId,
    liveCaptionsEnabled,
    toggleLiveCaptions,
    liveCaptionsAvailable,
    liveCaptionsProvider,
    systemLiveStatus,
    partialSystemCaption,
    partialMicCaption,
    handleMicFrame,
    attachedScreenshot,
    setAttachedScreenshot,
    clearAttachedScreenshot,
  } = props;

  const { hasActiveLicense, supportsImages } = useApp();

  // View mode toggle
  const [conversationMode, setConversationMode] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState("");

  const isVadMode = vadConfig.enabled;
  const hasResponse = lastAIResponse || isAIProcessing;

  const setCompactView = useCallback(async (compact: boolean) => {
    try {
      await invoke("set_window_height", {
        window: getCurrentWebviewWindow(), height: compact ? 220 : 600,
      });
      setIsCompact(compact);
    } catch (resizeError) {
      console.error("Failed to resize Listen window:", resizeError);
    }
  }, []);

  useEffect(() => {
    if (!capturing) {
      setIsCompact(false);
      setTranscriptOpen(false);
    }
  }, [capturing]);

  const toggleTranscript = () => {
    if (isCompact) {
      void setCompactView(false).then(() => setTranscriptOpen(true));
    } else setTranscriptOpen((open) => !open);
  };
  const showAllTranscriptTurns = () => {
    if (isCompact) void setCompactView(false);
    setTranscriptOpen(true);
  };

  // Keyboard shortcut for Cmd+K to toggle view mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      // Cmd+K or Ctrl+K to toggle view mode
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setConversationMode((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  const handleToggleCapture = async () => {
    if (isModeSwitching) return;
    if (capturing) {
      await stopCapture();
    } else {
      await startCapture();
    }
  };

  const handleModeChange = (vadEnabled: boolean) => {
    void switchCaptureMode(vadEnabled);
  };

  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    setScreenshotError("");
    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      // Capture screenshot
      const base64: string = await invoke("capture_to_base64");

      setAttachedScreenshot(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
      setScreenshotError(
        err instanceof Error ? err.message : "Screen capture failed. Check Windows capture permissions."
      );
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot]);

  const handleRemoveScreenshot = useCallback(() => {
    clearAttachedScreenshot();
    setScreenshotError("");
  }, [clearAttachedScreenshot]);

  const getButtonIcon = () => {
    if (setupRequired) return <AlertCircleIcon className="text-orange-500" />;
    if (error && !setupRequired)
      return <AlertCircleIcon className="text-red-500" />;
    if (isProcessing) return <LoaderIcon className="animate-spin" />;
    if (capturing)
      return <AudioLinesIcon className="text-green-500 animate-pulse" />;
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup required - Click for instructions";
    if (error && !setupRequired) return `Error: ${error}`;
    if (isProcessing) return "Transcribing audio...";
    if (capturing) return "Stop system audio capture";
    return "Start system audio capture";
  };

  return (
    <>
    {capturing && micEnabled && (
      <CallMicCapture
        key={micDeviceId}
        deviceId={micDeviceId}
        onSegment={handleMicSegment}
        onSpeechStart={handleMicSpeechStart}
        onFrame={liveCaptionsEnabled ? handleMicFrame : undefined}
        onError={handleMicError}
      />
    )}
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (capturing && !open) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleToggleCapture}
          disabled={isModeSwitching}
          className={cn(
            capturing && "bg-green-50 hover:bg-green-100",
            error && "bg-red-100 hover:bg-red-200"
          )}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>

      {(capturing || setupRequired || error) && (
        <PopoverContent
          align="end"
          side="bottom"
          className="select-none w-screen p-0 border shadow-lg overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
            {/* Header - Mode Switcher + Actions */}
            <div className="flex-shrink-0 p-3 border-b border-border/50">
              <div className="flex flex-wrap items-center gap-2">
                {/* Mode Switcher */}
                {!setupRequired && !isCompact && (
                  <div className="flex-1 min-w-[220px]"><ModeSwitcher
                    isVadMode={isVadMode}
                    onModeChange={handleModeChange}
                    disabled={
                      isModeSwitching ||
                      isRecordingInContinuousMode ||
                      isProcessing ||
                      isAIProcessing
                    }
                  /></div>
                )}
                {setupRequired && (
                  <h2 className="font-semibold text-sm">Setup Required</h2>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {capturing && isVadMode && !setupRequired && (
                    <Button size="sm" variant={autoResponseMode === "off" ? "outline" : "default"}
                      onClick={() => setAutoResponseMode(autoResponseMode === "off" ? "on_question" : "off")}
                      className="h-6 px-2 text-[10px]"
                      title="Toggle automatic answers; transcription continues either way">
                      Auto answers {autoResponseMode === "off" ? "off" : "on"}
                    </Button>
                  )}
                  {liveCaptionsAvailable && (
                    <Button
                      size="sm"
                      variant={liveCaptionsEnabled ? "default" : "outline"}
                      onClick={toggleLiveCaptions}
                      className="h-6 px-2 text-[10px]"
                      title={`Live captions send both audio sources to ${liveCaptionsProvider === "openai" ? "OpenAI" : "Deepgram"} while capture is active. Batch transcription remains the fallback.`}
                    >
                      Live text {liveCaptionsEnabled ? "on" : "off"}
                    </Button>
                  )}
                  {capturing && !setupRequired && (
                    <Button
                      size="sm"
                      variant={micEnabled ? "default" : "outline"}
                      onClick={toggleMic}
                      className="h-6 text-[10px] gap-1 px-2"
                      title={micEnabled ? "Mute microphone in Listen" : "Enable microphone in Listen"}
                    >
                      {micEnabled ? <MicIcon className="w-3 h-3" /> : <MicOffIcon className="w-3 h-3" />}
                      Mic {micEnabled ? "On" : "Off"}
                    </Button>
                  )}
                  {/* Screenshot Button */}
                  {hasActiveLicense && !setupRequired && supportsImages && (
                    <Button
                      size="sm"
                      variant={attachedScreenshot ? "default" : "outline"}
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot}
                      className={cn(
                        "h-6 text-[10px] gap-1 px-2",
                        attachedScreenshot && "bg-primary text-primary-foreground"
                      )}
                      title="Capture screenshot to include with transcription"
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                      Screenshot
                    </Button>
                  )}

                  {/* New Conversation Button */}
                  {!setupRequired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className={cn("h-6 text-[10px] gap-1 px-2", isCompact && "hidden")}
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {capturing && !setupRequired && (
                    <Button type="button" size="icon" variant="ghost"
                      className="h-6 w-6" onClick={() => void setCompactView(!isCompact)}
                      title={isCompact ? "Expand Listen window" : "Compact Listen window"}
                      aria-label={isCompact ? "Expand Listen window" : "Compact Listen window"}>
                      {isCompact ? <ChevronDownIcon className="h-3.5 w-3.5" />
                        : <ChevronUpIcon className="h-3.5 w-3.5" />}
                    </Button>
                  )}

                  {/* Close Button */}
                  {!capturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Close"
                      onClick={() => {
                        setIsPopoverOpen(false);
                        resizeWindow(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {capturing && !setupRequired && (
              <div className="mx-2 mt-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 py-1">
                <label htmlFor="listen-live-guidance" className="shrink-0 text-[10px] font-medium">
                  Guide
                </label>
                <input
                  id="listen-live-guidance"
                  type="text"
                  value={liveAnswerGuidance}
                  onChange={(event) => setLiveAnswerGuidance(event.target.value)}
                  maxLength={MAX_LIVE_GUIDANCE_CHARS}
                  placeholder="Guide answers until cleared…"
                  title="Guides automatic and Answer now cards until cleared or Listen stops"
                  className="h-5 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
                />
                {liveAnswerGuidance && (
                  <button type="button" onClick={() => setLiveAnswerGuidance("")}
                    aria-label="Clear answer guidance" title="Clear guidance"
                    className="flex min-h-8 min-w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {isCompact && !setupRequired ? (
              <div className="p-2 space-y-1.5 overflow-hidden">
                <TranscriptPanel utterances={sessionUtterances}
                  partialSystem={partialSystemCaption} partialMic={partialMicCaption}
                  liveAvailable={liveCaptionsAvailable} liveProvider={liveCaptionsProvider} liveEnabled={liveCaptionsEnabled}
                  systemStatus={systemLiveStatus} expanded={false} compact
                  onToggle={toggleTranscript} onShowAll={showAllTranscriptTurns} />
                {(lastAIResponse || isAIProcessing) && (
                  <p className="text-[10px] line-clamp-2 px-1">
                    {isAIProcessing && !lastAIResponse ? "Answering…" : lastAIResponse}
                  </p>
                )}
              </div>
            ) : <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
              <div className="p-2 space-y-2">
                {micError && (
                  <p role="status" className="text-[11px] text-destructive rounded border border-destructive/20 p-2">
                    {micError}
                  </p>
                )}
                {/* Screenshot Preview */}
                {attachedScreenshot && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <img
                      src={`data:image/png;base64,${attachedScreenshot}`}
                      alt="Screenshot"
                      className="h-12 w-20 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium">
                        Screenshot attached
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        Will be sent with the next answer
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={handleRemoveScreenshot}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {screenshotError && (
                  <p role="alert" className="text-[10px] text-destructive rounded border border-destructive/20 p-2">
                    Screenshot failed: {screenshotError}
                  </p>
                )}

                {/* Error Display */}
                {error && !setupRequired && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium text-red-800">
                        Error
                      </p>
                      <p className="text-[10px] text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {/* Setup Required - Permission Flow */}
                {setupRequired ? (
                  <PermissionFlow
                    onPermissionGranted={() => {
                      startCapture();
                    }}
                    onPermissionDenied={() => {
                      // Keep showing setup instructions
                    }}
                  />
                ) : (
                  <>
                    {/* Recording Panel */}
                    <RecordingPanel
                      isVadMode={isVadMode}
                      isRecording={isRecordingInContinuousMode}
                      isProcessing={isProcessing}
                      isAIProcessing={isAIProcessing}
                      recordingProgress={recordingProgress}
                      maxDuration={vadConfig.max_recording_duration_secs}
                      onStartRecording={startContinuousRecording}
                      onStopAndSend={manualStopAndSend}
                      onIgnore={ignoreContinuousRecording}
                    />

                    <TranscriptPanel utterances={sessionUtterances}
                      partialSystem={partialSystemCaption} partialMic={partialMicCaption}
                      liveAvailable={liveCaptionsAvailable} liveProvider={liveCaptionsProvider} liveEnabled={liveCaptionsEnabled}
                      systemStatus={systemLiveStatus} expanded={transcriptOpen}
                      compact={false}
                      onToggle={toggleTranscript} onShowAll={showAllTranscriptTurns} />

                    {/* AI Response */}
                    <ResultsSection
                      lastAnswerPrompt={lastAnswerPrompt}
                      lastAIResponse={lastAIResponse}
                      isAIProcessing={isAIProcessing}
                      deepAIResponse={deepAIResponse}
                      isDeepProcessing={isDeepProcessing}
                      deepAnswerStatus={deepAnswerStatus}
                      deepAnswerError={deepAnswerError}
                      goDeeper={goDeeper}
                      conversation={conversation}
                      conversationMode={conversationMode}
                      setConversationMode={setConversationMode}
                    />

                    {/* Listen Modes quick select */}
                    <ListenModeChips
                      modes={listenModes}
                      selectedModeId={selectedListenModeId}
                      onSelectMode={selectListenMode}
                    />

                    {/* Settings Panel */}
                    <SettingsPanel
                      vadConfig={vadConfig}
                      onUpdateVadConfig={updateVadConfiguration}
                      useSystemPrompt={useSystemPrompt}
                      setUseSystemPrompt={setUseSystemPrompt}
                      contextContent={contextContent}
                      setContextContent={setContextContent}
                      autoResponseMode={autoResponseMode}
                      setAutoResponseMode={setAutoResponseMode}
                      autoResponsePace={autoResponsePace}
                      setAutoResponsePace={setAutoResponsePace}
                      fastOpenAIAnswers={fastOpenAIAnswers}
                      setFastOpenAIAnswers={setFastOpenAIAnswers}
                      jevShadowEnabled={jevShadowEnabled}
                      jevShadowAvailable={jevShadowAvailable}
                      jevShadowStatus={jevShadowStatus}
                      setJevShadowEnabled={setJevShadowEnabled}
                      sessionPlannerEnabled={sessionPlannerEnabled}
                      sessionPlannerAvailable={sessionPlannerAvailable}
                      sessionPlannerStatus={sessionPlannerStatus}
                      setSessionPlannerEnabled={setSessionPlannerEnabled}
                      deepModelOverride={deepModelOverride}
                      setDeepModelOverride={setDeepModelOverride}
                    />

                    {/* Help/Keyboard Shortcuts */}
                    <Warning isVadMode={isVadMode} />
                  </>
                )}
              </div>
            </ScrollArea>}

            {/* Quick Actions */}
            {!isCompact && !setupRequired && hasResponse && (
              <div className="flex-shrink-0 border-t border-border/50 p-2">
                <QuickActions
                  actions={quickActions}
                  onActionClick={handleQuickActionClick}
                  onAddAction={addQuickAction}
                  onRemoveAction={removeQuickAction}
                  isManaging={isManagingQuickActions}
                  setIsManaging={setIsManagingQuickActions}
                  show={showQuickActions}
                  setShow={setShowQuickActions}
                />
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
    </>
  );
};
