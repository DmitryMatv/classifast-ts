import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResultsResponse } from "../../../../src/web/results-api.js";
import { createApiClient } from "./api.js";
import { AuthUnavailableError, type Authorization } from "./auth.js";

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ANONYMOUS = {
  authorization: async (): Promise<Authorization> => ({ kind: "anonymous" }),
};
const BEARER = {
  authorization: async (): Promise<Authorization> => ({
    kind: "bearer",
    token: "jwt-1",
  }),
};

/** A fetch that never answers but rejects when its signal aborts, as fetch does. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
  );
}

function clearCookies(): void {
  for (const row of document.cookie.split("; ")) {
    const name = row.split("=")[0];
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  }
}

describe("ApiClient.mappingCheckout", () => {
  it("posts the slug and return URL and redirects to the checkout URL", async () => {
    const fetch = vi.fn(async () =>
      answer(200, { url: "https://polar.example/checkout" }),
    );
    vi.stubGlobal("fetch", fetch);

    const outcome = await createApiClient(window, ANONYMOUS).mappingCheckout(
      "unspsc-to-cpv-mapping",
      "https://classifast.test/mapping/unspsc-to-cpv-mapping/",
    );

    expect(outcome).toEqual({
      kind: "redirect",
      url: "https://polar.example/checkout",
    });
    expect(fetch).toHaveBeenCalledWith("/api/create-mapping-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "unspsc-to-cpv-mapping",
        return_url: "https://classifast.test/mapping/unspsc-to-cpv-mapping/",
      }),
    });
  });

  it.each([
    ["an error status", async () => answer(503, { detail: "unavailable" })],
    ["no url", async () => answer(200, {})],
    ["an empty url", async () => answer(200, { url: "" })],
    ["a body that is not JSON", async () => new Response("<html>")],
    [
      "a network failure",
      async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("fails on %s", async (_, respond) => {
    vi.stubGlobal("fetch", vi.fn(respond));

    expect(
      await createApiClient(window, ANONYMOUS).mappingCheckout(
        "slug",
        "https://x.test/",
      ),
    ).toEqual({ kind: "failed" });
  });
});

const QUERY = {
  query: "steel bolts",
  version: "UNSPSC v26",
  topK: 30,
  enhance: true,
};
const PATH =
  "/api/results/UNSPSC?product_description=steel+bolts&version=UNSPSC+v26&top_k=30&enhance_query=1";

const RESULTS: ResultsResponse = {
  kind: "results",
  version: "UNSPSC v26",
  query: "steel bolts",
  url: "/UNSPSC/?query=steel+bolts",
  title: "UNSPSC codes for 'Steel Bolts'",
  results: [
    {
      originalId: "31161500",
      codeTokens: [{ char: "3", gapAfter: false }],
      definition: "Bolts",
      scoreLabel: "91.0",
      scoreWidth: "91.00",
    },
  ],
  elapsed: "0.42",
};

describe("ApiClient.results", () => {
  beforeEach(clearCookies);
  afterEach(clearCookies);

  it.each<[string, number, ResultsResponse]>([
    ["results", 200, RESULTS],
    [
      "a paywall",
      402,
      {
        kind: "paywall",
        signedIn: false,
        limit: 10,
        url: RESULTS.url,
        title: RESULTS.title,
      },
    ],
    ["busy", 503, { kind: "busy", message: "Queue full" }],
    ["an error", 500, { kind: "error", message: "Error processing request" }],
  ])("answers %s as the server sent it", async (_, status, body) => {
    const fetch = vi.fn(async () => answer(status, body));
    vi.stubGlobal("fetch", fetch);

    const reply = await createApiClient(window, ANONYMOUS).results(
      "UNSPSC",
      QUERY,
      new AbortController().signal,
    );

    expect(reply).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(PATH, {
      headers: {},
      signal: expect.any(AbortSignal),
    });
  });

  it("sends a signed-in visitor's token", async () => {
    const fetch = vi.fn(async () => answer(200, RESULTS));
    vi.stubGlobal("fetch", fetch);

    await createApiClient(window, BEARER).results(
      "UNSPSC",
      QUERY,
      new AbortController().signal,
    );

    expect(fetch).toHaveBeenCalledWith(PATH, {
      headers: { Authorization: "Bearer jwt-1" },
      signal: expect.any(AbortSignal),
    });
  });

  it("writes a version 4 cf_track before the first lookup and keeps it after", async () => {
    let cookieAtFetch = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        cookieAtFetch = document.cookie;
        return answer(200, RESULTS);
      }),
    );
    const api = createApiClient(window, ANONYMOUS);
    const signal = new AbortController().signal;

    await api.results("UNSPSC", QUERY, signal);
    const first = cookieAtFetch;
    await api.results("UNSPSC", QUERY, signal);

    expect(first).toMatch(
      /^cf_track=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(cookieAtFetch).toBe(first);
  });

  it("keeps a cf_track the browser already has", async () => {
    document.cookie = "cf_track=existing; path=/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(200, RESULTS)),
    );

    await createApiClient(window, ANONYMOUS).results(
      "UNSPSC",
      QUERY,
      new AbortController().signal,
    );

    expect(document.cookie).toBe("cf_track=existing");
  });

  it.each([
    [
      "a network failure",
      async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      },
      "Network error. Check your connection and try again.",
    ],
    [
      "a proxy's HTML page",
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
      "Something went wrong. Please try again.",
    ],
    [
      "JSON that is no answer",
      async () => answer(500, { detail: "Internal Server Error" }),
      "Something went wrong. Please try again.",
    ],
    [
      "a results answer missing a field",
      async () => answer(200, { ...RESULTS, query: undefined }),
      "Something went wrong. Please try again.",
    ],
  ])("answers an error for %s", async (_, respond, message) => {
    vi.stubGlobal("fetch", vi.fn(respond));

    expect(
      await createApiClient(window, ANONYMOUS).results(
        "UNSPSC",
        QUERY,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "error", message });
  });

  it("answers an error without fetching when a signed-in visitor has no token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const failing = {
      authorization: () => Promise.reject(new AuthUnavailableError()),
    };

    expect(
      await createApiClient(window, failing).results(
        "UNSPSC",
        QUERY,
        new AbortController().signal,
      ),
    ).toEqual({
      kind: "error",
      message: "Authentication failed. Please try again.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects when aborted while waiting for auth or for the answer", async () => {
    const fetch = hangingFetch();
    vi.stubGlobal("fetch", fetch);
    const waiting = new AbortController();
    const pending = {
      authorization: (signal: AbortSignal) =>
        new Promise<Authorization>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    };
    const waitingAuth = createApiClient(window, pending).results(
      "UNSPSC",
      QUERY,
      waiting.signal,
    );
    waiting.abort();
    await expect(waitingAuth).rejects.toThrow();

    const inFlight = new AbortController();
    const fetching = createApiClient(window, ANONYMOUS).results(
      "UNSPSC",
      QUERY,
      inFlight.signal,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    inFlight.abort();
    await expect(fetching).rejects.toThrow();
  });
});

describe("ApiClient.checkout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts the return URL with the visitor's token and redirects to Polar", async () => {
    const fetch = vi.fn(async () =>
      answer(200, { url: "https://polar.example/checkout" }),
    );
    vi.stubGlobal("fetch", fetch);

    const outcome = await createApiClient(window, BEARER).checkout(
      "https://classifast.test/UNSPSC/",
      new AbortController().signal,
    );

    expect(outcome).toEqual({
      kind: "redirect",
      url: "https://polar.example/checkout",
    });
    expect(fetch).toHaveBeenCalledWith("/api/create-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer jwt-1",
      },
      body: JSON.stringify({ return_url: "https://classifast.test/UNSPSC/" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("fails without a request when the visitor has no token", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(
      await createApiClient(window, ANONYMOUS).checkout(
        "https://classifast.test/UNSPSC/",
        new AbortController().signal,
      ),
    ).toEqual({ kind: "failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails after 30 seconds and aborts the request", async () => {
    vi.useFakeTimers();
    const fetch = hangingFetch();
    vi.stubGlobal("fetch", fetch);

    const outcome = createApiClient(window, BEARER).checkout(
      "https://classifast.test/UNSPSC/",
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(29_999);
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toEqual({ kind: "failed" });
    expect(signal?.aborted).toBe(true);
  });

  it("rejects when the caller aborts", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const caller = new AbortController();

    const outcome = createApiClient(window, BEARER).checkout(
      "https://classifast.test/UNSPSC/",
      caller.signal,
    );
    caller.abort();

    await expect(outcome).rejects.toThrow();
  });
});
