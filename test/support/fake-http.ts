import type { Clock, Fetch } from "../../src/classifier/outbound.js";

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: unknown;
  readonly signal: AbortSignal | undefined;
}

export type Reply = Response | Error | ((request: RecordedRequest) => Response);

export interface FakeFetch {
  readonly fetch: Fetch;
  readonly requests: RecordedRequest[];
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Records each request and answers with the next reply; the last reply
 * repeats. An Error reply rejects like a failed connection.
 */
export function fakeFetch(...replies: Reply[]): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetch: Fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const text = typeof init?.body === "string" ? init.body : undefined;
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url: String(input),
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: text === undefined ? null : JSON.parse(text),
      signal: init?.signal ?? undefined,
    };
    requests.push(request);
    init?.signal?.throwIfAborted();
    const reply = replies[Math.min(requests.length, replies.length) - 1];
    if (reply === undefined) throw new Error("no reply configured");
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(request) : reply.clone();
  };
  return { fetch, requests };
}

export function connectionRefused(): TypeError {
  return new TypeError("fetch failed");
}

/** A clock whose sleeps pass instantly and advance `now`. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];

  constructor(public nowMs = 1_000_000) {}

  now(): number {
    return this.nowMs;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.sleeps.push(ms);
    this.nowMs += ms;
  }
}
