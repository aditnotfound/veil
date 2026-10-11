/** A stalled batch STT request gets one bounded second chance. */
export const STT_ATTEMPT_TIMEOUT_MS = 8_000;

/** Allow long WAV clips time to upload and transcribe without slowing short turns. */
export function timeoutForWav(wav: Uint8Array): number {
  if (wav.byteLength < 44 ||
      String.fromCharCode(...wav.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...wav.subarray(8, 12)) !== "WAVE") {
    return STT_ATTEMPT_TIMEOUT_MS;
  }
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  if (!byteRate || dataBytes > wav.byteLength - 44) return STT_ATTEMPT_TIMEOUT_MS;
  return Math.min(90_000, Math.max(STT_ATTEMPT_TIMEOUT_MS,
    Math.ceil(dataBytes / byteRate * 750) + STT_ATTEMPT_TIMEOUT_MS));
}

export class TranscriptionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Transcription timed out (${timeoutMs / 1000}s per attempt, 2 attempts)`);
    this.name = "TranscriptionTimeoutError";
  }
}

function aborted(): DOMException {
  return new DOMException("Transcription canceled", "AbortError");
}

export async function transcribeWithRetry(
  transcribe: (signal: AbortSignal) => Promise<string>,
  sessionSignal?: AbortSignal,
  timeoutMs = STT_ATTEMPT_TIMEOUT_MS
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (sessionSignal?.aborted) throw aborted();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectCanceled: (error: Error) => void = () => {};
    const canceled = new Promise<never>((_, reject) => { rejectCanceled = reject; });
    const onSessionAbort = () => {
      controller.abort();
      rejectCanceled(aborted());
    };
    sessionSignal?.addEventListener("abort", onSessionAbort, { once: true });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new TranscriptionTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    try {
      return await Promise.race([transcribe(controller.signal), deadline, canceled]);
    } catch (error) {
      if (sessionSignal?.aborted) throw aborted();
      if (!timedOut || attempt === 1) {
        if (timedOut) throw new TranscriptionTimeoutError(timeoutMs);
        throw error;
      }
    } finally {
      clearTimeout(timer);
      sessionSignal?.removeEventListener("abort", onSessionAbort);
    }
  }
  throw new TranscriptionTimeoutError(timeoutMs);
}
