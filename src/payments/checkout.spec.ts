import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { Checkouts, validateReturnUrl } from "./checkout.js";
import { ClerkUsers } from "./clerk-users.js";
import { MAPPING_PRODUCTS } from "./mapping-products.js";
import { PaymentError } from "./payment-error.js";
import { POLAR_CHECKOUTS_URL, PolarCheckouts } from "./polar-checkouts.js";

const golden = readGolden(
  "payments.json",
  z.object({
    allowedRedirectHosts: z.array(z.string()),
    returnUrls: z.array(
      z.object({
        returnUrl: z.unknown(),
        baseUrl: z.string(),
        outcome: z.union([
          z.string(),
          z.null(),
          z.object({ status: z.number(), detail: z.string().optional() }),
        ]),
      }),
    ),
  }),
);

function outcome(returnUrl: unknown, baseUrl: string) {
  try {
    return (
      validateReturnUrl(returnUrl, baseUrl, golden.allowedRedirectHosts) ?? null
    );
  } catch (error) {
    return error instanceof PaymentError
      ? { status: error.status, detail: error.detail }
      : { status: 500 };
  }
}

describe("validateReturnUrl", () => {
  it("matches Python's validate_return_url", () => {
    const mismatches = golden.returnUrls.filter(
      (item) =>
        JSON.stringify(outcome(item.returnUrl, item.baseUrl)) !==
        JSON.stringify(item.outcome),
    );
    expect(mismatches).toEqual([]);
  });
});

const BASE_URL = "http://testserver/";
const PRO_PRODUCT = "configured-pro-product";
const POLAR_TOKEN = "polar-token";
const mapping = [...MAPPING_PRODUCTS.values()][0]!;

function polarReplying(...responses: (() => Response)[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected Polar request");
    return next();
  });
}

const checkoutCreated = () =>
  Response.json({ url: "https://polar.example/checkout" }, { status: 201 });

function checkouts({
  polarFetch = polarReplying(checkoutCreated),
  clerkFetch = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 404 }),
  ),
  ...config
}: {
  polarFetch?: ReturnType<typeof polarReplying>;
  clerkFetch?: ReturnType<typeof vi.fn<typeof fetch>>;
  accessToken?: string | undefined;
  proProductId?: string | undefined;
} = {}) {
  const service = new Checkouts(
    {
      accessToken: POLAR_TOKEN,
      proProductId: PRO_PRODUCT,
      allowedRedirectHosts: [],
      webhookSecret: undefined,
      ...config,
    },
    new PolarCheckouts(polarFetch),
    new ClerkUsers("sk_test", clerkFetch),
  );
  return { service, polarFetch, clerkFetch };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

function sentBody(polarFetch: ReturnType<typeof polarReplying>): unknown {
  const init = polarFetch.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof PaymentError))
    throw new Error("expected PaymentError");
  return { status: error.status, detail: error.detail };
}

describe("Checkouts.createPro", () => {
  it("sends Polar's 2026-10 request with Clerk's prefill and ignores a client product", async () => {
    const clerkFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        email_addresses: [
          { id: "idn_1", email_address: "other@example.com" },
          { id: "idn_2", email_address: "buyer@example.com" },
        ],
        primary_email_address_id: "idn_2",
        first_name: "Test",
        last_name: null,
      }),
    );
    const { service, polarFetch } = checkouts({ clerkFetch });

    const reply = await service.createPro(
      "user_123",
      json({
        product_id: "attacker-product",
        return_url: "http://testserver/NAICS/?q=bolts",
      }),
      BASE_URL,
    );

    expect(reply).toEqual({ url: "https://polar.example/checkout" });
    expect(clerkFetch.mock.calls[0]?.[0]).toBe(
      "https://api.clerk.com/v1/users/user_123",
    );
    const [url, init] = polarFetch.mock.calls[0]!;
    expect(url).toBe(POLAR_CHECKOUTS_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Polar-Version": "2026-10",
      Authorization: "Bearer polar-token",
    });
    expect(sentBody(polarFetch)).toEqual({
      products: [PRO_PRODUCT],
      metadata: { user_id: "user_123" },
      success_url: "http://testserver/NAICS/?q=bolts&checkout=success",
      customer_email: "buyer@example.com",
      customer_name: "Test",
    });
  });

  it("falls back to the homepage and sends null prefill when Clerk fails", async () => {
    const { service, polarFetch } = checkouts();
    await service.createPro("user_123", json({}), BASE_URL);
    expect(sentBody(polarFetch)).toMatchObject({
      success_url: "http://testserver/?checkout=success",
      customer_email: null,
      customer_name: null,
    });
  });

  it.each([
    [
      "a foreign return_url",
      { return_url: "https://evil.example/" },
      {},
      400,
      "Invalid return_url",
    ],
    [
      "no access token",
      {},
      { accessToken: undefined },
      500,
      "Polar Access Token not configured",
    ],
    [
      "no Pro product",
      {},
      { proProductId: undefined },
      500,
      "Polar Pro product not configured",
    ],
    ["a non-object body", [], {}, 500, "Failed to create checkout"],
    [
      "a non-string return_url",
      { return_url: 5 },
      {},
      500,
      "Failed to create checkout",
    ],
  ])("rejects %s", async (_name, body, options, status, detail) => {
    const { service, polarFetch } = checkouts(options);
    await expect(
      failure(service.createPro("user_123", json(body), BASE_URL)),
    ).resolves.toEqual({ status, detail });
    expect(polarFetch).not.toHaveBeenCalled();
  });

  it("answers 500 when Polar refuses the checkout", async () => {
    const { service } = checkouts({
      polarFetch: polarReplying(() => Response.json({}, { status: 422 })),
    });
    await expect(
      failure(service.createPro("user_123", json({}), BASE_URL)),
    ).resolves.toEqual({ status: 500, detail: "Failed to create checkout" });
  });
});

describe("Checkouts.createMapping", () => {
  it("sells the configured Polar product with mapping metadata", async () => {
    const { service, polarFetch, clerkFetch } = checkouts();
    const reply = await service.createMapping(
      json({
        slug: mapping.slug,
        product_id: "untrusted-client-product",
        return_url: `http://testserver/mapping/${mapping.slug}/`,
      }),
      BASE_URL,
    );
    expect(reply).toEqual({ url: "https://polar.example/checkout" });
    expect(sentBody(polarFetch)).toEqual({
      products: [mapping.polarProductId],
      metadata: {
        mapping_slug: mapping.slug,
        source_standard: mapping.sourceStandard,
        target_standard: mapping.targetStandard,
      },
      success_url: `http://testserver/mapping/${mapping.slug}/?checkout=success`,
    });
    expect(clerkFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["no slug", {}, 400, "Missing slug"],
    ["an empty slug", { slug: "" }, 400, "Missing slug"],
    [
      "an unknown slug",
      { slug: "missing-product" },
      404,
      "Mapping product not found",
    ],
    [
      "a prototype key",
      { slug: "constructor" },
      404,
      "Mapping product not found",
    ],
    ["a numeric slug", { slug: 5 }, 404, "Mapping product not found"],
    ["a list slug", { slug: ["x"] }, 500, "Failed to create mapping checkout"],
    [
      "a foreign return_url before the slug",
      { return_url: "https://evil.example/" },
      400,
      "Invalid return_url",
    ],
  ])("rejects %s", async (_name, body, status, detail) => {
    const { service, polarFetch } = checkouts();
    await expect(
      failure(service.createMapping(json(body), BASE_URL)),
    ).resolves.toEqual({ status, detail });
    expect(polarFetch).not.toHaveBeenCalled();
  });

  it("keeps Polar's error as the cause of the 500", async () => {
    const polarError = new Error("polar create failed");
    const { service } = checkouts({
      polarFetch: vi.fn<typeof fetch>(async () => {
        throw polarError;
      }),
    });
    const error = await service
      .createMapping(json({ slug: mapping.slug }), BASE_URL)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PaymentError);
    expect(error).toMatchObject({
      status: 500,
      detail: "Failed to create mapping checkout",
      cause: polarError,
    });
  });
});
