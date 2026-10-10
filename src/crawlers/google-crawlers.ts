import { Logger } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { AppConfig } from "../config/app-config.js";
import {
  networkContains,
  parseIpAddress,
  parseIpNetwork,
  type IpNetwork,
} from "./ip-network.js";

export const GOOGLE_COMMON_CRAWLERS_URL =
  "https://developers.google.com/static/crawling/ipranges/common-crawlers.json";
const SUPPORTED_USER_AGENT_TOKENS = ["Googlebot", "Google-InspectionTool"];

const logger = new Logger("GoogleCrawlers");

type CrawlerConfig = AppConfig["googleCrawler"];

const rangesPayload = z.object({ prefixes: z.array(z.unknown()) });
const prefixEntry = z.object({
  ipv4Prefix: z.unknown().optional(),
  ipv6Prefix: z.unknown().optional(),
});

export function parseGoogleCrawlerNetworks(payload: unknown): IpNetwork[] {
  const parsed = rangesPayload.safeParse(payload);
  if (!parsed.success) return [];
  const networks: IpNetwork[] = [];
  for (const entry of parsed.data.prefixes) {
    const fields = prefixEntry.safeParse(entry);
    if (!fields.success) continue;
    const prefix = fields.data.ipv4Prefix || fields.data.ipv6Prefix;
    if (typeof prefix !== "string") continue;
    const network = parseIpNetwork(prefix);
    if (network === undefined) {
      logger.warn(`Ignoring invalid Google crawler IP prefix: ${prefix}`);
      continue;
    }
    networks.push(network);
  }
  return networks;
}

export async function fetchGoogleCrawlerNetworks(
  timeoutSeconds: number,
): Promise<IpNetwork[]> {
  const response = await fetch(GOOGLE_COMMON_CRAWLERS_URL, {
    redirect: "manual",
    signal: AbortSignal.timeout(Math.ceil(timeoutSeconds * 1000)),
  });
  if (!response.ok) {
    throw new Error(`Google crawler IP ranges answered ${response.status}`);
  }
  return parseGoogleCrawlerNetworks(await response.json());
}

export type CrawlerRangeSource = {
  readonly fetchNetworks: (timeoutSeconds: number) => Promise<IpNetwork[]>;
  readonly monotonicSeconds: () => number;
};

const liveSource: CrawlerRangeSource = {
  fetchNetworks: fetchGoogleCrawlerNetworks,
  monotonicSeconds: () => performance.now() / 1000,
};

// An empty list is the negative cache: a failed or empty refresh fails closed
// and is retried only after the negative TTL.
export class GoogleCrawlerRanges {
  private networks: readonly IpNetwork[] | undefined;
  private cachedAt = 0;
  private refreshing: Promise<readonly IpNetwork[]> | undefined;

  constructor(
    private readonly config: CrawlerConfig,
    private readonly source: CrawlerRangeSource = liveSource,
  ) {}

  current(): Promise<readonly IpNetwork[]> {
    if (this.networks !== undefined && this.isFresh(this.networks)) {
      return Promise.resolve(this.networks);
    }
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private isFresh(networks: readonly IpNetwork[]): boolean {
    const ttl =
      networks.length === 0
        ? this.config.ipRangeNegativeTtlSeconds
        : this.config.ipRangeTtlSeconds;
    return this.source.monotonicSeconds() - this.cachedAt < ttl;
  }

  private async refresh(): Promise<readonly IpNetwork[]> {
    const startedAt = this.source.monotonicSeconds();
    let networks: IpNetwork[];
    try {
      networks = await this.source.fetchNetworks(
        this.config.ipRangeTimeoutSeconds,
      );
      if (networks.length === 0) {
        logger.warn(
          "Google crawler IP range refresh returned no usable ranges",
        );
      }
    } catch (error) {
      logger.warn(
        `Failed to refresh Google crawler IP ranges: ${String(error)}`,
      );
      networks = [];
    }
    this.networks = networks;
    this.cachedAt = startedAt;
    return networks;
  }
}

export type CrawlerRequest = {
  readonly userAgent: string;
  readonly cfConnectingIp: string | undefined;
  readonly peerAddress: string | undefined;
};

export function crawlerRequestOf(req: Request): CrawlerRequest {
  return {
    userAgent: req.get("user-agent") ?? "",
    cfConnectingIp: req.headersDistinct["cf-connecting-ip"]?.[0],
    peerAddress: req.socket.remoteAddress,
  };
}

// The peer address is the TCP socket's, never X-Forwarded-For. CF-Connecting-IP
// counts only when the deployment opts in, because only infrastructure can
// guarantee that every request traverses Cloudflare.
export class GoogleCrawlerVerifier {
  constructor(
    private readonly config: CrawlerConfig,
    private readonly ranges: Pick<GoogleCrawlerRanges, "current">,
  ) {}

  async isVerified(request: CrawlerRequest): Promise<boolean> {
    if (!this.config.bypassEnabled) return false;
    const { userAgent } = request;
    if (
      !SUPPORTED_USER_AGENT_TOKENS.some((token) => userAgent.includes(token))
    ) {
      return false;
    }
    const clientIp =
      (this.config.trustCfConnectingIp && request.cfConnectingIp) ||
      request.peerAddress;
    const address = parseIpAddress(clientIp ?? "");
    if (address === undefined) return false;
    const networks = await this.ranges.current();
    return networks.some((network) => networkContains(network, address));
  }
}
