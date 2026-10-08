import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { nativeRequestSubmit } from "./test/setup";

type ConfiguredRequest = {
  source: Element;
  query: FormDataEntryValue | null;
  topK: FormDataEntryValue | null;
};

type RetryCaller = "Try again" | "Sign In";
const retryCallers: RetryCaller[] = ["Try again", "Sign In"];
const requests: ConfiguredRequest[] = [];
const errors: string[] = [];
const invalidTargets: EventTarget[] = [];
const nativeXPathEvaluate = XPathExpression.prototype.evaluate;
let vendoredHtmx: HtmxInstance | undefined;

function recordRequest(event: HtmxConfigRequestEvent): void {
  const { sourceElement, request } = event.detail.ctx;
  requests.push({
    source: sourceElement,
    query: request.body.get("product_description"),
    topK: request.body.get("top_k"),
  });
  event.preventDefault();
}

function recordError(event: ErrorEvent): void {
  errors.push(event.message);
  event.preventDefault();
}

function recordInvalid(event: Event): void {
  if (event.target) invalidTargets.push(event.target);
}

function classifierForm(): HTMLFormElement {
  const form = document.getElementById("classifier-form");
  if (!(form instanceof HTMLFormElement))
    throw new Error("Missing classifier form");
  return form;
}

function textarea(): HTMLTextAreaElement {
  const area = document.getElementById("product_description_area");
  if (!(area instanceof HTMLTextAreaElement))
    throw new Error("Missing textarea");
  return area;
}

function clickButton(id: string): void {
  const button = document.getElementById(id);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing ${id}`);
  button.click();
}

function signIn(): void {
  clickButton("signin-button");
  const clerk = window.Clerk;
  if (!clerk) throw new Error("Missing Clerk");
  clerk.user = { id: "user_123" };
  clerk.session = { getToken: vi.fn(async () => "token") };
  for (const [listener] of vi.mocked(clerk.addListener).mock.calls) {
    listener({ user: clerk.user, session: clerk.session });
  }
}

function retry(caller: RetryCaller): void {
  if (caller === "Try again") clickButton("retry-button");
  else signIn();
}

function expectRetryRequest(form: HTMLFormElement, query: string): void {
  expect(requests.map(({ query, topK }) => ({ query, topK }))).toEqual([
    { query, topK: "5" },
  ]);
  expect(requests[0]?.source).toBe(form);
}

async function restoreClassifierForm(
  autoloadEnabled = true,
): Promise<HTMLFormElement> {
  document.dispatchEvent(new CustomEvent("htmx:before:history:update"));
  document.body.innerHTML = document.body.innerHTML;
  const form = classifierForm();
  form.dataset["autoloadEnabled"] = String(autoloadEnabled);
  textarea().value = "Restored pump";
  textarea().defaultValue = "Restored pump";
  const ctx: HtmxRequestContext = {
    sourceElement: document.body,
    target: document.body,
    request: {
      action: "/NAICS/",
      method: "GET",
      headers: { "HX-History-Restore-Request": "true" },
      body: null,
    },
  };
  document.body.dispatchEvent(
    new CustomEvent("htmx:after:swap", { bubbles: true, detail: { ctx } }),
  );
  window.htmx?.process(form);
  await vi.advanceTimersByTimeAsync(100);
  expect(textarea().value).toBe("");
  return form;
}

async function initializeClearedExample(): Promise<HTMLFormElement> {
  const form = classifierForm();
  window.htmx?.process(form);
  await import("./classifier");
  const { initPaywall } = await import("./paywall");
  initPaywall();
  await vi.advanceTimersByTimeAsync(100);

  expect(requests).toEqual([
    { source: form, query: "Industrial pump", topK: null },
  ]);
  expect(textarea().value).toBe("");
  const topK = document.getElementById("show_top_k_categories");
  if (!(topK instanceof HTMLSelectElement))
    throw new Error("Missing Top-K selector");
  topK.value = "5";
  requests.length = 0;
  return form;
}

describe("paywall retries after the default example clears", () => {
  beforeAll(() => {
    // jsdom requires the optional XPath result type that browsers default to ANY_TYPE.
    XPathExpression.prototype.evaluate = function (
      contextNode,
      type = XPathResult.ANY_TYPE,
      result = null,
    ) {
      return nativeXPathEvaluate.call(this, contextNode, type, result);
    };
    const config = document.createElement("meta");
    config.name = "htmx-config";
    config.content = '{"includeIndicatorCSS":false}';
    document.head.append(config);
    window.eval(readFileSync("app/static/htmx.min.js", "utf8"));
    config.remove();
    vendoredHtmx = window.htmx;
    if (!vendoredHtmx) throw new Error("Vendored HTMX did not load");
  });

  afterAll(() => {
    XPathExpression.prototype.evaluate = nativeXPathEvaluate;
  });

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("CSS", {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
    });
    if (!vendoredHtmx) throw new Error("Missing vendored HTMX");
    window.htmx = vendoredHtmx;
    Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
      configurable: true,
      writable: true,
      value: nativeRequestSubmit,
    });
    window.__authReady = true;
    window.history.replaceState({}, "", "/NAICS/");
    sessionStorage.clear();
    document.body.replaceWith(document.createElement("body"));
    document.body.dataset["authUi"] = "disabled";
    document.body.innerHTML = `
      <form id="classifier-form" hx-get="/NAICS/fragment" hx-target="#results-container"
        hx-sync="this:replace" data-default-example-prefill="true"
        data-initial-query-present="false" data-autoload-enabled="true"
        data-default-top-k="10" data-default-version="v1">
        <textarea id="product_description_area" name="product_description" required>Industrial pump</textarea>
        <select id="show_top_k_categories" name="top_k">
          <option value="5">5</option><option value="10" selected>10</option>
        </select>
        <button id="classify-button" type="submit">Classify</button>
      </form>
      <div id="loading-indicator"></div>
      <section id="results-section"><div id="results-container">
        <div id="paywall-warning"><p>Free trial limit reached</p>
          <div id="paywall-buttons"><button id="signin-button">Sign In</button></div>
          <button id="retry-button">Try again</button>
        </div>
      </div></section>`;
    requests.length = 0;
    errors.length = 0;
    invalidTargets.length = 0;
    document.documentElement.addEventListener(
      "htmx:config:request",
      recordRequest,
    );
    document.addEventListener("invalid", recordInvalid, true);
    window.addEventListener("error", recordError);
  });

  afterEach(() => {
    document.documentElement.removeEventListener(
      "htmx:config:request",
      recordRequest,
    );
    document.removeEventListener("invalid", recordInvalid, true);
    window.removeEventListener("error", recordError);
    window.dispatchEvent(new Event("pagehide"));
    sessionStorage.clear();
    vi.useRealTimers();
    expect(errors).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(retryCallers)(
    "%s requests the remembered query and current Top-K without filling the textarea",
    async (caller) => {
      const form = await initializeClearedExample();
      retry(caller);
      await vi.advanceTimersByTimeAsync(0);

      expectRetryRequest(form, "Industrial pump");
      expect(textarea().value).toBe("");
      expect(form.noValidate).toBe(false);
      expect(invalidTargets).toEqual([]);
    },
  );

  it.each(retryCallers)(
    "%s preserves a preexisting noValidate flag",
    async (caller) => {
      const form = await initializeClearedExample();
      form.noValidate = true;
      retry(caller);
      await vi.advanceTimersByTimeAsync(0);

      expectRetryRequest(form, "Industrial pump");
      expect(textarea().value).toBe("");
      expect(form.noValidate).toBe(true);
      expect(invalidTargets).toEqual([]);
    },
  );

  it.each(retryCallers)(
    "%s retries only the restored form and its remembered query after history replacement",
    async (caller) => {
      const oldForm = await initializeClearedExample();
      const restoredForm = await restoreClassifierForm();
      expect(oldForm.isConnected).toBe(false);
      expectRetryRequest(restoredForm, "Restored pump");
      requests.length = 0;
      retry(caller);
      await vi.advanceTimersByTimeAsync(0);

      expectRetryRequest(restoredForm, "Restored pump");
      expect(textarea().value).toBe("");
      expect(restoredForm.noValidate).toBe(false);
      expect(oldForm.noValidate).toBe(false);
    },
  );

  it("waits for auth readiness before sending a retry", async () => {
    const form = await initializeClearedExample();
    window.__authReady = false;
    retry("Try again");
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([]);
    expect(form.noValidate).toBe(false);

    window.__authReady = true;
    document.body.dispatchEvent(new CustomEvent("htmx:authReady"));
    await vi.advanceTimersByTimeAsync(0);
    expectRetryRequest(form, "Industrial pump");
    expect(form.noValidate).toBe(false);
  });

  it.each(["manual submission", "remembered retry"])(
    "clears loading when a pending %s becomes empty before auth readiness",
    async (caller) => {
      const form = await initializeClearedExample();
      const area = textarea();
      const indicator = document.getElementById("loading-indicator");
      window.__authReady = false;
      if (caller === "manual submission") {
        area.value = "Manual pump";
        area.dispatchEvent(new Event("input", { bubbles: true }));
        clickButton("classify-button");
      } else {
        retry("Try again");
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toEqual([]);
      expect(indicator?.classList.contains("htmx-request")).toBe(true);

      area.value = "";
      area.dispatchEvent(new Event("input", { bubbles: true }));
      window.__authReady = true;
      document.body.dispatchEvent(new CustomEvent("htmx:authReady"));
      await vi.advanceTimersByTimeAsync(0);

      expect(requests).toEqual([]);
      expect(invalidTargets).toEqual([area]);
      expect(form.noValidate).toBe(false);
      expect(indicator?.classList.contains("htmx-request")).toBe(false);
    },
  );

  it("replays the current valid query after editing while auth readiness is pending", async () => {
    const form = await initializeClearedExample();
    const area = textarea();
    area.value = "Manual pump";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    window.__authReady = false;
    clickButton("classify-button");
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([]);

    area.value = "Edited pump";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    window.__authReady = true;
    document.body.dispatchEvent(new CustomEvent("htmx:authReady"));
    await vi.advanceTimersByTimeAsync(0);

    expectRetryRequest(form, "Edited pump");
    expect(area.value).toBe("Edited pump");
    expect(invalidTargets).toEqual([]);
    expect(form.noValidate).toBe(false);
  });

  it("cancels a pending retry when history replaces its form before auth readiness", async () => {
    const oldForm = await initializeClearedExample();
    window.__authReady = false;
    retry("Try again");
    await vi.advanceTimersByTimeAsync(0);
    const restoredForm = await restoreClassifierForm(false);
    expect(oldForm.isConnected).toBe(false);

    window.__authReady = true;
    document.body.dispatchEvent(new CustomEvent("htmx:authReady"));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual([]);
    expect(restoredForm.noValidate).toBe(false);
    expect(oldForm.noValidate).toBe(false);
  });

  it.each(["submit button", "Enter"])(
    "native validation still blocks an empty manual %s despite the remembered example",
    async (caller) => {
      const form = await initializeClearedExample();
      const area = textarea();
      if (caller === "submit button") clickButton("classify-button");
      else {
        area.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      await vi.advanceTimersByTimeAsync(0);

      expect(requests).toEqual([]);
      expect(invalidTargets).toEqual([area]);
      expect(form.noValidate).toBe(false);
    },
  );

  it.each(retryCallers)(
    "%s cannot resurrect the example after genuine empty input",
    async (caller) => {
      const form = await initializeClearedExample();
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
      retry(caller);
      await vi.advanceTimersByTimeAsync(0);

      expect(requests).toEqual([]);
      expect(form.noValidate).toBe(false);
    },
  );
});
