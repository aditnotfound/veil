/** A stalled batch STT request gets one bounded second chance. */
export const STT_ATTEMPT_TIMEOUT_MS = 8_000;

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
