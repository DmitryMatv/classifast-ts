import { randomUUID } from "node:crypto";
import {
  classificationTimeout,
  contract,
  fullMode,
  meets,
} from "./support/env.js";
import {
  expectCacheProfile,
  expectStatus,
  freshClientIp,
  parseHtml,
  send,
  varyTokens,
  type Reply,
} from "./support/http.js";

function fragment(description: string, query = "", ip = freshClientIp()) {
  return send(
    `/UNSPSC/fragment?product_description=${encodeURIComponent(description)}${query}`,
    { headers: { "cf-connecting-ip": ip } },
  );
}

function expectHtmlFragment(reply: Reply) {
  expect(reply.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(reply.headers.get("link")).toBeNull();
}

function expectStatusFragment(reply: Reply, message: string) {
  expectStatus(reply, 503);
  expectHtmlFragment(reply);
  expectCacheProfile(reply, "NO_STORE");
  expect(reply.headers.get("cache-tag")).toBeNull();
  expect(reply.headers.get("hx-push-url")).toBeNull();
  expect(parseHtml(reply).body.textContent?.trim()).toBe(message);
}

describe.runIf(contract.mode === "public")(
  "fragment without usage tracking",
  () => {
    it("a description gets 503 before any classification", async () => {
      expectStatusFragment(
        await fragment("laptop computer"),
        "Usage tracking is temporarily unavailable",
      );
    });
  },
);

describe("empty fragment", () => {
  it("an empty description renders the prompt without a classification", async () => {
    const reply = await fragment("");
    expectStatus(reply, 200);
    expectHtmlFragment(reply);
    expectCacheProfile(reply, "CLASSIFICATION_RESULT");
    expect(varyTokens(reply)).toEqual(["accept-encoding"]);
    expect(reply.headers.get("hx-push-url")).toBeNull();
    expect(parseHtml(reply).body.textContent?.trim()).toBe(
      "Please enter a query",
    );
  });
});

type ResultCase = {
  name: string;
  query: string;
  items: number;
  pushUrl: string | null;
  title: string | null;
};

const resultCases: ResultCase[] = [
  {
    name: "default options push the canonical query URL",
    query: "",
    items: 10,
    pushUrl: "/UNSPSC/laptop_computer/",
    title: "UNSPSC codes for 'Laptop Computer'",
  },
  {
    name: "a non-default top_k stays in the pushed URL",
    query: "&top_k=3",
    items: 3,
    pushUrl: "/UNSPSC/laptop_computer/?top_k=3",
    title: "UNSPSC codes for 'Laptop Computer'",
  },
  {
    name: "push_url=false pushes nothing and swaps no title",
    query: "&push_url=false",
    items: 10,
    pushUrl: null,
    title: null,
  },
];

describe.runIf(fullMode)(
  "result fragments",
  { timeout: classificationTimeout(1) },
  () => {
    it.each(resultCases)("$name", async ({ query, items, pushUrl, title }) => {
      const reply = await fragment("laptop computer", query);
      expectStatus(reply, 200);
      expectHtmlFragment(reply);
      expectCacheProfile(reply, "CLASSIFICATION_RESULT");
      expect(reply.headers.get("cache-tag")).toBe("classification-results");
      expect(reply.headers.get("hx-push-url")).toBe(pushUrl);

      const document = parseHtml(reply);
      const results = [...document.querySelectorAll('[role="listitem"]')];
      expect(results).toHaveLength(items);
      for (const result of results) {
        const bar = result.querySelector("[data-score-bar]");
        expect(Number(bar?.getAttribute("data-score-width"))).toBeGreaterThan(
          0,
        );
        expect(
          result
            .querySelector("[data-copy-original-id]")
            ?.getAttribute("data-copy-original-id"),
        ).toMatch(/\S/);
      }
      expect(document.querySelectorAll("#share-button")).toHaveLength(1);
      const pageTitle = document.querySelector(
        'title#page-title[hx-swap-oob="true"]',
      );
      expect(pageTitle?.textContent ?? null).toBe(title);
    });
  },
);

function originalIds(reply: Reply): (string | null)[] {
  return [...parseHtml(reply).querySelectorAll("[data-copy-original-id]")].map(
    (element) => element.getAttribute("data-copy-original-id"),
  );
}

// No request makes enhancement fail deterministically; a server without
// OPENROUTER_API_KEY has no enhancer, so every enhanced lookup fails.
describe.runIf(meets("noOpenRouterKey"))(
  "failed query enhancement",
  { timeout: classificationTimeout(2) },
  () => {
    it("enhance_query=1 returns the plain results uncached", async () => {
      const enhanced = await fragment("laptop computer", "&enhance_query=1");
      expectStatus(enhanced, 200);
      expectHtmlFragment(enhanced);
      expectCacheProfile(enhanced, "NO_STORE");
      expect(enhanced.headers.get("cache-tag")).toBe("classification-results");
      expect(enhanced.headers.get("hx-push-url")).toBe(
        "/UNSPSC/laptop_computer/?enhance_query=1",
      );

      const plain = await fragment("laptop computer");
      expectStatus(plain, 200);
      expect(originalIds(enhanced)).toHaveLength(10);
      expect(originalIds(enhanced)).toEqual(originalIds(plain));
    });
  },
);

describe.runIf(fullMode)(
  "paywall fragment",
  { timeout: classificationTimeout(contract.anonLimit + 1) },
  () => {
    it(`the request after ${contract.anonLimit} anonymous lookups gets the paywall`, async () => {
      const ip = freshClientIp();
      for (let lookup = 1; lookup <= contract.anonLimit; lookup += 1) {
        const reply = await fragment("laptop computer", "", ip);
        expectStatus(reply, 200);
        expect(reply.body).not.toContain('id="paywall-warning"');
      }

      const reply = await fragment("laptop computer", "", ip);
      expectStatus(reply, 200);
      expectHtmlFragment(reply);
      expectCacheProfile(reply, "NO_STORE");
      expect(reply.headers.get("cache-tag")).toBeNull();
      expect(reply.headers.get("hx-push-url")).toBe("/UNSPSC/laptop_computer/");
      expect(reply.headers.get("x-ratelimit-limit")).toBe(
        String(contract.anonLimit),
      );
      expect(reply.headers.get("x-ratelimit-remaining")).toBe("0");

      const document = parseHtml(reply);
      for (const id of [
        "paywall-warning",
        "paywall-buttons",
        "signin-button",
        "upgrade-button",
        "retry-button",
      ]) {
        expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
      }
      expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(0);
    });
  },
);

const activeSlots = 1;
const waitingSlots = 4;

describe.runIf(fullMode)(
  "queue overflow",
  { timeout: classificationTimeout(activeSlots + waitingSlots) },
  () => {
    it("requests beyond one active and four waiting get 503", async () => {
      const run = randomUUID().slice(0, 8);
      const replies = await Promise.all(
        Array.from({ length: activeSlots + waitingSlots + 3 }, (_, index) =>
          fragment(`contract overflow probe ${run} item ${index}`),
        ),
      );
      const refused = replies.filter((reply) => reply.status === 503);
      expect(refused.length).toBeGreaterThan(0);
      expect(
        replies.filter((reply) => reply.status === 200).length,
      ).toBeGreaterThan(0);
      for (const reply of refused) {
        expectHtmlFragment(reply);
        expectCacheProfile(reply, "NO_STORE");
        expect(parseHtml(reply).body.textContent?.trim()).toBe(
          "Classification queue is full. Please try again later.",
        );
      }
    });
  },
);
