import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value || undefined);

function isLoopback(url: URL): boolean {
  return (
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname)
  );
}

const contractEnvSchema = z
  .object({
    CONTRACT_BASE_URL: z
      .url({
        error:
          "Set BASE_URL to the server under test, e.g. http://127.0.0.1:8001",
      })
      .transform((value) => new URL(value)),
    CONTRACT_ALLOW_NON_LOOPBACK: z.literal("1").optional(),
    CONTRACT_TARGET: z.enum(["python", "nest"]).default("python"),
    CONTRACT_MODE: z.enum(["public", "full"]).default("public"),
    CONTRACT_POLAR_WEBHOOK_SECRET: optionalSecret,
    CONTRACT_RAPIDAPI_SECRET: optionalSecret,
    CONTRACT_POLAR_PRO_PRODUCT_ID: optionalSecret,
    CONTRACT_NO_OPENROUTER_KEY: z.literal("1").optional(),
    CONTRACT_ANON_LIMIT: z.coerce.number().int().positive().default(10),
    CONTRACT_CHECKOUT_RATE_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
  })
  .superRefine((env, context) => {
    if (isLoopback(env.CONTRACT_BASE_URL) || env.CONTRACT_ALLOW_NON_LOOPBACK) {
      return;
    }
    context.addIssue({
      code: "custom",
      path: ["BASE_URL"],
      message:
        `${env.CONTRACT_BASE_URL.host} is not a loopback host. Public mode ` +
        "posts checkout probes that increment Redis rate-limit counters, and " +
        "full mode charges quota and runs live classifications. Set " +
        "CONTRACT_ALLOW_NON_LOOPBACK=1 to target this server anyway.",
    });
  });

const env = contractEnvSchema.parse(process.env);

export type ContractMode = typeof env.CONTRACT_MODE;

export const contract = {
  baseUrl: env.CONTRACT_BASE_URL,
  target: env.CONTRACT_TARGET,
  mode: env.CONTRACT_MODE,
  polarWebhookSecret: env.CONTRACT_POLAR_WEBHOOK_SECRET,
  rapidApiSecret: env.CONTRACT_RAPIDAPI_SECRET,
  polarProProductId: env.CONTRACT_POLAR_PRO_PRODUCT_ID,
  anonLimit: env.CONTRACT_ANON_LIMIT,
  checkoutRateLimit: env.CONTRACT_CHECKOUT_RATE_LIMIT,
  noOpenRouterKey: env.CONTRACT_NO_OPENROUTER_KEY === "1",
};

export const fullMode = contract.mode === "full";

const prerequisites = {
  rapidApiSecret: {
    met: contract.rapidApiSecret !== undefined,
    declaredBy: "CONTRACT_RAPIDAPI_SECRET",
  },
  polarWebhookSecret: {
    met: contract.polarWebhookSecret !== undefined,
    declaredBy: "CONTRACT_POLAR_WEBHOOK_SECRET",
  },
  polarProProductId: {
    met: contract.polarProProductId !== undefined,
    declaredBy: "CONTRACT_POLAR_PRO_PRODUCT_ID",
  },
  noOpenRouterKey: {
    met: contract.noOpenRouterKey,
    declaredBy: "CONTRACT_NO_OPENROUTER_KEY=1",
  },
} as const;

export type Prerequisite = keyof typeof prerequisites;

export function unmetPrerequisites(
  requires: readonly Prerequisite[] = [],
): string[] {
  return requires
    .filter((name) => !prerequisites[name].met)
    .map((name) => `set ${prerequisites[name].declaredBy}`);
}

export function meets(...requires: Prerequisite[]): boolean {
  return fullMode && unmetPrerequisites(requires).length === 0;
}

const outboundBudgetMs = 60_000;
const requestOverheadMs = 15_000;
const classificationBudgetMs = outboundBudgetMs + requestOverheadMs;

export function classificationTimeout(classifications: number): number {
  return classifications * classificationBudgetMs;
}

export const repoRoot = join(import.meta.dirname, "../../..");

export function readRepoFile(relativePath: string): Buffer {
  return readFileSync(join(repoRoot, relativePath));
}

export function runsInMode(modes: readonly ContractMode[] | undefined) {
  return modes === undefined || modes.includes(contract.mode);
}
