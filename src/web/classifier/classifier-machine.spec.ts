import {
  BUSY,
  Classifier,
  NETWORK_ERROR,
  ORIGIN,
  PENDING,
  SIGNED_OUT,
  UNAVAILABLE,
  form,
  ofType,
  paywall,
  results,
  signedIn,
} from "../../../test/support/classifier-driver.js";
import type { AuthSnapshot } from "../islands/services.js";
import type { ResultsQuery } from "../results-api.js";
import type { ClassifierCommand } from "./classifier-machine.js";
import type { FormFields, HistoryEntry } from "./lookup.js";

const DEEP_LINK = `${ORIGIN}/NAICS/industrial_pump/`;
const DEEP_LINK_TITLE = "NAICS codes for 'Industrial Pump'";
const BASE_TITLE = "NAICS Classification";

function query(text: string, fields: Partial<ResultsQuery> = {}): ResultsQuery {
  return { query: text, version: "v1", topK: 10, enhance: false, ...fields };
}

function deepLink(auth: AuthSnapshot): Classifier {
  return new Classifier(
    { autoload: true, title: DEEP_LINK_TITLE },
    { url: DEEP_LINK, fields: form("industrial pump"), auth },
  );
}

function basePage(auth: AuthSnapshot, autoload = false): Classifier {
  return new Classifier(
    { autoload, example: "Industrial pump", title: BASE_TITLE },
    { url: `${ORIGIN}/NAICS/`, fields: form(""), auth },
  );
}

function entry(
  fields: FormFields,
  show: HistoryEntry["show"],
  title = BASE_TITLE,
  fallbackQuery: string | null = null,
): HistoryEntry {
  return { v: 1, fields, fallbackQuery, title, show };
}

function historyCommands(commands: readonly ClassifierCommand[]) {
  return commands.filter(
    (command) =>
      command.type === "push-entry" ||
      command.type === "replace-entry" ||
      command.type === "set-title",
  );
}

describe("classifier machine: the request slot", () => {
  it("renders the server's panel, with no spinner, until mounted", () => {
    expect(deepLink(SIGNED_OUT).view).toEqual({
      loading: false,
      panel: { kind: "page" },
    });
  });

  it("autoloads auth-gated initial results when auth is already ready", () => {
    const page = deepLink(SIGNED_OUT);
    expect(page.mount()).toEqual([
      {
        type: "replace-entry",
        url: null,
        entry: entry(
          form("industrial pump"),
          { kind: "lookup" },
          DEEP_LINK_TITLE,
        ),
      },
      { type: "fetch", seq: 1, query: query("industrial pump") },
    ]);
    expect(page.view.loading).toBe(true);
  });

  it("waits for authReady before autoloading auth-gated initial results", () => {
    const page = deepLink(PENDING);
    page.mount();
    expect(page.setAuth(PENDING)).toEqual([]);
    expect(page.fetches()).toEqual([]);

    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toEqual([
      { type: "fetch", seq: 1, query: query("industrial pump") },
    ]);
  });

  it("shows the loading indicator while waiting for authReady", () => {
    const page = deepLink(PENDING);
    page.mount();
    expect(page.view).toEqual({ loading: true, panel: { kind: "page" } });
  });

  it("autoloads auth-gated initial results after a delayed authReady fallback signal", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.setAuth(UNAVAILABLE);
    expect(page.fetches()).toHaveLength(1);
  });

  it("deep-link autoload only submits once even if authReady fires again later", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.setAuth(SIGNED_OUT);
    page.answer(results());
    page.setAuth(signedIn());
    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toHaveLength(1);
  });

  it("keeps the deep-link query in the textarea during auth-gated autoload", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.setAuth(SIGNED_OUT);
    page.answer(results());
    expect(ofType(page.log, "write-fields")).toEqual([]);
  });

  it("cancels pending autoload when the user edits the textarea before authReady", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.type("edited query");
    expect(page.view.loading).toBe(false);
    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toEqual([]);
  });

  it("cancels the autoload when the visitor typed before hydration", () => {
    const page = deepLink(SIGNED_OUT);
    page.type("my own query");
    page.mount();
    expect(page.fetches()).toEqual([]);
    expect(page.view.loading).toBe(false);
  });

  it("sends a version change made while the autoload waits for auth", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.browser.fields = form("industrial pump", { version: "v2" });
    page.send({ type: "edited", field: "version" });
    page.setAuth(SIGNED_OUT);
    expect(page.lastFetch().query).toEqual(
      query("industrial pump", { version: "v2" }),
    );
  });

  it("cancels auth-gated autoload when a manual results request starts before authReady", () => {
    const page = deepLink(PENDING);
    page.mount();
    page.submit();
    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toHaveLength(1);
    expect(historyCommands(page.answer(results()))).toEqual([
      {
        type: "replace-entry",
        url: "/NAICS/industrial_pump/",
        entry: entry(form("industrial pump"), results(), DEEP_LINK_TITLE),
      },
    ]);
  });

  it("waits for auth before autoloading the base example query", () => {
    const page = basePage(PENDING, true);
    page.mount();
    expect(page.fetches()).toEqual([]);
    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toEqual([
      { type: "fetch", seq: 1, query: query("Industrial pump") },
    ]);
    expect(ofType(page.log, "report-empty-query")).toEqual([]);
    expect(ofType(page.log, "write-fields")).toEqual([]);
  });

  it("waits for auth readiness before sending a manual form submission", () => {
    const page = basePage(PENDING);
    page.mount();
    page.type("industrial pump");
    page.submit();
    page.submit();
    expect(page.fetches()).toEqual([]);
    expect(page.view.loading).toBe(true);

    page.setAuth(SIGNED_OUT);
    expect(page.fetches()).toEqual([
      { type: "fetch", seq: 1, query: query("industrial pump") },
    ]);
  });

  it("shows and hides the loading indicator across request events", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("industrial pump");
    page.submit();
    expect(page.view.loading).toBe(true);
    page.answer(results());
    expect(page.view.loading).toBe(false);
  });

  it("drops an answer that a newer lookup replaced", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.submit();
    page.type("valve");
    page.submit();
    expect(page.fetches().map(({ seq }) => seq)).toEqual([1, 2]);

    expect(page.answer(results("/NAICS/pump/"), 1)).toEqual([]);
    expect(page.view).toEqual({ loading: true, panel: { kind: "page" } });

    page.answer(results("/NAICS/valve/"), 2);
    expect(page.view.panel).toEqual({
      kind: "results",
      key: 2,
      answer: results("/NAICS/valve/"),
    });
  });

  it.each([
    [
      "paywall",
      paywall(),
      {
        kind: "paywall",
        signedIn: false,
        limit: 10,
        upgrade: "ready",
        activationStopped: false,
      },
    ],
    ["busy", BUSY, BUSY],
    ["error", NETWORK_ERROR, NETWORK_ERROR],
    ["results", results(), { kind: "results", key: 1, answer: results() }],
  ] as const)("shows a %s answer in the panel", (_kind, answer, panel) => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("industrial pump");
    page.submit();
    page.answer(answer);
    expect(page.view).toEqual({ loading: false, panel });
  });
});

describe("classifier machine: the form", () => {
  it("auto-submits on top-k change only when textarea has content", () => {
    const page = new Classifier({}, { auth: SIGNED_OUT });
    page.mount();
    page.browser.fields = form("", { topK: 30 });
    expect(page.send({ type: "top-k-changed" })).toEqual([]);

    page.browser.fields = form("industrial pump", { topK: 30 });
    page.send({ type: "top-k-changed" });
    expect(page.fetches()).toEqual([
      { type: "fetch", seq: 1, query: query("industrial pump", { topK: 30 }) },
    ]);
  });

  it("keeps the default example query active for top-k changes after timer clear", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.browser.fields = form("", { topK: 30 });
    page.send({ type: "top-k-changed" });
    expect(page.lastFetch().query).toEqual(
      query("Industrial pump", { topK: 30 }),
    );
  });

  it("replaces the stored default example query after real user input", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("custom typed query");
    page.submit();
    expect(page.lastFetch().query).toEqual(query("custom typed query"));
  });

  it("drops the hidden fallback query after the user clears the textarea", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("");
    expect(page.send({ type: "top-k-changed" })).toEqual([]);
    expect(page.fetches()).toEqual([]);
  });

  it("does not create a hidden fallback query for deep-link prefills", () => {
    const page = deepLink(SIGNED_OUT);
    page.mount();
    page.answer(results());
    page.browser.fields = form("");
    page.send({ type: "top-k-changed" });
    expect(page.fetches()).toHaveLength(1);
  });

  it("native validation still blocks an empty manual submit despite the remembered example", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    expect(page.submit()).toEqual([{ type: "report-empty-query" }]);
    expect(page.view.loading).toBe(false);
  });

  it("sends the beta flag only while enabled and snapshots switch state for history", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.browser.fields = form("pump", { enhance: true });
    page.submit();
    expect(page.lastFetch().query.enhance).toBe(true);
    const [push] = ofType(
      page.answer(results("/NAICS/pump/?enhance_query=1")),
      "push-entry",
    );
    expect(push?.entry.fields.enhance).toBe(true);

    page.browser.fields = form("pump");
    page.submit();
    expect(page.lastFetch().query.enhance).toBe(false);
  });
});

describe("classifier machine: history", () => {
  it("pushes a manual answer's page and title, and replaces the entry already at that URL", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.browser.fields = form("pump", { topK: 30 });
    page.submit();
    const pump = results("/NAICS/pump/?top_k=30", "NAICS codes for 'Pump'");
    expect(page.answer(pump)).toEqual([
      {
        type: "push-entry",
        url: "/NAICS/pump/?top_k=30",
        entry: entry(
          form("pump", { topK: 30 }),
          pump,
          "NAICS codes for 'Pump'",
        ),
      },
    ]);
    expect(page.browser.url).toBe(`${ORIGIN}/NAICS/pump/?top_k=30`);

    page.submit();
    expect(ofType(page.answer(pump), "replace-entry")).toEqual([
      {
        type: "replace-entry",
        url: "/NAICS/pump/?top_k=30",
        entry: entry(
          form("pump", { topK: 30 }),
          pump,
          "NAICS codes for 'Pump'",
        ),
      },
    ]);
  });

  it("pushes a paywall's query page for a refetch, and leaves history alone for busy and error answers", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.submit();
    expect(page.answer(paywall("/NAICS/pump/"))).toEqual([
      {
        type: "push-entry",
        url: "/NAICS/pump/",
        entry: entry(form("pump"), { kind: "lookup" }, DEEP_LINK_TITLE),
      },
    ]);

    page.submit();
    expect(page.answer(BUSY)).toEqual([]);
    page.submit();
    expect(page.answer(NETWORK_ERROR)).toEqual([]);
  });

  it("suppresses deep-link autoload history pushes without changing the request URL", () => {
    const page = deepLink(SIGNED_OUT);
    page.mount();
    expect(historyCommands(page.answer(paywall()))).toEqual([]);
    expect(page.browser.url).toBe(DEEP_LINK);
  });

  it("keeps an autoload's results in the current entry without changing its URL or title", () => {
    const page = deepLink(SIGNED_OUT);
    page.mount();
    expect(page.answer(results())).toEqual([
      {
        type: "replace-entry",
        url: null,
        entry: entry(form("industrial pump"), results(), DEEP_LINK_TITLE),
      },
    ]);
  });

  it("suppresses history changes for base example autoload", () => {
    const page = basePage(SIGNED_OUT, true);
    page.mount();
    expect(page.answer(results())).toEqual([
      {
        type: "replace-entry",
        url: null,
        entry: entry(form(""), results(), BASE_TITLE, "Industrial pump"),
      },
    ]);
    expect(page.browser.url).toBe(`${ORIGIN}/NAICS/`);
  });

  it("pushes the page of a manual lookup that follows the autoload", () => {
    const page = deepLink(SIGNED_OUT);
    page.mount();
    page.answer(paywall());
    page.type("steel bolts");
    page.submit();
    const bolts = results(
      "/NAICS/steel_bolts/",
      "NAICS codes for 'Steel Bolts'",
    );
    expect(page.answer(bolts)).toEqual([
      {
        type: "push-entry",
        url: "/NAICS/steel_bolts/",
        entry: entry(
          form("steel bolts"),
          bolts,
          "NAICS codes for 'Steel Bolts'",
        ),
      },
    ]);
  });

  it("preserves history metadata for the hidden active query without repopulating the textarea", () => {
    const page = basePage(SIGNED_OUT);
    const [first] = ofType(page.mount(), "replace-entry");
    expect(first?.entry).toEqual(
      entry(form(""), { kind: "page" }, BASE_TITLE, "Industrial pump"),
    );

    page.browser.fields = form("", { topK: 30 });
    page.send({ type: "top-k-changed" });
    const [push] = ofType(page.answer(results()), "push-entry");
    expect(push?.entry).toEqual(
      entry(
        form("", { topK: 30 }),
        results(),
        DEEP_LINK_TITLE,
        "Industrial pump",
      ),
    );
    expect(ofType(page.log, "write-fields")).toEqual([]);
  });

  it("restores the beta switch, with the rest of the form, on browser navigation", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    const pump = entry(
      form("pump", { enhance: true }),
      results("/NAICS/pump/?enhance_query=1"),
      "NAICS codes for 'Pump'",
    );
    expect(page.send({ type: "history-popped", entry: pump })).toEqual([
      { type: "write-fields", fields: form("pump", { enhance: true }) },
      { type: "set-title", title: "NAICS codes for 'Pump'" },
    ]);
  });

  it("restores beta requests on Back/Forward without losing Forward history", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    const pump = entry(
      form("pump", { enhance: true }),
      { kind: "lookup" },
      "NAICS codes for 'Pump'",
    );
    page.send({ type: "history-popped", entry: pump });
    expect(page.lastFetch().query).toEqual(query("pump", { enhance: true }));
    expect(page.answer(paywall("/NAICS/pump/?enhance_query=1"))).toEqual([]);

    page.browser.fields = form("pump");
    page.submit();
    expect(page.lastFetch().query.enhance).toBe(false);
  });

  it("replays score bar animation during history restore", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.submit();
    page.answer(results("/NAICS/pump/"));
    expect(page.view.panel).toMatchObject({ kind: "results", key: 1 });

    const valve = results("/NAICS/valve/", "NAICS codes for 'Valve'");
    page.send({
      type: "history-popped",
      entry: entry(form("valve"), valve, valve.title),
    });
    expect(page.view).toEqual({
      loading: false,
      panel: { kind: "results", key: 2, answer: valve },
    });
    expect(page.fetches()).toHaveLength(1);
  });

  it("does not retrigger autoload during history restore", () => {
    const page = deepLink(SIGNED_OUT);
    page.mount();
    const [first] = ofType(page.answer(results()), "replace-entry");
    page.type("valve");
    page.submit();
    page.answer(results("/NAICS/valve/"));

    if (first === undefined) throw new Error("no first entry");
    page.send({ type: "history-popped", entry: first.entry });
    expect(page.fetches()).toHaveLength(2);
    expect(page.view.panel).toMatchObject({ answer: results() });
  });

  it("refetches an entry whose answer was not stored, reading the entry rather than the stale form", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("valve");
    page.send({
      type: "history-popped",
      entry: entry(form("pump", { topK: 30 }), { kind: "lookup" }),
    });
    expect(page.lastFetch().query).toEqual(query("pump", { topK: 30 }));
    expect(historyCommands(page.answer(paywall("/NAICS/pump/")))).toEqual([]);
  });

  it("shows the server's panel again for the first entry and abandons the lookup in flight", () => {
    const page = basePage(SIGNED_OUT);
    const [first] = ofType(page.mount(), "replace-entry");
    page.type("pump");
    page.submit();

    if (first === undefined) throw new Error("no first entry");
    const popped = page.send({ type: "history-popped", entry: first.entry });
    expect(popped).toContainEqual({ type: "abort-fetch" });
    expect(page.view).toEqual({ loading: false, panel: { kind: "page" } });
    expect(page.answer(results(), 1)).toEqual([]);
  });

  it("ignores a popped entry that is not the classifier's", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.submit();
    expect(page.send({ type: "history-popped", entry: null })).toEqual([]);
    expect(page.view.loading).toBe(true);
  });
});

describe("classifier machine: bfcache", () => {
  it("aborts the lookup in flight on pagehide and reruns it on a persisted pageshow", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    page.type("pump");
    page.submit();
    expect(page.send({ type: "page-hidden" })).toEqual([
      { type: "abort-fetch" },
    ]);
    expect(page.view.loading).toBe(false);

    expect(page.send({ type: "page-shown", persisted: true })).toEqual([
      { type: "fetch", seq: 2, query: query("pump") },
    ]);
    expect(
      ofType(page.answer(results("/NAICS/pump/")), "push-entry"),
    ).toHaveLength(1);
  });

  it("leaves an idle page alone across pagehide and pageshow", () => {
    const page = basePage(SIGNED_OUT);
    page.mount();
    expect(page.send({ type: "page-hidden" })).toEqual([]);
    expect(page.send({ type: "page-shown", persisted: true })).toEqual([]);
    expect(page.send({ type: "page-shown", persisted: false })).toEqual([]);
  });
});
