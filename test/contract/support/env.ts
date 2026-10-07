import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => value || undefined);

const contractEnvSchema = z.object({
  CONTRACT_BASE_URL: z.url({
    error: "Set BASE_URL to the server under test, e.g. http://127.0.0.1:8001",
  }),
  CONTRACT_TARGET: z.enum(["python", "nest"]).default("python"),
  CONTRACT_MODE: z.enum(["public", "full"]).default("public"),
  CONTRACT_POLAR_WEBHOOK_SECRET: optionalSecret,
  CONTRACT_RAPIDAPI_SECRET: optionalSecret,
  CONTRACT_ANON_LIMIT: z.coerce.number().int().positive().default(10),
});

const env = contractEnvSchema.parse(process.env);

export type ContractMode = typeof env.CONTRACT_MODE;

export const contract = {
  baseUrl: new URL(env.CONTRACT_BASE_URL),
  target: env.CONTRACT_TARGET,
  mode: env.CONTRACT_MODE,
  polarWebhookSecret: env.CONTRACT_POLAR_WEBHOOK_SECRET,
  rapidApiSecret: env.CONTRACT_RAPIDAPI_SECRET,
  anonLimit: env.CONTRACT_ANON_LIMIT,
};

export const fullMode = contract.mode === "full";

export const repoRoot = join(import.meta.dirname, "../../..");

export function readRepoFile(relativePath: string): Buffer {
  return readFileSync(join(repoRoot, relativePath));
}

export function runsInMode(modes: readonly ContractMode[] | undefined) {
  return modes === undefined || modes.includes(contract.mode);
}
