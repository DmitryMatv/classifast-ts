export const HEALTH_PROBE_TIMEOUT_MS = 5_000;

export interface HealthInputs {
  readonly embeddingReady: boolean;
  readonly probeQdrant: () => Promise<unknown>;
}

// Mirrors Python's /health: both clients must exist, then Qdrant must answer
// within five seconds.
export async function isHealthy(
  { embeddingReady, probeQdrant }: HealthInputs,
  timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (!embeddingReady) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false);
  });
  try {
    return await Promise.race([probeQdrant().then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
