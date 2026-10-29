import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");
const ENTRY = join(ROOT, "app/assets/ts/site.tsx");
const SERVER_ONLY =
  /^(node:|@nestjs\/|@qdrant\/|express$|redis$|jose$|react-dom\/server$)/;

interface ClientModule {
  readonly path: string;
  readonly imports: readonly string[];
}

function resolveLocal(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`${from} imports ${specifier}`);
  return found;
}

/** Every repository module site.tsx reaches, type-only imports included. */
function clientModules(): ClientModule[] {
  const modules = new Map<string, ClientModule>();
  const pending = [ENTRY];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (modules.has(path)) continue;
    const imports = ts
      .preProcessFile(readFileSync(path, "utf8"), true, true)
      .importedFiles.map((file) => file.fileName);
    modules.set(path, { path, imports });
    for (const specifier of imports) {
      if (specifier.startsWith("."))
        pending.push(resolveLocal(path, specifier));
    }
  }
  return [...modules.values()];
}

function isUnder(path: string, directories: readonly string[]): boolean {
  return directories.some(
    (directory) => path === directory || path.startsWith(directory + sep),
  );
}

/** Paths the Dockerfile's frontend-builder stage copies from the context. */
function frontendStageCopies(): string[] {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const stage = dockerfile
    .split(/^FROM /m)
    .find((block) => /^\S+ AS frontend-builder$/m.test(block));
  if (stage === undefined) throw new Error("no frontend-builder stage");
  return [...stage.matchAll(/^COPY (?!--from)(.+)$/gm)].flatMap((match) =>
    match[1]!
      .trim()
      .split(/\s+/)
      .slice(0, -1)
      .map((source) => join(ROOT, source)),
  );
}

/** Directories Tailwind scans for class names. */
function tailwindSources(): string[] {
  const input = join(ROOT, "app/assets/css/input.css");
  return [...readFileSync(input, "utf8").matchAll(/^@source "([^"]+)";/gm)].map(
    (match) => resolve(dirname(input), match[1]!),
  );
}

const modules = clientModules();

describe("client bundle boundary", () => {
  it("reaches the islands", () => {
    expect(modules.map(({ path }) => relative(ROOT, path))).toContain(
      "src/web/islands/registry.ts",
    );
  });

  it("imports no server-only module", () => {
    const offending = modules.flatMap(({ path, imports }) =>
      imports
        .filter((specifier) => SERVER_ONLY.test(specifier))
        .map((specifier) => `${relative(ROOT, path)} imports ${specifier}`),
    );
    expect(
      offending,
      "the browser bundle cannot run server code; move it out of the island's imports",
    ).toEqual([]);
  });

  it("lives in files the frontend Docker stage copies", () => {
    const copies = frontendStageCopies();
    const missing = modules
      .filter(({ path }) => !isUnder(path, copies))
      .map(({ path }) => relative(ROOT, path));
    expect(
      missing,
      "add a COPY for these to the Dockerfile's frontend-builder stage",
    ).toEqual([]);
  });

  it("has its markup scanned by Tailwind", () => {
    const sources = tailwindSources();
    const unscanned = modules
      .filter(({ path }) => path.endsWith(".tsx") && !isUnder(path, sources))
      .map(({ path }) => relative(ROOT, path));
    expect(
      unscanned,
      "add an @source line for these to app/assets/css/input.css",
    ).toEqual([]);
  });
});
