import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient.mappingCheckout", () => {
  it("posts the slug and return URL and redirects to the checkout URL", async () => {
    const fetch = vi.fn(async () =>
      answer(200, { url: "https://polar.example/checkout" }),
    );
    vi.stubGlobal("fetch", fetch);

    const outcome = await createApiClient(window).mappingCheckout(
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
      await createApiClient(window).mappingCheckout("slug", "https://x.test/"),
    ).toEqual({ kind: "failed" });
  });
});
