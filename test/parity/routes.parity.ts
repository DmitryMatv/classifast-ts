import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { inject } from "vitest";
import { varyTokenSet } from "../contract/support/headers.js";
import {
  normalizeFragment,
  normalizeHtml,
} from "../support/html-normalizer.js";
import {
  APPS,
  checkedCorpus,
  probeLabel,
  staticCorpus,
  type App,
  type Probe,
} from "./corpus.js";
import {
  COMPARED_HEADERS,
  explain,
  KNOWN_DIVERGENCES,
  type Field,
} from "./divergences.js";

const { mode, runDir, urls } = inject("parity");

type Answer = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

// Both apps see what Cloudflare forwards in production.
const FORWARDED = {
  host: "classifast.com",
  "x-forwarded-proto": "https",
  "accept-encoding": "gzip",
};

function exchange(
  app: App,
  probe: Probe,
  extraHeaders: Record<string, string> = {},
): Promise<Answer> {
  const base = new URL(urls[app]);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: base.hostname,
        port: base.port,
        method: probe.method,
        path: probe.path,
        headers: { ...FORWARDED, ...probe.headers, ...extraHeaders },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          const gzipped =
            response.headers["content-encoding"] === "gzip" && raw.length > 0;
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: gzipped ? gunzipSync(raw) : raw,
          });
        });
      },
    );
    outgoing.setTimeout(30_000, () =>
      outgoing.destroy(new Error(`${probeLabel(probe)} timed out on ${app}`)),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function answer(app: App, probe: Probe): Promise<Answer> {
  if (!probe.conditional) return exchange(app, probe);
  const { etag } = (await exchange(app, { ...probe, conditional: undefined }))
    .headers;
  return exchange(app, probe, etag ? { "if-none-match": etag } : {});
}

function headerView(answer: Answer, name: string): string | null {
  const value = answer.headers[name];
  if (value === undefined) return null;
  if (name === "vary") return varyTokenSet(String(value)).join(", ");
  return Array.isArray(value) ? value.join("\n") : value;
}

function bodyView(answer: Answer): string {
  const type = headerView(answer, "content-type") ?? "";
  if (type.startsWith("text/html")) {
    const html = answer.body.toString("utf8");
    return /^\s*<!doctype/i.test(html)
      ? normalizeHtml(html)
      : normalizeFragment(html);
  }
  const bytes = type.startsWith("application/json")
    ? withoutTimestamp(answer.body)
    : answer.body;
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${bytes.length} bytes, sha256 ${digest}`;
}

// The RapidAPI ping reports the clock: Python's time.time() float against
// Nest's milliseconds. Two requests never share it.
function withoutTimestamp(body: Buffer): Buffer {
  return Buffer.from(
    body
      .toString("utf8")
      .replace(/"timestamp":\d+(\.\d+)?/, '"timestamp":"<clock>"'),
  );
}

// The first differing normalized line with three lines of context, or the
// size and digest of a non-HTML body plus its leading text.
function bodyExcerpts(
  python: Answer,
  nest: Answer,
  views: [string, string],
): [string, string] {
  if (!views[0].includes("\n") && !views[1].includes("\n")) {
    return [python, nest].map(
      (answer, index) =>
        `${views[index]}: ${answer.body.toString("utf8").slice(0, 300)}`,
    ) as [string, string];
  }
  const [left, right] = views.map((view) => view.split("\n"));
  let line = 0;
  while (left![line] === right![line]) line++;
  const start = Math.max(0, line - 3);
  return [left!, right!].map(
    (lines) => `line ${line + 1}:\n${lines.slice(start, line + 4).join("\n")}`,
  ) as [string, string];
}

type Difference = { field: Field; python: string | null; nest: string | null };

function differences(python: Answer, nest: Answer): Difference[] {
  const found: Difference[] = [];
  if (python.status !== nest.status) {
    found.push({
      field: "status",
      python: String(python.status),
      nest: String(nest.status),
    });
  }
  for (const name of COMPARED_HEADERS) {
    const [left, right] = [headerView(python, name), headerView(nest, name)];
    if (left !== right) found.push({ field: name, python: left, nest: right });
  }
  const views: [string, string] = [bodyView(python), bodyView(nest)];
  if (views[0] !== views[1]) {
    const [left, right] = bodyExcerpts(python, nest, views);
    found.push({ field: "body", python: left, nest: right });
  }
  return found;
}

type ReportEntry = Difference & { probe: string; verdict: string };
const report: ReportEntry[] = [];

function sampleLinks(html: string): string[] {
  return [...html.matchAll(/href="([^"]*\/sample)"/g)].map(
    (match) => new URL(match[1]!, "https://classifast.com").pathname,
  );
}

// The sample downloads are whatever the mapping pages link to.
async function sampleProbes(pages: readonly Probe[]): Promise<Probe[]> {
  const mappingPages = pages.filter(
    (probe) =>
      probe.method === "GET" &&
      /^\/mapping\/$|^\/mapping\/[^/]+\/$/.test(probe.path),
  );
  const answers = await Promise.all(
    mappingPages.flatMap((probe) => APPS.map((app) => exchange(app, probe))),
  );
  const paths = new Set(
    answers.flatMap((answer) => sampleLinks(answer.body.toString("utf8"))),
  );
  return [...paths].flatMap((path): Probe[] => [
    { method: "GET", path },
    { method: "HEAD", path },
  ]);
}

const known = staticCorpus();
const probes = checkedCorpus([...known, ...(await sampleProbes(known))]);

afterAll(() => {
  writeFileSync(
    join(runDir, "report.json"),
    `${JSON.stringify({ mode, urls, probes: probes.length, differences: report }, null, 2)}\n`,
  );
});

describe(`Python and Nest parity (${mode} mode)`, () => {
  it("finds the mapping sample downloads", () => {
    expect(
      probes.filter((probe) => probe.path.endsWith("/sample")).length,
    ).toBeGreaterThan(0);
  });

  it.each(probes.map((probe) => ({ label: probeLabel(probe), probe })))(
    "$label",
    async ({ label, probe }) => {
      const [python, nest] = await Promise.all(
        APPS.map((app) => answer(app, probe)),
      );
      const unexplained = differences(python!, nest!).filter((difference) => {
        const divergence = explain(mode, probe, difference.field);
        report.push({
          probe: label,
          ...difference,
          verdict: divergence ? `known: ${divergence.name}` : "unexplained",
        });
        return divergence === undefined;
      });
      expect(unexplained).toEqual([]);
    },
  );

  it("every known divergence still occurs", () => {
    const stale = KNOWN_DIVERGENCES.filter(
      (divergence) =>
        (divergence.modes?.includes(mode) ?? true) &&
        !report.some((entry) => entry.verdict === `known: ${divergence.name}`),
    ).map((divergence) => divergence.name);
    expect(stale).toEqual([]);
  });
});
