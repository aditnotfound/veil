import { useEffect, useRef } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { floatArrayToWav } from "@/lib/utils";

type Props = {
  deviceId: string;
  onSegment: (audio: Blob, startedAt: number) => void;
  onSpeechStart: () => void;
  onFrame?: (samples: Float32Array) => void;
  onError: (message: string) => void;
};

/** Mounted only while Listen is capturing and its microphone source is enabled. */
export function CallMicCapture({ deviceId, onSegment, onSpeechStart, onFrame, onError }: Props) {
  const speechStartedAt = useRef(0);
  const vad = useMicVAD({
    startOnLoad: true,
    userSpeakingThreshold: 0.6,
    additionalAudioConstraints:
      deviceId && deviceId !== "default"
        ? { deviceId: { exact: deviceId } }
        : {},
    onSpeechStart: () => {
      speechStartedAt.current = Date.now();
      onSpeechStart();
    },
    onFrameProcessed: (_probabilities, frame) => onFrame?.(frame),
    onSpeechEnd: (samples) => {
      const startedAt = speechStartedAt.current || Date.now();
      speechStartedAt.current = 0;
      onSegment(floatArrayToWav(samples, 16000, "wav"), startedAt);
    },
  });

  useEffect(() => {
    if (vad.errored) onError(vad.errored);
  }, [vad.errored, onError]);

  return null;
}
