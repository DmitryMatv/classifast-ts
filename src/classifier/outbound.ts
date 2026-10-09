import { setTimeout as sleep } from "node:timers/promises";

export type Fetch = typeof fetch;

/** Monotonic milliseconds and a cancellable sleep, replaced in tests. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) => sleep(ms, undefined, { signal }),
};

export const TRANSIENT_STATUS_CODES: ReadonlySet<number> = new Set([
  429, 500, 502, 503, 504,
]);

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpStatusError";
  }
}

/**
 * Timeouts, connection failures and the transient status codes, like
 * Python's checks for httpx.TransportError and HTTPStatusError.
 */
export function isTransientHttpError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return TRANSIENT_STATUS_CODES.has(error.status);
  }
  if (error instanceof DOMException) return error.name === "TimeoutError";
  return (
    error instanceof TypeError &&
    (error.message === "fetch failed" || error.message === "terminated")
  );
}

export async function fetchJson(
  fetchFn: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchFn(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response.json();
}

const MAX_ATTEMPTS = 3;

/**
 * Python's tenacity policy: three attempts, waits of 1 s and then 2 s, and,
 * when `maxSeconds` is set, no new attempt once that much time has passed.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  isTransient: (error: unknown) => boolean,
  {
    clock,
    signal,
    maxSeconds,
  }: {
    clock: Clock;
    signal: AbortSignal;
    maxSeconds?: number;
  },
): Promise<T> {
  const start = clock.now();
  for (let attemptNumber = 1; ; attemptNumber += 1) {
    try {
      return await attempt();
    } catch (error) {
      const outOfTime =
        maxSeconds !== undefined && (clock.now() - start) / 1000 >= maxSeconds;
      if (
        signal.aborted ||
        !isTransient(error) ||
        attemptNumber >= MAX_ATTEMPTS ||
        outOfTime
      ) {
        throw error;
      }
      await clock.sleep(Math.min(10, 2 ** (attemptNumber - 1)) * 1000, signal);
    }
  }
}
