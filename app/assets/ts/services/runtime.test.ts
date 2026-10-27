import { describe, expect, it } from "vitest";
import { stripCheckoutSecrets } from "./runtime.js";

describe("stripCheckoutSecrets", () => {
  it("removes Polar's tokens and keeps checkout=success, the hash and history.state", () => {
    window.history.replaceState(
      { kept: true },
      "",
      "/UNSPSC/?checkout=success&checkout_token=t&customer_session_token=s&a=1#top",
    );

    stripCheckoutSecrets(window);

    expect(`${location.pathname}${location.search}${location.hash}`).toBe(
      "/UNSPSC/?checkout=success&a=1#top",
    );
    expect(window.history.state).toEqual({ kept: true });
  });

  it("leaves a URL without tokens untouched", () => {
    window.history.replaceState(null, "", "/mapping/?q=a%20b");

    stripCheckoutSecrets(window);

    expect(location.search).toBe("?q=a%20b");
  });
});
