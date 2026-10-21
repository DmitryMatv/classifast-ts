import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const script = join(root, ".agents/skills/verify/scripts/control.mjs");

type ProcessRecord = { role: string; pid: number; process_start: string };
const control = (await import(pathToFileURL(script).href)) as {
  processStart(pid: number): string | undefined;
  stopAll(processes: readonly ProcessRecord[]): Promise<void>;
  removeState(runDir: string, instance: string): boolean;
};

const children: ChildProcess[] = [];

function sleeper(role: string): ProcessRecord {
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  children.push(child);
  return {
    role,
    pid: child.pid!,
    process_start: control.processStart(child.pid!)!,
  };
}

const running = (record: ProcessRecord) =>
  control.processStart(record.pid) === record.process_start;

afterEach(() => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

describe("removeState", () => {
  it("leaves the state of a newer instance in place", () => {
    const runDir = mkdtempSync(join(tmpdir(), "verify-driver-"));
    const state = join(runDir, "instance.json");
    writeFileSync(state, JSON.stringify({ instance: "newer" }));

    expect(control.removeState(runDir, "older")).toBe(false);
    expect(existsSync(state)).toBe(true);
    expect(control.removeState(runDir, "newer")).toBe(true);
    expect(existsSync(state)).toBe(false);
    expect(control.removeState(runDir, "newer")).toBe(false);
  });
});

describe("stopAll", () => {
  it("treats ESRCH as stopped and attempts every process before failing", async () => {
    const exited = sleeper("exited");
    const refused = sleeper("refused");
    const normal = sleeper("normal");
    const kill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === exited.pid) {
        kill(pid, "SIGKILL");
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      }
      if (pid === refused.pid) {
        throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      }
      return kill(pid, signal);
    });

    const error = await control
      .stopAll([normal, refused, exited])
      .catch((reason: unknown) => reason);

    expect(error).toEqual(
      new Error(`Could not stop refused ${refused.pid}: kill EPERM`),
    );
    expect(running(exited)).toBe(false);
    expect(running(normal)).toBe(false);
    expect(running(refused)).toBe(true);
  });
});

function processesMentioning(marker: string): number[] {
  return readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => {
      try {
        return ["cmdline", "environ"].some((file) =>
          readFileSync(`/proc/${pid}/${file}`, "latin1").includes(marker),
        );
      } catch {
        return false;
      }
    })
    .map(Number);
}

const built =
  existsSync(join(root, "dist/main.js")) &&
  existsSync(join(root, "app/static/js/common.js"));

describe.runIf(built)("launch (needs npm run build and build:server)", () => {
  it("stops every started process when SIGTERM arrives during launch", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "verify-driver-launch-"));
    const marker = `VERIFY_DRIVER_SPEC_${process.pid}_${Date.now()}`;
    const launch = spawn(
      process.execPath,
      [script, "launch", runDir, "--mode", "public"],
      { env: { ...process.env, [marker]: "1" }, stdio: "ignore" },
    );
    const exited = new Promise<number | null>((done) =>
      launch.on("exit", (code) => done(code)),
    );
    const state = join(runDir, "instance.json");
    const recorded = () =>
      existsSync(state) &&
      (JSON.parse(readFileSync(state, "utf8")) as { processes: unknown[] })
        .processes.length > 0;
    await vi.waitFor(() => expect(recorded()).toBe(true), {
      timeout: 15_000,
      interval: 20,
    });

    launch.kill("SIGTERM");

    expect(await exited).toBe(143);
    expect(existsSync(state)).toBe(false);
    expect(processesMentioning(marker)).toEqual([]);
    expect(processesMentioning(runDir)).toEqual([]);
  }, 60_000);
});
