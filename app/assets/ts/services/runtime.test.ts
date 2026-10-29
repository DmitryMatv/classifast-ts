import { describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, stripCheckoutSecrets } from "./runtime.js";

describe("copyText", () => {
  it("writes to the clipboard", async () => {
    expect(await createBrowserRuntime(window).copyText("31161500")).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("31161500");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to a selected textarea, removes it and restores focus", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
      new Error("denied"),
    );
    let selected = "";
    vi.mocked(document.execCommand).mockImplementation(() => {
      const area = document.activeElement as HTMLTextAreaElement;
      selected = area.value.slice(area.selectionStart, area.selectionEnd);
      return true;
    });
    document.body.innerHTML = "<input id=field>";
    const field = document.getElementById("field")!;
    field.focus();

    expect(await createBrowserRuntime(window).copyText("31161500")).toBe(true);
    expect(selected).toBe("31161500");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it("reports failure when both ways fail", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
      new Error("denied"),
    );
    vi.mocked(document.execCommand).mockReturnValue(false);

    expect(await createBrowserRuntime(window).copyText("x")).toBe(false);
  });
});

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
