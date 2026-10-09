import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import type { Tier } from "./clerk-users.js";
import { PaymentError } from "./payment-error.js";
import { PolarWebhooks } from "./polar-webhooks.js";

const golden = readGolden(
  "payments.json",
  z.object({
    webhookNow: z.number(),
    webhooks: z.array(
      z.object({
        name: z.string(),
        secret: z.string(),
        proProductId: z.string().nullable(),
        body: z.string(),
        headers: z.record(z.string(), z.string()),
        status: z.number(),
        json: z.unknown(),
        clerkUpdates: z.array(z.tuple([z.string(), z.string()])),
        tierWrites: z.array(z.tuple([z.string(), z.string()])),
      }),
    ),
  }),
);

type Call = [string, string];

function webhooks(
  secret: string | undefined,
  proProductId: string | undefined,
  clerkAccepts = true,
) {
  const clerkUpdates: Call[] = [];
  const tierWrites: Call[] = [];
  const handler = new PolarWebhooks(
    {
      accessToken: undefined,
      webhookSecret: secret,
      proProductId,
      allowedRedirectHosts: [],
    },
    {
      updateTier: async (userId: string, tier: Tier) => {
        clerkUpdates.push([userId, tier]);
        return clerkAccepts;
      },
    },
    {
      recordSubscriptionTier: async (userId: string, tier: string) => {
        tierWrites.push([userId, tier]);
      },
    },
    () => golden.webhookNow,
  );
  return { handler, clerkUpdates, tierWrites };
}

async function reply(promise: Promise<unknown>) {
  try {
    return { status: 200, json: await promise };
  } catch (error) {
    if (!(error instanceof PaymentError)) throw error;
    return { status: error.status, json: { detail: error.detail } };
  }
}

describe("PolarWebhooks", () => {
  it.for(golden.webhooks)(
    "answers $name as Python does",
    async ({
      name: _name,
      secret,
      proProductId,
      body,
      headers,
      ...expected
    }) => {
      const { handler, clerkUpdates, tierWrites } = webhooks(
        secret,
        proProductId ?? undefined,
      );
      const result = await reply(
        handler.handle(
          async () => Buffer.from(body, "base64"),
          (name) => headers[name],
        ),
      );
      expect({ ...result, clerkUpdates, tierWrites }).toEqual(expected);
    },
  );

  it("answers 500 without a webhook secret before reading the body", async () => {
    const { handler } = webhooks(undefined, "prod");
    const readBody = vi.fn(async () => Buffer.from("{}"));
    await expect(
      reply(handler.handle(readBody, () => undefined)),
    ).resolves.toEqual({
      status: 500,
      json: { detail: "Webhook secret not configured" },
    });
    expect(readBody).not.toHaveBeenCalled();
  });

  it("leaves the tier cache alone when Clerk rejects the update", async () => {
    const pro = golden.webhooks.find(
      (webhook) => webhook.name === "subscription.active active",
    );
    if (!pro) throw new Error("fixture lacks subscription.active active");
    const { handler, clerkUpdates, tierWrites } = webhooks(
      pro.secret,
      pro.proProductId ?? undefined,
      false,
    );
    const result = await reply(
      handler.handle(
        async () => Buffer.from(pro.body, "base64"),
        (name) => pro.headers[name],
      ),
    );
    expect(result).toEqual({
      status: 502,
      json: { detail: "Failed to update user metadata" },
    });
    expect(clerkUpdates).toEqual([["user_123", "pro"]]);
    expect(tierWrites).toEqual([]);
  });
});
