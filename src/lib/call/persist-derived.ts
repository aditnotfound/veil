/** Run independent derived writes after the parent utterance has been saved. */
export async function persistCallDerivedData(
  saveLedger: () => Promise<void>,
  saveDecision: () => Promise<void>,
): Promise<[PromiseSettledResult<void>, PromiseSettledResult<void>]> {
  return Promise.allSettled([
    Promise.resolve().then(saveLedger),
    Promise.resolve().then(saveDecision),
  ]);
}
