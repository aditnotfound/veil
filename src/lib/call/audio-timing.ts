/** Rust's current WAV encoder writes a canonical 44-byte mono PCM header. */
export function estimateWavStartAt(emittedAt: number, wav: Uint8Array): number {
  if (wav.byteLength < 44) return emittedAt;
  if (String.fromCharCode(...wav.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...wav.subarray(8, 12)) !== "WAVE") return emittedAt;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  if (!byteRate || dataBytes > wav.byteLength - 44 || dataBytes / byteRate > 180) return emittedAt;
  return emittedAt - Math.round((dataBytes / byteRate) * 1000);
}
