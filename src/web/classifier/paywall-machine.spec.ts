import {
  BUSY,
  Classifier,
  NETWORK_ERROR,
  ORIGIN,
  PENDING,
  SIGNED_OUT,
  T0,
  form,
  ofType,
  paywall,
  results,
  signedIn,
  type Browser,
} from "../../../test/support/classifier-driver.js";
import type { AuthSnapshot } from "../islands/services.js";
import type { ResultsQuery } from "../results-api.js";
import type { HistoryEntry } from "./lookup.js";
import { readStoredPaywall, storedPaywallWrites } from "./paywall-machine.js";

const COFFEE = `${ORIGIN}/NAICS/coffee/?top_k=30`;
const RETURN_PAGE = `${ORIGIN}/NAICS/industrial_pump/?checkout=success`;
const CHECKOUT = "https://billing.example/checkout";

function query(text: string, fields: Partial<ResultsQuery> = {}): ResultsQuery {
  return { query: text, version: "v1", topK: 10, enhance: false, ...fields };
}

function lookup(fields = form("other")): HistoryEntry {
  return {
    v: 1,
    fields,
    fallbackQuery: null,
    title: "NAICS codes for 'Other'",
    show: { kind: "lookup" },
  };
}

/** A query page whose autoload the server answered with a paywall. */
function showingPaywall(auth: AuthSnapshot): Classifier {
  const page = new Classifier(
    { autoload: true, title: "NAICS codes for 'Coffee'" },
    { url: COFFEE, fields: form("coffee", { topK: 30 }), auth },
  );
  page.mount();
  page.answer(paywall("/NAICS/coffee/?top_k=30", auth.status === "signed-in"));
  return page;
}

/** The query page Polar returns the payer to; `?checkout=success` disables its SSR. */
function returnPage(browser: Partial<Browser> = {}): Classifier {
  return new Classifier(
    { autoload: true, title: "NAICS codes for 'Industrial Pump'" },
    {
      url: RETURN_PAGE,
      fields: form("industrial pump"),
      auth: signedIn(),
      ...browser,
    },
  );
}

describe("paywall storage", () => {
  it("reads the records paywall.ts wrote", () => {
    const written = new Map([
      ["classifast:upgrade-intent", COFFEE],
      [
        "classifast:checkout-recovery",
        JSON.stringify({ returnUrl: RETURN_PAGE, deadline: T0 }),
      ],
    ]);
    expect(readStoredPaywall((key) => written.get(key) ?? null)).toEqual({
      upgradeIntent: COFFEE,
      activation: { returnUrl: RETURN_PAGE, deadline: T0 },
    });
  });

  it.each([
    "not json",
    "null",
    '{"returnUrl":"http://localhost:3000/"}',
    '{"returnUrl":"http://localhost:3000/","deadline":"1"}',
    '{"returnUrl":"http://localhost:3000/","deadline":1e999}',
  ])("ignores the activation record %s", (raw) => {
    expect(
      readStoredPaywall((key) =>
        key === "classifast:checkout-recovery" ? raw : null,
      ),
    ).toEqual({ upgradeIntent: null, activation: null });
  });

  it("writes the records in the shape paywall.ts reads", () => {
    expect(
      storedPaywallWrites({
        upgradeIntent: COFFEE,
        activation: { returnUrl: RETURN_PAGE, deadline: T0 },
      }),
    ).toEqual([
      ["classifast:upgrade-intent", COFFEE],
      [
        "classifast:checkout-recovery",
        `{"returnUrl":"${RETURN_PAGE}","deadline":${T0}}`,
      ],
    ]);
    expect(
      storedPaywallWrites({ upgradeIntent: null, activation: null }),
    ).toEqual([
      ["classifast:upgrade-intent", null],
      ["classifast:checkout-recovery", null],
    ]);
    expect(storedPaywallWrites({})).toEqual([]);
  });
});

describe("paywall checkout", () => {
  it("Try again reruns the lookup once per click", () => {
    const page = showingPaywall(SIGNED_OUT);
    page.paywall({ type: "retry-clicked" });
    expect(page.fetches()).toHaveLength(2);
    page.answer(paywall("/NAICS/coffee/?top_k=30"));
    page.paywall({ type: "retry-clicked" });
    expect(page.fetches().map(({ seq }) => seq)).toEqual([1, 2, 3]);
  });

  it("continues anonymous Upgrade once after a usable session without retrying classification", () => {
    const page = showingPaywall(SIGNED_OUT);
    expect(page.paywall({ type: "upgrade-clicked" })).toEqual([
      { type: "store", patch: { upgradeIntent: COFFEE } },
      { type: "open-sign-in", purpose: "upgrade" },
    ]);
    expect(
      page.paywall({ type: "sign-in-requested", purpose: "upgrade" }),
    ).toEqual([]);
    page.setAuth(signedIn("user_123", false));
    expect(ofType(page.log, "create-checkout")).toEqual([]);

    page.setAuth(signedIn());
    page.setAuth(signedIn());
    expect(ofType(page.log, "create-checkout")).toEqual([
      { type: "create-checkout", returnUrl: COFFEE },
    ]);
    expect(page.fetches()).toHaveLength(1);
    expect(page.browser.stored.upgradeIntent).toBeNull();
    expect(page.view.panel).toMatchObject({ upgrade: "preparing" });

    expect(
      page.paywall({
        type: "checkout-settled",
        outcome: { kind: "redirect", url: CHECKOUT },
      }),
    ).toEqual([{ type: "navigate", url: CHECKOUT }]);
  });

  it("claims a saved Upgrade on auth readiness even without paywall controls", () => {
    const page = new Classifier(
      {},
      {
        url: `${ORIGIN}/NAICS/coffee/?top_k=30&checkout_token=abc`,
        auth: PENDING,
        stored: { upgradeIntent: COFFEE, activation: null },
      },
    );
    page.mount();
    expect(page.view.panel).toEqual({ kind: "page" });
    page.setAuth(signedIn());
    page.setAuth(signedIn());
    expect(ofType(page.log, "create-checkout")).toEqual([
      { type: "create-checkout", returnUrl: COFFEE },
    ]);
    expect(page.browser.stored).toEqual({
      upgradeIntent: null,
      activation: null,
    });
  });

  it("ordinary Sign In clears Upgrade and retries lookup on the later usable-session notification", () => {
    const page = showingPaywall(SIGNED_OUT);
    page.paywall({ type: "upgrade-clicked" });
    expect(page.paywall({ type: "sign-in-clicked" })).toEqual([
      { type: "store", patch: { upgradeIntent: null } },
      { type: "open-sign-in", purpose: "plain" },
    ]);
    page.setAuth(signedIn("user_123", false));
    expect(page.fetches()).toHaveLength(1);

    page.setAuth(signedIn());
    page.setAuth(signedIn());
    expect(page.fetches().slice(1)).toEqual([
      { type: "fetch", seq: 2, query: query("coffee", { topK: 30 }) },
    ]);
    expect(ofType(page.log, "create-checkout")).toEqual([]);
  });

  it("retries the refused lookup when a session that went unusable is usable again", () => {
    const page = showingPaywall(SIGNED_OUT);
    page.setAuth(signedIn());
    expect(page.fetches()).toHaveLength(2);
    page.answer(paywall("/NAICS/coffee/?top_k=30", true));

    page.setAuth(signedIn("user_123", false));
    page.setAuth(signedIn());
    expect(page.fetches()).toHaveLength(3);
  });

  it("clears Upgrade before the header Sign In can synchronously notify usable authentication", () => {
    const page = showingPaywall(SIGNED_OUT);
    page.paywall({ type: "upgrade-clicked" });
    page.paywall({ type: "sign-in-requested", purpose: "plain" });
    page.setAuth(signedIn());
    expect(ofType(page.log, "create-checkout")).toEqual([]);
    expect(page.fetches()).toHaveLength(2);
    expect(page.browser.stored.upgradeIntent).toBeNull();
  });

  it("does not automatically recreate checkout after a failed POST and renders the current button", () => {
    const page = showingPaywall(signedIn());
    page.paywall({ type: "upgrade-clicked" });
    expect(page.paywall({ type: "upgrade-clicked" })).toEqual([]);
    expect(page.view.panel).toMatchObject({ upgrade: "preparing" });

    page.paywall({ type: "checkout-settled", outcome: { kind: "failed" } });
    expect(page.view.panel).toMatchObject({ upgrade: "failed" });
    page.setAuth(signedIn());
    page.advance(2_999);
    expect(page.view.panel).toMatchObject({ upgrade: "failed" });
    page.advance(1);
    expect(page.view.panel).toMatchObject({ upgrade: "ready" });
    expect(ofType(page.log, "create-checkout")).toHaveLength(1);
  });

  it("retains Upgrade while a user notification has no session", () => {
    const page = showingPaywall(signedIn("user_123", false));
    page.paywall({ type: "upgrade-clicked" });
    page.setAuth(signedIn("user_123", false));
    expect(ofType(page.log, "create-checkout")).toEqual([]);
    page.setAuth(signedIn());
    expect(ofType(page.log, "create-checkout")).toHaveLength(1);
  });

  it("creates authenticated checkout with the current return URL", () => {
    const page = showingPaywall(signedIn());
    expect(page.paywall({ type: "upgrade-clicked" })).toEqual([
      { type: "create-checkout", returnUrl: COFFEE },
    ]);
    expect(
      page.paywall({
        type: "checkout-settled",
        outcome: { kind: "redirect", url: CHECKOUT },
      }),
    ).toEqual([{ type: "navigate", url: CHECKOUT }]);
  });

  it("fails closed without a token and permits an explicit checkout retry", () => {
    const page = showingPaywall(signedIn());
    page.paywall({ type: "upgrade-clicked" });
    page.paywall({ type: "checkout-settled", outcome: { kind: "failed" } });
    expect(page.view.panel).toMatchObject({ upgrade: "failed" });

    page.paywall({ type: "upgrade-clicked" });
    page.paywall({
      type: "checkout-settled",
      outcome: { kind: "redirect", url: CHECKOUT },
    });
    expect(ofType(page.log, "create-checkout")).toHaveLength(2);
    expect(ofType(page.log, "navigate")).toEqual([
      { type: "navigate", url: CHECKOUT },
    ]);
  });

  it("times out token waiting without issuing a later checkout", () => {
    const page = showingPaywall(signedIn());
    page.paywall({ type: "upgrade-clicked" });
    page.paywall({ type: "checkout-settled", outcome: { kind: "failed" } });
    expect(
      page.paywall({
        type: "checkout-settled",
        outcome: { kind: "redirect", url: CHECKOUT },
      }),
    ).toEqual([]);
    expect(page.browser.stored.upgradeIntent).toBeNull();
  });

  it("discards a saved Upgrade when returning to a different route", () => {
    const page = showingPaywall(SIGNED_OUT);
    page.paywall({ type: "upgrade-clicked" });
    page.browser.url = `${ORIGIN}/NAICS/tea/`;
    page.send({ type: "history-popped", entry: lookup(form("tea")) });
    page.answer(paywall("/NAICS/tea/"));
    page.setAuth(signedIn());
    expect(page.browser.stored.upgradeIntent).toBeNull();
    expect(ofType(page.log, "create-checkout")).toEqual([]);
    expect(page.lastFetch()).toEqual({
      type: "fetch",
      seq: 3,
      query: query("tea"),
    });
  });

  it("discards a stored Upgrade intent for another route when the page loads", () => {
    const page = new Classifier(
      {},
      {
        url: `${ORIGIN}/NAICS/tea/`,
        auth: signedIn(),
        stored: { upgradeIntent: COFFEE, activation: null },
      },
    );
    expect(page.mount()).toContainEqual({
      type: "store",
      patch: { upgradeIntent: null },
    });
    expect(ofType(page.log, "create-checkout")).toEqual([]);
  });

  it.each([
    ["signs out", SIGNED_OUT],
    ["switches user", signedIn("user_456")],
  ])(
    "abandons a checkout being created when the visitor %s",
    (_change, auth) => {
      const page = showingPaywall(signedIn());
      page.paywall({ type: "upgrade-clicked" });
      expect(page.setAuth(auth)).toContainEqual({ type: "abort-checkout" });
      expect(page.view.panel).toMatchObject({ upgrade: "ready" });
      expect(
        page.paywall({
          type: "checkout-settled",
          outcome: { kind: "redirect", url: CHECKOUT },
        }),
      ).toEqual([]);
    },
  );

  it("offers Upgrade again after Back from the checkout page", () => {
    const page = showingPaywall(signedIn());
    page.paywall({ type: "upgrade-clicked" });
    page.paywall({
      type: "checkout-settled",
      outcome: { kind: "redirect", url: CHECKOUT },
    });
    expect(page.view.panel).toMatchObject({ upgrade: "preparing" });
    page.send({ type: "page-hidden" });
    page.send({ type: "page-shown", persisted: true });
    expect(page.view.panel).toMatchObject({ upgrade: "ready" });
  });
});

describe("paywall activation", () => {
  it("observes initial autoload and serializes pending activation retries without checkout", () => {
    const page = returnPage();
    expect(ofType(page.mount(), "fetch")).toEqual([
      { type: "fetch", seq: 1, query: query("industrial pump") },
    ]);
    expect(page.view).toEqual({
      loading: true,
      panel: { kind: "activation", phase: "checking" },
    });
    expect(page.browser.stored.activation).toEqual({
      returnUrl: RETURN_PAGE,
      deadline: T0 + 60_000,
    });

    page.answer(paywall("/NAICS/industrial_pump/", true));
    expect(page.view).toEqual({
      loading: false,
      panel: { kind: "activation", phase: "checking" },
    });
    page.advance(1_999);
    expect(page.fetches()).toHaveLength(1);
    page.advance(1);
    expect(page.fetches()).toHaveLength(2);

    page.send({ type: "page-shown", persisted: true });
    page.setAuth(signedIn());
    page.advance(10_000);
    expect(page.fetches()).toHaveLength(2);

    const activated = page.answer(results());
    expect(page.view).toEqual({
      loading: false,
      panel: { kind: "results", key: 2, answer: results() },
    });
    expect(page.browser.stored.activation).toBeNull();
    expect(page.pendingTimers()).toEqual([]);
    expect(ofType(activated, "push-entry")).toEqual([]);
    page.advance(60_000);
    expect(page.fetches()).toHaveLength(2);
    expect(ofType(page.log, "create-checkout")).toEqual([]);
  });

  it("checks the base page's example at once after checkout", () => {
    const page = new Classifier(
      { autoload: false, example: "Industrial pump" },
      { url: `${ORIGIN}/NAICS/?checkout=success`, auth: signedIn() },
    );
    expect(ofType(page.mount(), "fetch")).toEqual([
      { type: "fetch", seq: 1, query: query("Industrial pump") },
    ]);
    expect(page.view).toEqual({
      loading: true,
      panel: { kind: "activation", phase: "checking" },
    });

    page.answer(results());
    expect(page.view.panel).toMatchObject({ kind: "results" });
    expect(page.browser.stored.activation).toBeNull();
  });

  it("checks once auth settles when the page loads before it", () => {
    const page = new Classifier(
      { autoload: false, example: "Industrial pump" },
      { url: `${ORIGIN}/NAICS/?checkout=success`, auth: PENDING },
    );
    page.mount();
    expect(page.fetches()).toEqual([]);
    expect(page.view.loading).toBe(true);
    page.setAuth(signedIn());
    expect(page.fetches()).toHaveLength(1);
  });

  it("retries 503 and network failures within one deadline and exposes manual Try again", () => {
    const page = returnPage();
    page.mount();
    page.answer(BUSY);
    while (page.browser.now < T0 + 70_000) {
      page.advance(1_000);
      if (page.view.loading) page.answer(NETWORK_ERROR);
    }
    expect(page.fetches()).toHaveLength(30);
    expect(page.view).toEqual({
      loading: false,
      panel: { kind: "activation", phase: "delayed" },
    });

    page.paywall({ type: "retry-clicked" });
    expect(page.fetches()).toHaveLength(31);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });
    expect(page.browser.stored.activation).toEqual({
      returnUrl: RETURN_PAGE,
      deadline: T0 + 130_000,
    });
    expect(ofType(page.log, "create-checkout")).toEqual([]);
  });

  it("bounds a hung initial lookup and aborts recovery on edited forms", () => {
    const page = returnPage();
    page.mount();
    expect(page.advance(60_000)).toContainEqual({ type: "abort-fetch" });
    expect(page.view).toEqual({
      loading: false,
      panel: { kind: "activation", phase: "delayed" },
    });
    expect(page.answer(results(), 1)).toEqual([]);

    page.paywall({ type: "retry-clicked" });
    expect(page.fetches()).toHaveLength(2);
    expect(page.type("industrial pumps")).toContainEqual({
      type: "abort-fetch",
    });
    page.advance(60_000);
    expect(page.fetches()).toHaveLength(2);
    expect(page.browser.stored.activation).toBeNull();
  });

  const phases = {
    "the first check": (page: Classifier) => page.mount(),
    "the wait for a retry": (page: Classifier) => {
      page.mount();
      page.answer(BUSY);
    },
    "a retry": (page: Classifier) => {
      page.mount();
      page.answer(BUSY);
      page.advance(2_000);
    },
  };
  const edits = {
    "a text edit": (page: Classifier) => page.type("updated coffee"),
    "a version change": (page: Classifier) => {
      page.browser.fields = form("industrial pump", { version: "v2" });
      return page.send({ type: "edited", field: "version" });
    },
  };
  describe.each(Object.entries(phases))("during %s", (_phase, reach) => {
    it.each(Object.entries(edits))(
      "shows manual retry after cancelling recovery with %s",
      (_edit, edit) => {
        const page = returnPage();
        reach(page);
        const inFlight = page.view.loading;
        expect(page.view.panel).toEqual({
          kind: "activation",
          phase: "checking",
        });

        const stopped = edit(page);
        expect(stopped.some((command) => command.type === "abort-fetch")).toBe(
          inFlight,
        );
        expect(page.view).toEqual({
          loading: false,
          panel: { kind: "activation", phase: "stopped" },
        });
        expect(page.browser.stored.activation).toBeNull();
        expect(page.pendingTimers()).toEqual([]);

        const checks = page.fetches().length;
        page.advance(60_000);
        expect(page.fetches()).toHaveLength(checks);
        page.paywall({ type: "retry-clicked" });
        expect(page.fetches()).toHaveLength(checks + 1);
      },
    );
  });

  it("stops the activation when the visitor submits", () => {
    const page = returnPage();
    page.mount();
    page.answer(BUSY);
    page.submit();
    expect(page.browser.stored.activation).toBeNull();
    expect(page.pendingTimers()).toEqual([]);
    expect(page.lastFetch().seq).toBe(2);
  });

  it("stops the activation when the visitor signs out", () => {
    const page = returnPage();
    page.mount();
    page.answer(BUSY);
    page.setAuth(SIGNED_OUT);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "stopped" });
    expect(page.browser.stored.activation).toBeNull();
  });

  it("shows the stopped notice over a refused lookup until the next answer", () => {
    const page = returnPage();
    page.mount();
    page.answer(paywall("/NAICS/industrial_pump/", true));
    page.type("industrial pumps");
    expect(page.view.panel).toMatchObject({
      kind: "paywall",
      activationStopped: true,
    });

    page.submit();
    page.answer(paywall("/NAICS/industrial_pumps/", true));
    expect(page.view.panel).toMatchObject({
      kind: "paywall",
      activationStopped: false,
    });
  });

  it("shows the stopped notice, not the stored results a resumed activation covered", () => {
    const page = new Classifier(
      { autoload: true },
      {
        url: `${ORIGIN}/NAICS/industrial_pump/`,
        fields: form("industrial pump"),
        auth: signedIn(),
      },
    );
    page.mount();
    page.answer(results());
    page.browser.stored = {
      upgradeIntent: null,
      activation: { returnUrl: RETURN_PAGE, deadline: T0 + 60_000 },
    };
    page.send({
      type: "history-popped",
      entry: {
        v: 1,
        fields: form("industrial pump"),
        fallbackQuery: null,
        title: "NAICS codes for 'Industrial Pump'",
        show: results(),
      },
    });
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });

    page.type("industrial pumps");
    expect(page.view.panel).toEqual({ kind: "activation", phase: "stopped" });
  });

  it("keeps checking when a blank submit on the base page only reports the empty textarea", () => {
    const page = new Classifier(
      { example: "Industrial pump" },
      {
        url: `${ORIGIN}/NAICS/?checkout=success`,
        fields: form(""),
        auth: signedIn(),
      },
    );
    page.mount();
    page.answer(BUSY);
    expect(page.submit()).toEqual([{ type: "report-empty-query" }]);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });
    page.advance(2_000);
    expect(page.fetches()).toHaveLength(2);
  });

  it("ignores a stale answer while observing the first check", () => {
    const page = returnPage();
    page.mount();
    expect(page.answer(results(), 0)).toEqual([]);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });
    page.answer(BUSY);
    page.advance(2_000);
    expect(page.fetches()).toHaveLength(2);
  });

  it("retires the activation on Back/Forward to another route and ignores its late answer", () => {
    const page = returnPage();
    page.mount();
    page.answer(BUSY);
    page.advance(2_000);
    page.browser.url = `${ORIGIN}/NAICS/other/`;
    const popped = page.send({ type: "history-popped", entry: lookup() });
    expect(popped).toContainEqual({
      type: "store",
      patch: { activation: null },
    });
    expect(page.lastFetch()).toEqual({
      type: "fetch",
      seq: 3,
      query: query("other"),
    });
    expect(page.answer(results(), 2)).toEqual([]);
    page.advance(60_000);
    expect(page.fetches()).toHaveLength(3);
  });

  it("preserves the absolute recovery deadline across a page return", () => {
    const page = returnPage({
      now: T0 + 40_000,
      stored: {
        upgradeIntent: null,
        activation: { returnUrl: RETURN_PAGE, deadline: T0 + 60_000 },
      },
    });
    expect(ofType(page.mount(), "set-timer")).toEqual([
      { type: "set-timer", timer: "activation-deadline", ms: 20_000 },
    ]);
    page.answer(BUSY);
    page.advance(2_000);
    page.answer(BUSY);
    page.advance(18_000);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "delayed" });
    const checks = page.fetches().length;
    page.advance(60_000);
    expect(page.fetches()).toHaveLength(checks);
  });

  it("starts delayed when the stored deadline has already passed", () => {
    const page = returnPage({
      now: T0 + 61_000,
      stored: {
        upgradeIntent: null,
        activation: { returnUrl: RETURN_PAGE, deadline: T0 + 60_000 },
      },
    });
    page.mount();
    expect(page.view.panel).toEqual({ kind: "activation", phase: "delayed" });
  });

  it("resumes a stored activation on its route, whatever the parameter order and checkout parameters", () => {
    const page = new Classifier(
      { autoload: true },
      {
        url: `${ORIGIN}/NAICS/pump/?top_k=30&version=v2`,
        fields: form("pump", { topK: 30, version: "v2" }),
        auth: signedIn(),
        stored: {
          upgradeIntent: null,
          activation: {
            returnUrl: `${ORIGIN}/NAICS/pump/?version=v2&checkout=success&top_k=30`,
            deadline: T0 + 30_000,
          },
        },
      },
    );
    expect(ofType(page.mount(), "set-timer")).toEqual([
      { type: "set-timer", timer: "activation-deadline", ms: 30_000 },
    ]);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });
  });

  it("discards a stored activation for another route", () => {
    const page = new Classifier(
      {},
      {
        url: `${ORIGIN}/NAICS/pump/`,
        auth: signedIn(),
        stored: {
          upgradeIntent: null,
          activation: { returnUrl: RETURN_PAGE, deadline: T0 + 30_000 },
        },
      },
    );
    expect(page.mount()).toContainEqual({
      type: "store",
      patch: { activation: null },
    });
    expect(page.view.panel).toEqual({ kind: "page" });
  });

  it("changes neither the URL nor the stored record when a check answers with a canonical page", () => {
    const page = returnPage();
    page.mount();
    const answered = [
      ...page.answer(paywall("/NAICS/industrial_pump/", true)),
      ...page.advance(2_000),
      ...page.answer(paywall("https://other.example/NAICS/pump/", true)),
    ];
    expect(
      answered.filter(
        ({ type }) =>
          type === "push-entry" ||
          type === "replace-entry" ||
          type === "set-title",
      ),
    ).toEqual([]);
    expect(page.browser.url).toBe(RETURN_PAGE);
    expect(page.browser.stored.activation).toEqual({
      returnUrl: RETURN_PAGE,
      deadline: T0 + 60_000,
    });
  });

  it("resumes one immediate serialized lookup on a persisted return to the retained form", () => {
    const page = returnPage();
    page.mount();
    page.answer(BUSY);
    page.send({ type: "page-hidden" });
    expect(page.pendingTimers()).toEqual([]);
    page.advance(10_000);

    const shown = page.send({ type: "page-shown", persisted: true });
    expect(ofType(shown, "fetch")).toHaveLength(1);
    expect(ofType(shown, "set-timer")).toEqual([
      { type: "set-timer", timer: "activation-deadline", ms: 50_000 },
    ]);
    expect(page.browser.stored.activation).toEqual({
      returnUrl: RETURN_PAGE,
      deadline: T0 + 60_000,
    });

    page.send({ type: "page-shown", persisted: true });
    page.advance(2_000);
    expect(page.fetches()).toHaveLength(2);
    page.answer(BUSY);
    page.advance(2_000);
    expect(page.fetches()).toHaveLength(3);
  });

  it("reruns a check that pagehide interrupted once, as the activation's own", () => {
    const page = returnPage();
    page.mount();
    expect(page.send({ type: "page-hidden" })).toContainEqual({
      type: "abort-fetch",
    });
    page.send({ type: "page-shown", persisted: true });
    expect(page.fetches()).toHaveLength(2);
    expect(page.view.panel).toEqual({ kind: "activation", phase: "checking" });
  });

  it("leaves a fresh pageshow to the classifier's initial autoload", () => {
    const page = returnPage({ auth: PENDING });
    page.mount();
    expect(page.send({ type: "page-shown", persisted: false })).toEqual([]);
    page.setAuth(signedIn());
    expect(page.fetches()).toHaveLength(1);
    page.answer(BUSY);
    page.advance(2_000);
    expect(page.fetches()).toHaveLength(2);
  });
});

describe("paywall retries after the default example clears", () => {
  /** The base page autoloaded its example into a paywall; Top-K is now 30. */
  function clearedExample(): Classifier {
    const page = new Classifier(
      { autoload: true, example: "Industrial pump" },
      { url: `${ORIGIN}/NAICS/`, fields: form(""), auth: SIGNED_OUT },
    );
    page.mount();
    page.answer(paywall());
    page.browser.fields = form("", { topK: 30 });
    return page;
  }

  const retryCallers = {
    "Try again": (page: Classifier) => {
      page.paywall({ type: "retry-clicked" });
    },
    "Sign In": (page: Classifier) => {
      page.paywall({ type: "sign-in-clicked" });
      page.setAuth(signedIn());
    },
  };

  it.each(Object.entries(retryCallers))(
    "%s requests the remembered query and current Top-K without filling the textarea",
    (_caller, retry) => {
      const page = clearedExample();
      retry(page);
      expect(page.lastFetch()).toEqual({
        type: "fetch",
        seq: 2,
        query: query("Industrial pump", { topK: 30 }),
      });
      expect(ofType(page.log, "write-fields")).toEqual([]);
      expect(ofType(page.log, "report-empty-query")).toEqual([]);
    },
  );

  it.each(Object.entries(retryCallers))(
    "%s retries the restored entry and its remembered query after Back/Forward",
    (_caller, retry) => {
      const page = clearedExample();
      page.send({
        type: "history-popped",
        entry: {
          v: 1,
          fields: form("", { topK: 30 }),
          fallbackQuery: "Restored pump",
          title: "NAICS Classification",
          show: { kind: "lookup" },
        },
      });
      expect(page.lastFetch().query).toEqual(
        query("Restored pump", { topK: 30 }),
      );
      page.answer(paywall());
      retry(page);
      expect(page.fetches().map(({ query }) => query)).toEqual([
        query("Industrial pump"),
        query("Restored pump", { topK: 30 }),
        query("Restored pump", { topK: 30 }),
      ]);
    },
  );

  it("waits for auth readiness before sending a retry", () => {
    const page = clearedExample();
    page.browser.auth = PENDING;
    page.paywall({ type: "retry-clicked" });
    expect(page.fetches()).toHaveLength(1);
    expect(page.view.loading).toBe(true);

    page.setAuth(SIGNED_OUT);
    expect(page.lastFetch().query).toEqual(
      query("Industrial pump", { topK: 30 }),
    );
  });

  const pendingLookups = {
    "manual submission": (page: Classifier) => {
      page.type("Manual pump");
      page.submit();
    },
    "remembered retry": (page: Classifier) => {
      page.paywall({ type: "retry-clicked" });
    },
  };
  it.each(Object.entries(pendingLookups))(
    "clears loading when a pending %s becomes empty before auth readiness",
    (_caller, start) => {
      const page = clearedExample();
      page.browser.auth = PENDING;
      start(page);
      expect(page.view.loading).toBe(true);

      page.type("");
      expect(page.setAuth(SIGNED_OUT)).toContainEqual({
        type: "report-empty-query",
      });
      expect(page.fetches()).toHaveLength(1);
      expect(page.view.loading).toBe(false);
    },
  );

  it("replays the current valid query after editing while auth readiness is pending", () => {
    const page = clearedExample();
    page.type("Manual pump");
    page.browser.auth = PENDING;
    page.submit();
    page.type("Edited pump");
    page.setAuth(SIGNED_OUT);
    expect(page.lastFetch().query).toEqual(query("Edited pump", { topK: 30 }));
    expect(ofType(page.log, "report-empty-query")).toEqual([]);
  });

  it("cancels a pending retry when Back/Forward restores stored results before auth readiness", () => {
    const page = clearedExample();
    page.browser.auth = PENDING;
    page.paywall({ type: "retry-clicked" });
    page.send({
      type: "history-popped",
      entry: {
        v: 1,
        fields: form("pump"),
        fallbackQuery: null,
        title: "NAICS codes for 'Pump'",
        show: results("/NAICS/pump/"),
      },
    });
    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toHaveLength(1);
    expect(page.view.loading).toBe(false);
  });

  it("native validation still blocks an empty manual submit despite the remembered example", () => {
    const page = clearedExample();
    expect(page.submit()).toEqual([{ type: "report-empty-query" }]);
    expect(page.fetches()).toHaveLength(1);
  });

  it.each(Object.entries(retryCallers))(
    "%s cannot resurrect the example after genuine empty input",
    (_caller, retry) => {
      const page = clearedExample();
      page.type("");
      retry(page);
      expect(page.fetches()).toHaveLength(1);
      expect(ofType(page.log, "report-empty-query")).toHaveLength(1);
    },
  );
});
