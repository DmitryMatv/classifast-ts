import type { AppConfig } from "../config/app-config.js";
import {
  GoogleCrawlerRanges,
  GoogleCrawlerVerifier,
  parseGoogleCrawlerNetworks,
  type CrawlerRequest,
} from "./google-crawlers.js";
import { parseIpNetwork, type IpNetwork } from "./ip-network.js";

type CrawlerConfig = AppConfig["googleCrawler"];

const GOOGLE_RANGE = parseIpNetwork("66.249.64.0/27")!;
const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

function crawlerConfig(overrides: Partial<CrawlerConfig> = {}): CrawlerConfig {
  return {
    bypassEnabled: true,
    trustCfConnectingIp: true,
    ipRangeTtlSeconds: 60,
    ipRangeNegativeTtlSeconds: 300,
    ipRangeTimeoutSeconds: 2,
    ...overrides,
  };
}

function crawlerRequest(
  overrides: Partial<CrawlerRequest> = {},
): CrawlerRequest {
  return {
    userAgent: GOOGLEBOT,
    cfConnectingIp: "66.249.64.1",
    peerAddress: "127.0.0.1",
    ...overrides,
  };
}

function verifierWith(config: CrawlerConfig) {
  const current = vi.fn(async (): Promise<readonly IpNetwork[]> => [
    GOOGLE_RANGE,
  ]);
  return { verifier: new GoogleCrawlerVerifier(config, { current }), current };
}

describe("parseGoogleCrawlerNetworks", () => {
  it("parses malformed and empty payloads as no ranges", () => {
    expect(parseGoogleCrawlerNetworks({})).toEqual([]);
    expect(parseGoogleCrawlerNetworks({ prefixes: [] })).toEqual([]);
    expect(parseGoogleCrawlerNetworks([])).toEqual([]);
    expect(
      parseGoogleCrawlerNetworks({
        prefixes: [
          { ipv4Prefix: "not-a-cidr" },
          { ipv6Prefix: "also-not-a-cidr" },
          { irrelevant: "66.249.64.0/27" },
          "not-a-dict",
        ],
      }),
    ).toEqual([]);
  });

  it("reads the IPv4 prefix, else the IPv6 prefix, of each entry", () => {
    expect(
      parseGoogleCrawlerNetworks({
        prefixes: [
          { ipv4Prefix: "66.249.64.0/27" },
          { ipv4Prefix: "", ipv6Prefix: "2001:4860:4801:10::/64" },
          { ipv4Prefix: "66.249.64.1/27" },
        ],
      }),
    ).toEqual([GOOGLE_RANGE, parseIpNetwork("2001:4860:4801:10::/64")]);
  });
});

describe("GoogleCrawlerVerifier", () => {
  it.each([
    [
      "Googlebot",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/120.0 Safari/537.36",
    ],
    [
      "Google-InspectionTool",
      "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
    ],
  ])("verifies %s from a Google IP", async (_name, userAgent) => {
    const { verifier, current } = verifierWith(crawlerConfig());

    expect(await verifier.isVerified(crawlerRequest({ userAgent }))).toBe(true);
    expect(current).toHaveBeenCalledOnce();
  });

  it("rejects a spoofed Googlebot user agent from a non-Google IP", async () => {
    const { verifier, current } = verifierWith(crawlerConfig());

    const verified = await verifier.isVerified(
      crawlerRequest({ cfConnectingIp: "203.0.113.10" }),
    );

    expect(verified).toBe(false);
    expect(current).toHaveBeenCalledOnce();
  });

  it("ignores CF-Connecting-IP without the explicit trust opt-in", async () => {
    const { verifier, current } = verifierWith(
      crawlerConfig({ trustCfConnectingIp: false }),
    );

    const verified = await verifier.isVerified(
      crawlerRequest({ peerAddress: "203.0.113.10" }),
    );

    expect(verified).toBe(false);
    expect(current).toHaveBeenCalledOnce();
  });

  it("uses the peer address when CF-Connecting-IP is missing", async () => {
    const { verifier } = verifierWith(crawlerConfig());

    const verified = await verifier.isVerified(
      crawlerRequest({ cfConnectingIp: undefined, peerAddress: "66.249.64.1" }),
    );

    expect(verified).toBe(true);
  });

  it("does not fetch ranges for a browser user agent", async () => {
    const { verifier, current } = verifierWith(crawlerConfig());

    const verified = await verifier.isVerified(
      crawlerRequest({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      }),
    );

    expect(verified).toBe(false);
    expect(current).not.toHaveBeenCalled();
  });

  it("rejects an invalid client IP without fetching ranges", async () => {
    const { verifier, current } = verifierWith(crawlerConfig());

    const verified = await verifier.isVerified(
      crawlerRequest({ cfConnectingIp: "not-an-ip" }),
    );

    expect(verified).toBe(false);
    expect(current).not.toHaveBeenCalled();
  });

  it("returns false without fetching ranges when the bypass is disabled", async () => {
    const { verifier, current } = verifierWith(
      crawlerConfig({ bypassEnabled: false }),
    );

    expect(await verifier.isVerified(crawlerRequest())).toBe(false);
    expect(current).not.toHaveBeenCalled();
  });
});

function rangesWith(
  config: CrawlerConfig,
  fetchNetworks: (timeoutSeconds: number) => Promise<IpNetwork[]>,
) {
  let now = 100;
  const fetch = vi.fn(fetchNetworks);
  const ranges = new GoogleCrawlerRanges(config, {
    fetchNetworks: fetch,
    monotonicSeconds: () => now,
  });
  return {
    ranges,
    fetch,
    setNow: (seconds: number) => {
      now = seconds;
    },
  };
}

const failing = async (): Promise<IpNetwork[]> => {
  throw new Error("boom");
};

describe("GoogleCrawlerRanges", () => {
  it("fails closed when the first fetch fails", async () => {
    const { ranges, fetch } = rangesWith(
      crawlerConfig({ ipRangeTtlSeconds: 0 }),
      failing,
    );

    expect(await ranges.current()).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(2);
  });

  it("serves an unexpired cache without fetching", async () => {
    const { ranges, fetch, setNow } = rangesWith(crawlerConfig(), async () => [
      GOOGLE_RANGE,
    ]);
    await ranges.current();
    setNow(159);

    expect(await ranges.current()).toEqual([GOOGLE_RANGE]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refetches once the TTL has passed", async () => {
    const { ranges, fetch, setNow } = rangesWith(crawlerConfig(), async () => [
      GOOGLE_RANGE,
    ]);
    await ranges.current();
    setNow(160);

    await ranges.current();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a refresh of an expired cache fails, and throttles retries", async () => {
    const { ranges, fetch, setNow } = rangesWith(crawlerConfig(), async () => [
      GOOGLE_RANGE,
    ]);
    await ranges.current();
    fetch.mockImplementation(failing);
    setNow(200);

    expect(await ranges.current()).toEqual([]);
    setNow(201);
    expect(await ranges.current()).toEqual([]);
    setNow(499);
    expect(await ranges.current()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);

    fetch.mockResolvedValue([GOOGLE_RANGE]);
    setNow(500);
    expect(await ranges.current()).toEqual([GOOGLE_RANGE]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("negative-caches an empty refresh for the negative TTL", async () => {
    const { ranges, fetch, setNow } = rangesWith(
      crawlerConfig(),
      async () => [],
    );

    expect(await ranges.current()).toEqual([]);
    setNow(110);
    expect(await ranges.current()).toEqual([]);

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    let resolve: (networks: IpNetwork[]) => void = () => {};
    const { ranges, fetch } = rangesWith(
      crawlerConfig(),
      () => new Promise((settle) => (resolve = settle)),
    );

    const first = ranges.current();
    const second = ranges.current();
    resolve([GOOGLE_RANGE]);

    expect(await Promise.all([first, second])).toEqual([
      [GOOGLE_RANGE],
      [GOOGLE_RANGE],
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("dates the cache from when the refresh started, as Python does", async () => {
    let resolve: (networks: IpNetwork[]) => void = () => {};
    const { ranges, fetch, setNow } = rangesWith(
      crawlerConfig(),
      () => new Promise((settle) => (resolve = settle)),
    );
    const pending = ranges.current();
    setNow(150);
    resolve([GOOGLE_RANGE]);
    await pending;

    setNow(160);
    fetch.mockResolvedValue([GOOGLE_RANGE]);
    await ranges.current();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
