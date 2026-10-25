import type { ClassificationOutcome } from "../classifier/classification-service.js";
import { ClassificationQueueFull } from "../classifier/classification-queue.js";
import {
  classifierPageResponse,
  matchClassifierRoute,
  seedClassifierPageResults,
  starletteUrlPath,
} from "./classifier-page-delivery.js";

describe("matchClassifierRoute", () => {
  it.each([
    ["/UNSPSC", { kind: "no-slash", classifierType: "UNSPSC" }],
    ["/UNSPSC/", { kind: "page", classifierType: "UNSPSC", searchQuery: "" }],
    [
      "/UNSPSC/a/b\n/",
      { kind: "page", classifierType: "UNSPSC", searchQuery: "a/b\n/" },
    ],
    ["/", undefined],
    ["//UNSPSC/", undefined],
  ])("%j", (path, route) => {
    expect(matchClassifierRoute(path)).toEqual(route);
  });
});

describe("starletteUrlPath", () => {
  it("ends at a decoded ? or # and drops tab, CR and LF", () => {
    expect(starletteUrlPath("/UNSPSC/a\tb/")).toBe("/UNSPSC/ab/");
    expect(starletteUrlPath("/UNSPSC/a?b#c/")).toBe("/UNSPSC/a");
    expect(starletteUrlPath("/UNSPSC/a#b/")).toBe("/UNSPSC/a");
  });
});

describe("seedClassifierPageResults", () => {
  const outcome = {
    results: [{ id: 1, score: 0.5, payload: {} }],
    versionName: "v",
    version: { collectionName: "c" },
    query: "q",
    elapsedSeconds: 0.25,
    rerank: "applied",
  } satisfies ClassificationOutcome;
  const ignore = () => {};

  it("leaves a query page to the client unless SSR is allowed", async () => {
    const classify = vi.fn();
    const seeded = await seedClassifierPageResults(
      classify,
      "laptop",
      "example",
      false,
      ignore,
    );
    expect(classify).not.toHaveBeenCalled();
    expect(seeded).toEqual({
      results: { query: "laptop", results: [], loaded: false },
      defaultExamplePrefill: false,
      triggerSearchOnLoad: true,
      state: "not_attempted",
    });
  });

  it("classifies the example on a base page", async () => {
    const classify = vi.fn(() => Promise.resolve(outcome));
    const seeded = await seedClassifierPageResults(
      classify,
      "",
      " an  example ",
      false,
      ignore,
    );
    expect(classify).toHaveBeenCalledWith("an example");
    expect(seeded.state).toBe("success");
    expect(seeded.defaultExamplePrefill).toBe(true);
    expect(seeded.triggerSearchOnLoad).toBe(false);
    expect(seeded.results.loaded).toBe(true);
  });

  it.each([
    [new ClassificationQueueFull(), "overloaded"],
    [new Error("boom"), "failure"],
  ])("falls back to client loading after %s", async (error, state) => {
    const logged: unknown[] = [];
    const seeded = await seedClassifierPageResults(
      () => Promise.reject(error),
      "laptop",
      "example",
      true,
      (...args) => logged.push(args),
    );
    expect(seeded).toEqual({
      results: { query: "laptop", results: [], loaded: false },
      defaultExamplePrefill: false,
      triggerSearchOnLoad: true,
      state,
    });
    expect(logged).toEqual([[state, error]]);
  });
});

describe("classifierPageResponse", () => {
  const url = "https://classifast.com/UNSPSC/";

  it("caches a page without a failed SSR attempt", () => {
    const { status, headers } = classifierPageResponse("success", true, url);
    expect(status).toBe(200);
    expect(headers["Cache-Control"]).toContain("public");
    expect(headers["X-Robots-Tag"]).toBe("index, follow");
  });

  it("asks a verified crawler to retry after a full queue", () => {
    const { status, headers } = classifierPageResponse("overloaded", true, url);
    expect(status).toBe(503);
    expect(headers["Retry-After"]).toBe("120");
    expect(headers["Cache-Control"]).toBe("no-store, max-age=0");
    expect(headers["X-Robots-Tag"]).toBe("index, follow");
  });

  it("serves a visitor 200 without caching after a full queue", () => {
    const { status, headers } = classifierPageResponse(
      "overloaded",
      false,
      url,
    );
    expect(status).toBe(200);
    expect(headers["Retry-After"]).toBeUndefined();
    expect(headers["Cloudflare-CDN-Cache-Control"]).toBe("no-store");
  });

  it("marks a genuine failure noindex", () => {
    const { status, headers } = classifierPageResponse("failure", true, url);
    expect(status).toBe(200);
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headers["Cache-Control"]).toBe("no-store, max-age=0");
  });

  it.each(["not_attempted", "overloaded", "failure"] as const)(
    "tags only a page whose results rendered, not %s",
    (state) => {
      const tag = "sitemap-results";
      expect(
        classifierPageResponse("success", false, url, tag).headers["Cache-Tag"],
      ).toBe(tag);
      expect(
        classifierPageResponse(state, false, url, tag).headers["Cache-Tag"],
      ).toBeUndefined();
    },
  );
});
