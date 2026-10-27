import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, element, fakeServices, hydratePage } from "../test/islands.js";
import { Island } from "../../../../src/web/islands/render-island.js";

const RETURN_URL = "https://classifast.test/mapping/unspsc-to-cpv-mapping/";

function buyButtonPage() {
  return (
    <Island
      name="buy-button"
      className="contents"
      props={{
        slug: "unspsc-to-cpv-mapping",
        returnUrl: RETURN_URL,
        className: "primary-action",
      }}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("buy-button island", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prepares a checkout for its slug and return URL, then navigates to it", async () => {
    const answer = deferred<{ kind: "redirect"; url: string }>();
    const services = fakeServices({ checkout: () => answer.promise });
    expect(await hydratePage(buyButtonPage(), services)).toEqual([]);
    const button = element<HTMLButtonElement>("button");
    expect(button.textContent).toBe("Buy full mapping file");

    await click(button);

    expect(services.checkouts).toEqual([["unspsc-to-cpv-mapping", RETURN_URL]]);
    expect(button.textContent).toBe("Preparing...");
    expect(button.disabled).toBe(true);

    await act(async () =>
      answer.resolve({ kind: "redirect", url: "https://polar.example/c" }),
    );

    expect(services.navigations).toEqual(["https://polar.example/c"]);
    expect(button.textContent).toBe("Preparing...");
  });

  it("shows an error, stays clickable, and restores its label after 3 s", async () => {
    vi.useFakeTimers();
    const services = fakeServices();
    expect(await hydratePage(buyButtonPage(), services)).toEqual([]);
    const button = element<HTMLButtonElement>("button");

    await click(button);

    expect(button.textContent).toBe("Error - Try again");
    expect(button.disabled).toBe(false);
    expect(services.navigations).toEqual([]);

    await act(async () => vi.advanceTimersByTime(2999));
    expect(button.textContent).toBe("Error - Try again");
    await act(async () => vi.advanceTimersByTime(1));
    expect(button.textContent).toBe("Buy full mapping file");
  });

  it("retries from the error state without the old timer cutting the new attempt short", async () => {
    vi.useFakeTimers();
    const services = fakeServices();
    expect(await hydratePage(buyButtonPage(), services)).toEqual([]);
    const button = element<HTMLButtonElement>("button");

    await click(button);
    await act(async () => vi.advanceTimersByTime(2000));
    await click(button);
    await act(async () => vi.advanceTimersByTime(2000));

    expect(services.checkouts).toHaveLength(2);
    expect(button.textContent).toBe("Error - Try again");
  });
});

describe("checkout-banner island", () => {
  const page = (
    <Island name="checkout-banner" className="contents" props={{}} />
  );

  it("shows the banner and strips the checkout parameters on ?checkout=success", async () => {
    const services = fakeServices({
      href: "https://classifast.test/mapping/unspsc-to-cpv-mapping/?checkout=success&checkout_token=t&customer_session_token=s&foo=bar#faq",
    });
    expect(await hydratePage(page, services)).toEqual([]);

    expect(element("#storefront-success-message").classList).not.toContain(
      "hidden",
    );
    expect(services.replacedUrls).toEqual([
      "/mapping/unspsc-to-cpv-mapping/?foo=bar#faq",
    ]);
  });

  it("stays hidden and leaves the URL alone otherwise", async () => {
    const services = fakeServices({
      href: "https://classifast.test/mapping/unspsc-to-cpv-mapping/?checkout=pending",
    });
    expect(await hydratePage(page, services)).toEqual([]);

    expect(element("#storefront-success-message").classList).toContain(
      "hidden",
    );
    expect(services.replacedUrls).toEqual([]);
  });
});
