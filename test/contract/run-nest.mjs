// Runs the contract suite against a public-mode Nest instance that the
// verify driver launches in a temporary run directory. Arguments go to
// `control.mjs launch`, for example `--env-file <path>`.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const control = join(root, ".agents/skills/verify/scripts/control.mjs");
const runDir = mkdtempSync(join(tmpdir(), "classifast-contract-nest-"));

// A signal goes to the running step, launch or suite, which stops on its
// own; cleanup then runs detached so a second Ctrl-C cannot cut it short.
let current;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    interrupted = true;
    current?.kill(signal);
  });
}

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, ...options });
  current = child;
  let stdout = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk));
  return new Promise((done) =>
    child.on("close", (code) => {
      current = undefined;
      done({ code: code ?? 1, stdout });
    }),
  );
}

const launch = await run(
  process.execPath,
  [
    control,
    "launch",
    runDir,
    "--app",
    "nest",
    "--mode",
    "public",
    ...process.argv.slice(2),
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
if (launch.code !== 0) {
  console.error(`Launch failed; see ${join(runDir, "evidence")}`);
  process.exit(1);
}

let exitCode = 1;
try {
  if (!interrupted) {
    const suite = await run(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "test/contract/vitest.config.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          BASE_URL: JSON.parse(launch.stdout).url,
          CONTRACT_TARGET: "nest",
          CONTRACT_MODE: "public",
        },
      },
    );
    exitCode = suite.code;
  }
} finally {
  const cleanupDone = run(process.execPath, [control, "cleanup", runDir], {
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  current = undefined;
  if ((await cleanupDone).code !== 0) exitCode = 1;
  console.log(`Server log: ${join(runDir, "evidence", "server.log")}`);
}
process.exit(exitCode);
