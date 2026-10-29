import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassifierIslandProps } from "../../../../src/web/classifier/classifier-island.js";
import type { AuthSnapshot } from "../../../../src/web/islands/services.js";
import { Island } from "../../../../src/web/islands/render-island.js";
import type {
  ResultsAnswer,
  ResultsResponse,
} from "../../../../src/web/results-api.js";
import { nativeRequestSubmit } from "../test/setup.js";
import {
  click,
  element,
  fakeServices,
  hydrateDocument,
  type FakeServices,
  type ResultsCall,
} from "../test/islands.js";

const SIGNED_OUT: AuthSnapshot = { status: "signed-out" };
const SIGNED_IN: AuthSnapshot = {
  status: "signed-in",
  userId: "user_1",
  sessionUsable: true,
};

function answer(
  query: string,
  codes = ["43211503", "43211507"],
): ResultsAnswer {
  const slug = query.replaceAll(" ", "_");
  return {
    kind: "results",
    version: "UNSPSC v26",
    query,
    url: `/UNSPSC/${slug}/`,
    title: `UNSPSC codes for '${query}'`,
    results: codes.map((originalId, index) => ({
      originalId,
      codeTokens: [...originalId].map((char) => ({ char, gapAfter: false })),
      definition: `Definition ${index}`,
      scoreLabel: `${90 - index * 10}.0`,
      scoreWidth: `${90 - index * 10}.00`,
    })),
    elapsed: "0.42",
  };
}

const PAYWALL: ResultsResponse = {
  kind: "paywall",
  signedIn: false,
  limit: 10,
  url: "/UNSPSC/steel_bolts/",
  title: "UNSPSC codes for 'steel bolts'",
};

const BASE_TITLE = "UNSPSC Code Lookup, Search, Classify, Map | Classifast";

function props(
  overrides: Partial<ClassifierIslandProps> = {},
): ClassifierIslandProps {
  const example = answer("laptop computer");
  return {
    classifierType: "UNSPSC",
    heading: "UNSPSC Classification",
    description: "The United Nations Standard Products and Services Code.",
    logo: {
      src: "https://classifast.test/static/images/unspsc-logo.gif",
      alt: "UNSPSC classification standard logo",
      className: "hidden lg:block",
    },
    resources: null,
    form: {
      versions: ["UNSPSC v26", "UNSPSC v25"],
      version: "UNSPSC v26",
      topK: 10,
      text: "",
      placeholder: "laptop computer",
      enhance: false,
    },
    initial: {
      query: "laptop computer",
      results: example.results,
      elapsed: "0.40",
      loaded: true,
    },
    start: { autoload: false, example: "laptop computer", title: BASE_TITLE },
    ...overrides,
  };
}

/** Answers each lookup when the test says so. */
class Lookups {
  readonly calls: ResultsCall[] = [];
  private readonly pending: ((answer: ResultsResponse) => void)[] = [];

  readonly results = (call: ResultsCall) => {
    this.calls.push(call);
    return new Promise<ResultsResponse>((resolve) =>
      this.pending.push(resolve),
    );
  };

  async answer(reply: ResultsResponse, index = this.pending.length - 1) {
    await act(async () => this.pending[index]!(reply));
  }

  queries() {
    return this.calls.map(({ query }) => query);
  }
}

let services: FakeServices;
let lookups: Lookups;

function serverHtml(island: ClassifierIslandProps): string {
  return renderToStaticMarkup(
    <Island
      name="classifier"
      as="section"
      id="classifier-form-section"
      props={island}
    />,
  );
}

async function hydrate(
  island: ClassifierIslandProps = props(),
  before: () => void = () => {},
): Promise<void> {
  document.body.innerHTML = serverHtml(island);
  before();
  const errors = await hydrateDocument(services);
  expect(errors).toEqual([]);
}

const textarea = () =>
  element<HTMLTextAreaElement>("#product_description_area");
const spinnerActive = () =>
  element("#loading-indicator").hasAttribute("data-active");
const listedCodes = () =>
  [
    ...document.querySelectorAll("#results-container [data-copy-original-id]"),
  ].map((button) => button.getAttribute("data-copy-original-id"));

async function type(text: string): Promise<void> {
  await act(async () => {
    textarea().value = text;
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function keyDown(init: KeyboardEventInit): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    textarea().dispatchEvent(event);
  });
  return event.defaultPrevented;
}

async function submit(): Promise<void> {
  await click(element('#classifier-form button[type="submit"]'));
}

async function selectTopK(value: string): Promise<void> {
  await act(async () => {
    const select = element<HTMLSelectElement>("#show_top_k_categories");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function popState(state: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}

beforeEach(() => {
  Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
    configurable: true,
    writable: true,
    value: nativeRequestSubmit,
  });
  window.history.replaceState(null, "", "/UNSPSC/");
  document.title = BASE_TITLE;
  sessionStorage.clear();
  lookups = new Lookups();
  services = fakeServices({ results: lookups.results });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("classifier island", () => {
  it("hydrates the server markup and labels the description toggle on the server", async () => {
    await hydrate();

    expect(element("#description-toggle").textContent).toBe(
      "Learn more about UNSPSC",
    );
    expect(element<HTMLFormElement>("#classifier-form").noValidate).toBe(true);
    expect(textarea().value).toBe("");
    expect(textarea().placeholder).toBe("laptop computer");
  });

  it("renders no toggle for a classifier without a description", async () => {
    await hydrate(props({ description: "" }));

    expect(document.querySelector("#description-toggle")).toBeNull();
    expect(document.querySelector("#description-content")).toBeNull();
  });

  it("toggles the description and hides the logo while it is open", async () => {
    await hydrate();
    const logo = element<HTMLImageElement>("#classifier-form-section img");

    await click(element("#description-toggle"));
    expect(element("#description-toggle").textContent).toBe("Show less");
    expect(element("#description-toggle").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(element("#description-content").style.display).toBe("block");
    expect(logo.style.display).toBe("none");

    await click(element("#description-toggle"));
    expect(element("#description-toggle").textContent).toBe(
      "Learn more about UNSPSC",
    );
    expect(element("#description-content").style.display).toBe("none");
    expect(logo.style.display).toBe("");
  });

  it("submits on Enter and keeps Shift+Enter as a newline", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel   bolts");

    expect(await keyDown({ key: "Enter", shiftKey: true })).toBe(false);
    expect(lookups.calls).toEqual([]);

    expect(await keyDown({ key: "Enter" })).toBe(true);
    expect(
      lookups.calls.map(({ classifierType, query }) => [classifierType, query]),
    ).toEqual([
      [
        "UNSPSC",
        {
          query: "steel bolts",
          version: "UNSPSC v26",
          topK: 10,
          enhance: false,
        },
      ],
    ]);
    expect(
      element('#classifier-form button[type="submit"]').classList,
    ).toContain("scale-95");
  });

  it("shows the native required message for an empty or blank submit and sends nothing", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    const invalid = vi.fn();
    textarea().addEventListener("invalid", invalid);

    await submit();
    await type("  \n ");
    await submit();

    expect(invalid).toHaveBeenCalledTimes(2);
    expect(textarea().value).toBe("");
    expect(lookups.calls).toEqual([]);
  });

  it("shows the spinner, then the answer's results, and pushes its URL and title", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel bolts");
    await submit();
    expect(spinnerActive()).toBe(true);

    await lookups.answer(answer("steel bolts", ["31161500", "31161501"]));

    expect(spinnerActive()).toBe(false);
    expect(listedCodes()).toEqual(["31161500", "31161501"]);
    expect(location.pathname).toBe("/UNSPSC/steel_bolts/");
    expect(document.title).toBe("UNSPSC codes for 'steel bolts'");
  });

  it("restores the previous results on Back with no request, and Forward's results too", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    const first = window.history.state as unknown;
    await type("steel bolts");
    await submit();
    await lookups.answer(answer("steel bolts", ["31161500"]));
    const second = window.history.state as unknown;

    await popState(first);
    expect(listedCodes()).toEqual(["43211503", "43211507"]);
    expect(document.title).toBe(BASE_TITLE);
    expect(textarea().value).toBe("");

    await popState(second);
    expect(listedCodes()).toEqual(["31161500"]);
    expect(textarea().value).toBe("steel bolts");
    expect(document.title).toBe("UNSPSC codes for 'steel bolts'");
    expect(lookups.calls).toHaveLength(1);
  });

  it("resubmits on a Top-K change, with the base page's example while the textarea is empty", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);

    await selectTopK("30");

    expect(lookups.calls.map(({ query }) => query)).toEqual([
      {
        query: "laptop computer",
        version: "UNSPSC v26",
        topK: 30,
        enhance: false,
      },
    ]);
  });

  it("autoloads a query page once auth settles, without moving the URL or title", async () => {
    window.history.replaceState(null, "", "/UNSPSC/?query=steel+bolts");
    document.title = "UNSPSC codes for 'Steel Bolts'";
    await hydrate(
      props({
        form: { ...props().form, text: "steel bolts" },
        initial: { query: "steel bolts", results: [], loaded: false },
        start: {
          autoload: true,
          example: null,
          title: "UNSPSC codes for 'Steel Bolts'",
        },
      }),
    );
    expect(spinnerActive()).toBe(true);
    expect(lookups.calls).toEqual([]);

    await services.auth.set(SIGNED_OUT);
    await lookups.answer(answer("steel bolts", ["31161500"]));

    expect(lookups.calls).toHaveLength(1);
    expect(listedCodes()).toEqual(["31161500"]);
    expect(`${location.pathname}${location.search}`).toBe(
      "/UNSPSC/?query=steel+bolts",
    );
    expect(document.title).toBe("UNSPSC codes for 'Steel Bolts'");
  });

  it("keeps text typed before hydration and cancels the autoload it replaces", async () => {
    const island = props({
      form: { ...props().form, text: "steel bolts" },
      initial: { query: "steel bolts", results: [], loaded: false },
      start: {
        autoload: true,
        example: null,
        title: "UNSPSC codes for 'Steel Bolts'",
      },
    });
    await hydrate(island, () => {
      textarea().value = "copper wire";
    });
    await services.auth.set(SIGNED_OUT);

    expect(textarea().value).toBe("copper wire");
    expect(lookups.calls).toEqual([]);
    expect(spinnerActive()).toBe(false);
  });

  it("aborts the replaced lookup and ignores its answer", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel bolts");
    await submit();
    await type("copper wire");
    await submit();

    expect(lookups.calls[0]!.signal.aborted).toBe(true);
    await lookups.answer(answer("steel bolts", ["31161500"]), 0);
    expect(spinnerActive()).toBe(true);
    await lookups.answer(answer("copper wire", ["26121600"]), 1);
    expect(listedCodes()).toEqual(["26121600"]);
  });

  it("renders the anonymous paywall; Sign In opens a plain sign-in and Try again reruns the lookup", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel bolts");
    await submit();
    await lookups.answer(PAYWALL);

    expect(element("#paywall-warning").textContent).toContain(
      "Sign in to continue, or go Pro",
    );
    expect(location.pathname).toBe("/UNSPSC/steel_bolts/");

    await click(element("#signin-button"));
    expect(services.auth.calls).toContain("sign-in:plain");

    await click(element("#retry-button"));
    expect(lookups.calls).toHaveLength(2);
    expect(lookups.calls[1]!.query.query).toBe("steel bolts");
  });

  it("renders the signed-in paywall without Sign In and checks out on Upgrade", async () => {
    let settle!: (outcome: { kind: "redirect"; url: string }) => void;
    services = fakeServices({
      results: lookups.results,
      upgrade: () => new Promise((resolve) => (settle = resolve)),
    });
    await hydrate();
    await services.auth.set(SIGNED_IN);
    await type("steel bolts");
    await submit();
    await lookups.answer({
      ...PAYWALL,
      signedIn: true,
      limit: 25,
    } as ResultsResponse);

    expect(element("#paywall-warning").textContent).toContain(
      "You've used your 25 free trial searches",
    );
    expect(document.querySelector("#signin-button")).toBeNull();

    await click(element("#upgrade-button"));
    expect(element<HTMLButtonElement>("#upgrade-button").disabled).toBe(true);
    expect(element("#upgrade-button").textContent).toBe("Preparing...");
    expect(services.upgrades).toEqual([location.href]);

    await act(async () =>
      settle({ kind: "redirect", url: "https://polar.test/c" }),
    );
    expect(services.navigations).toEqual(["https://polar.test/c"]);
  });

  it.each([
    ["busy", { kind: "busy", message: "The classifier is busy. Try again." }],
    ["error", { kind: "error", message: "Error processing request" }],
  ] as const)("shows a %s answer's message", async (_, reply) => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel bolts");
    await submit();
    await lookups.answer(reply);

    expect(element("#results-container").textContent).toBe(reply.message);
    expect(location.pathname).toBe("/UNSPSC/");
  });

  it("checks a checkout return at once and recovers when the answer is results", async () => {
    window.history.replaceState(null, "", "/UNSPSC/?checkout=success");
    await hydrate();
    await services.auth.set(SIGNED_IN);

    expect(lookups.calls).toHaveLength(1);
    expect(element("#paywall-warning p[role=status]").textContent).toBe(
      "Payment activation is pending. Checking automatically...",
    );
    expect(element<HTMLButtonElement>("#retry-button").disabled).toBe(true);

    await lookups.answer(answer("laptop computer", ["43211503"]));
    expect(listedCodes()).toEqual(["43211503"]);
    expect(sessionStorage.getItem("classifast:checkout-recovery")).toBeNull();
  });

  it("grows each score bar to its width, staggering rows after the first", async () => {
    await hydrate();
    await services.auth.set(SIGNED_OUT);
    await type("steel bolts");
    await submit();
    const codes = Array.from({ length: 12 }, (_, index) =>
      String(31161500 + index),
    );
    await lookups.answer(answer("steel bolts", codes));

    const bars = [
      ...document.querySelectorAll<HTMLElement>("[data-score-bar]"),
    ];
    expect(bars[0]!.style.width).toBe("90%");
    expect(bars[0]!.style.animationDelay).toBe("");
    expect(bars[1]!.style.animationDelay).toBe("100ms");
    expect(bars[11]!.style.animationDelay).toBe("1000ms");
  });

  it("copies a result's ID with a tooltip on body and disables the button for 500 ms", async () => {
    vi.useFakeTimers();
    await hydrate();
    const button = element<HTMLButtonElement>("[data-copy-original-id]");

    await click(button);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("43211503");
    const tooltip = element("body > span[role=status]");
    expect(tooltip.textContent).toBe("Copied!");
    expect(button.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(500));
    expect(document.querySelector("body > span[role=status]")).toBeNull();
    expect(button.disabled).toBe(false);
  });

  it("copies the page link from the share button, green for 2 s", async () => {
    vi.useFakeTimers();
    await hydrate();
    const share = element("#share-button");

    await click(share);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(location.href);
    expect(share.textContent).toBe("Copied!");
    expect(share.classList).toContain("bg-green-600");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(share.textContent).toBe("Copy link");
    expect(share.classList).toContain("bg-gray-600");
  });
});
