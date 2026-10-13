import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import { assetUrl } from "./asset-url.js";

const golden = readGolden(
  "asset-url.json",
  z.object({
    files: z.record(z.string(), z.base64()),
    directories: z.array(z.string()),
    steps: z.array(
      z.union([
        z.object({ call: z.string(), url: z.string() }),
        z.object({ write: z.string(), base64: z.base64() }),
      ]),
    ),
  }),
);

function writeAsset(root: string, path: string, base64: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(base64, "base64"));
}

describe("assetUrl matches app/dependencies.py asset_url", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "classifast-assets-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("versions, falls back, and caches like Python", () => {
    for (const [path, base64] of Object.entries(golden.files)) {
      writeAsset(root, path, base64);
    }
    for (const path of golden.directories) {
      mkdirSync(join(root, path), { recursive: true });
    }
    for (const step of golden.steps) {
      if ("write" in step) {
        writeAsset(root, step.write, step.base64);
        continue;
      }
      expect(assetUrl(step.call, root), step.call).toBe(step.url);
    }
  });
});
