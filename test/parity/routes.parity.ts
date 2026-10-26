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
  type Difference,
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
  if (answer.body.length === 0) return "empty";
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

// Each side's leading text when its view is one line (a digest), or the
// first differing normalized line with three lines of context.
function bodyExcerpts(
  answers: readonly [Answer, Answer],
  views: readonly [string, string],
): [string, string] {
  const lines = views.map((view) => view.split("\n"));
  let first = 0;
  while (first < lines[0]!.length && lines[0]![first] === lines[1]![first]) {
    first++;
  }
  const start = Math.max(0, first - 3);
  return answers.map((answer, index) => {
    const view = views[index]!;
    if (view === "empty") return view;
    if (!view.includes("\n")) {
      return `${view}: ${answer.body.toString("utf8").slice(0, 300)}`;
    }
    return `line ${first + 1}:\n${lines[index]!.slice(start, first + 4).join("\n")}`;
  }) as [string, string];
}

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
    const [left, right] = bodyExcerpts([python, nest], views);
    const texts = [python, nest].map((answer) =>
      (headerView(answer, "content-type") ?? "").startsWith("application/json")
        ? withoutTimestamp(answer.body).toString("utf8")
        : answer.body.toString("utf8"),
    ) as [string, string];
    found.push({ field: "body", python: left, nest: right, texts });
  }
  return found;
}

// Every header except the framing ones and the per-request clock. Gzip
// negotiates a body, so HEAD carries neither Content-Encoding nor the
// Accept-Encoding token that compression adds to Vary, in either app.
const VARYING_HEADERS = new Set([
  "content-length",
  "transfer-encoding",
  "date",
  "x-process-time",
  "content-encoding",
]);

function headView(answer: Answer): Record<string, string | null> {
  const vary = varyTokenSet(headerView(answer, "vary"))
    .filter((token) => token !== "accept-encoding")
    .join(", ");
  return Object.fromEntries(
    Object.keys(answer.headers)
      .filter((name) => !VARYING_HEADERS.has(name) && name !== "vary")
      .sort()
      .map((name) => [name, headerView(answer, name)])
      .concat(vary ? [["vary", vary]] : []),
  );
}

type ReportEntry = Omit<Difference, "texts"> & {
  probe: string;
  verdict: string;
};
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
      const entries = differences(python!, nest!).map(
        ({ texts, ...difference }) => {
          const divergence = explain(mode, probe, { ...difference, texts });
          const verdict = divergence
            ? `known: ${divergence.name}`
            : "unexplained";
          return { probe: label, ...difference, verdict };
        },
      );
      report.push(...entries);
      expect(
        entries.filter((entry) => entry.verdict === "unexplained"),
      ).toEqual([]);
      if (probe.method === "HEAD") {
        const get = await exchange("nest", { ...probe, method: "GET" });
        expect(
          {
            status: nest!.status,
            headers: headView(nest!),
            body: nest!.body.length,
          },
          "Nest HEAD answers like its GET",
        ).toEqual({ status: get.status, headers: headView(get), body: 0 });
      }
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
