export const HEALTH_PROBE_TIMEOUT_MS = 5_000;

export interface HealthInputs {
  readonly embeddingReady: boolean;
  readonly probeQdrant: () => Promise<unknown>;
}

/** Whether `probe` resolves within `timeoutMs`; a rejection counts as down. */
export async function probeSucceeds(
  probe: () => Promise<unknown>,
  timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false);
  });
  try {
    return await Promise.race([probe().then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function isHealthy(
  { embeddingReady, probeQdrant }: HealthInputs,
  timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return embeddingReady && probeSucceeds(probeQdrant, timeoutMs);
}
