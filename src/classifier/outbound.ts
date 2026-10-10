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

/**
 * AbortSignal.timeout() throws RangeError for a fractional delay. Rounding
 * down keeps a request inside its budget.
 */
export function timeoutMilliseconds(ms: number): number {
  return Math.floor(ms);
}

export async function fetchJson(
  fetchFn: Fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  const timeout = timeoutMilliseconds(timeoutMs);
  // An exhausted budget fails like the timeout it would have become, so
  // isTransientHttpError and the pipeline treat both alike.
  if (timeout < 1) {
    throw new DOMException("The operation timed out.", "TimeoutError");
  }
  const response = await fetchFn(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  if (!response.ok) throw new HttpStatusError(response.status, url);
  return response.json();
}

const MAX_ATTEMPTS = 3;

/**
 * Python's tenacity policy: three attempts, waits of 1 s and then 2 s, and,
 * when `maxSeconds` is set, no new attempt that would start after that much
 * time has passed. Python's `stop_after_delay` checks before the wait, so it
 * can sleep past the budget and start one more attempt; this matches
 * tenacity's `stop_before_delay` instead.
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
      const waitMs = Math.min(10, 2 ** (attemptNumber - 1)) * 1000;
      const outOfTime =
        maxSeconds !== undefined &&
        clock.now() - start + waitMs >= maxSeconds * 1000;
      if (
        signal.aborted ||
        !isTransient(error) ||
        attemptNumber >= MAX_ATTEMPTS ||
        outOfTime
      ) {
        throw error;
      }
      await clock.sleep(waitMs, signal);
    }
  }
}
