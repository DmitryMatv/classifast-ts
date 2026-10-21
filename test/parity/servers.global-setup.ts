import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { APPS, type App, type Mode } from "./corpus.js";

declare module "vitest" {
  export interface ProvidedContext {
    parity: {
      mode: Mode;
      runDir: string;
      urls: Record<App, string>;
    };
  }
}

const root = resolve(import.meta.dirname, "../..");
const controlScript = join(root, ".agents/skills/verify/scripts/control.mjs");
const execFileAsync = promisify(execFile);

const env = z
  .object({
    PARITY_MODE: z.enum(["public", "full"]).default("public"),
    PARITY_ENV_FILE: z.string().min(1).optional(),
  })
  .parse(process.env);

async function control(...args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [controlScript, ...args],
    { cwd: root },
  );
  return JSON.parse(stdout);
}

const launchResult = z.object({ url: z.string() });

// Launches both apps through the verify driver in the same mode with the
// same env file, and stops every process they started afterwards.
export default async function setup(project: TestProject) {
  mkdirSync(join(root, ".cache/parity"), { recursive: true });
  const runDir = mkdtempSync(join(root, ".cache/parity/run-"));
  const envFile = env.PARITY_ENV_FILE
    ? ["--env-file", env.PARITY_ENV_FILE]
    : [];
  const launched = await Promise.allSettled(
    APPS.map((app) =>
      control(
        "launch",
        join(runDir, app),
        "--app",
        app,
        "--mode",
        env.PARITY_MODE,
        ...envFile,
      ),
    ),
  );
  const teardown = async () => {
    const report = join(runDir, "report.json");
    if (existsSync(report)) console.log(`Parity report: ${report}`);
    const started = APPS.filter(
      (_, index) => launched[index]!.status === "fulfilled",
    );
    await Promise.all(
      started.map((app) => control("cleanup", join(runDir, app))),
    );
  };
  const failure = launched.find((result) => result.status === "rejected");
  if (failure) {
    await teardown();
    throw failure.reason;
  }
  const [python, nest] = launched.map((result) =>
    result.status === "fulfilled" ? launchResult.parse(result.value).url : "",
  );
  project.provide("parity", {
    mode: env.PARITY_MODE,
    runDir,
    urls: { python: python!, nest: nest! },
  });
  return teardown;
}
