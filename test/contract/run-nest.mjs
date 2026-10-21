// Runs the contract suite against a public-mode Nest instance that the
// verify driver launches in a temporary run directory. Arguments go to
// `control.mjs launch`, for example `--env-file <path>`.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const control = join(root, ".agents/skills/verify/scripts/control.mjs");
const runDir = mkdtempSync(join(tmpdir(), "classifast-contract-nest-"));

function runControl(...args) {
  const result = spawnSync(process.execPath, [control, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`control.mjs ${args[0]} failed; see ${runDir}/evidence`);
  }
  return JSON.parse(result.stdout);
}

const { url } = runControl(
  "launch",
  runDir,
  "--app",
  "nest",
  "--mode",
  "public",
  ...process.argv.slice(2),
);
let exitCode = 1;
try {
  const suite = spawn(
    process.execPath,
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "test/contract/vitest.config.ts",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        BASE_URL: url,
        CONTRACT_TARGET: "nest",
        CONTRACT_MODE: "public",
      },
    },
  );
  // Ctrl-C reaches the suite directly; stay alive to clean up after it.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => suite.kill(signal));
  }
  exitCode = await new Promise((done) =>
    suite.on("exit", (code) => done(code ?? 1)),
  );
} finally {
  runControl("cleanup", runDir);
  console.log(`Server log: ${join(runDir, "evidence", "server.log")}`);
}
process.exit(exitCode);
