import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STATIC_ROOT } from "../static/static-files.js";

const VERSION_LENGTH = 10;
const versions = new Map<string, string>();

function contentVersion(file: string): string | undefined {
  try {
    return createHash("sha256")
      .update(readFileSync(file))
      .digest("hex")
      .slice(0, VERSION_LENGTH);
  } catch {
    return undefined;
  }
}

// The ?v= content hash gives each deploy its own Cloudflare cache key. Hashes
// are cached for the life of the process; a missing file is retried on the
// next call and falls back to the unversioned URL, as before the first
// frontend build.
export function assetUrl(path: string, staticRoot = STATIC_ROOT): string {
  const file = join(staticRoot, path.replace(/^\/+/, ""));
  let version = versions.get(file);
  if (version === undefined) {
    version = contentVersion(file);
    if (version !== undefined) versions.set(file, version);
  }
  return `/static${path}${version === undefined ? "" : `?v=${version}`}`;
}
