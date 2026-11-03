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

/** Limit speculative duplicate uploads to valid, short PCM WAV clips. */
export function isShortWavForHedge(wav: Uint8Array): boolean {
  if (wav.byteLength < 44 ||
      String.fromCharCode(...wav.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...wav.subarray(8, 12)) !== "WAVE" ||
      String.fromCharCode(...wav.subarray(12, 16)) !== "fmt " ||
      String.fromCharCode(...wav.subarray(36, 40)) !== "data") return false;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) < 1 || view.getUint16(34, true) !== 16) return false;
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  return byteRate > 0 && dataBytes > 0 && dataBytes <= wav.byteLength - 44 &&
    dataBytes / byteRate <= 10;
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

/**
 * Start one backup request only if a short live-call transcription is slow.
 * Both requests go to the same configured provider. The first success wins;
 * stopping the session cancels both, even if a transport ignores abort.
 */
export async function transcribeWithHedge(
  transcribe: (signal: AbortSignal) => Promise<string>,
  sessionSignal?: AbortSignal,
  timeoutMs = STT_ATTEMPT_TIMEOUT_MS,
  hedgeDelayMs = 3_000,
): Promise<string> {
  if (sessionSignal?.aborted) throw aborted();
  const controllers: AbortController[] = [];
  const attemptTimers: ReturnType<typeof setTimeout>[] = [];
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let winner = -1;
  let rejectCanceled: (error: Error) => void = () => {};
  const canceled = new Promise<never>((_, reject) => { rejectCanceled = reject; });
  const onAbort = () => {
    controllers.forEach((controller) => controller.abort());
    rejectCanceled(aborted());
  };
  sessionSignal?.addEventListener("abort", onAbort, { once: true });

  const attempt = (index: number) => {
    const controller = new AbortController();
    controllers[index] = controller;
    const deadline = new Promise<never>((_, reject) => {
      attemptTimers[index] = setTimeout(() => {
        controller.abort();
        reject(new TranscriptionTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([
      Promise.resolve().then(() => transcribe(controller.signal)), deadline,
    ]).then((value) => ({ index, value })).finally(() => clearTimeout(attemptTimers[index]));
  };

  try {
    if (sessionSignal?.aborted) throw aborted();
    const first = attempt(0);
    const hedge = new Promise<{ hedge: true }>((resolve) => {
      hedgeTimer = setTimeout(() => resolve({ hedge: true }), hedgeDelayMs);
    });
    // A fast failure is returned immediately; don't duplicate bad credentials.
    const early = await Promise.race([first, hedge, canceled]);
    if (!("hedge" in early)) {
      winner = early.index;
      return early.value;
    }
    const second = attempt(1);
    const firstSuccess = new Promise<{ index: number; value: string }>((resolve, reject) => {
      const errors: unknown[] = [];
      let failures = 0;
      [first, second].forEach((request, index) => {
        request.then(resolve, (error) => {
          errors[index] = error;
          failures++;
          if (failures === 2) reject(errors[0]);
        });
      });
    });
    const result = await Promise.race([firstSuccess, canceled]);
    winner = result.index;
    return result.value;
  } finally {
    clearTimeout(hedgeTimer);
    attemptTimers.forEach(clearTimeout);
    controllers.forEach((controller, index) => { if (index !== winner) controller.abort(); });
    sessionSignal?.removeEventListener("abort", onAbort);
  }
}
