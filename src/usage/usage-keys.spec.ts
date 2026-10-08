import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  checkoutGraceKey,
  checkoutRateLimitKey,
  clientIp,
  hashIp,
  usageCounterKeys,
  userTierKey,
} from "./usage-keys.js";

const golden = readGolden(
  "usage-keys.json",
  z.object({
    clientAddresses: z.array(
      z.object({
        cfConnectingIp: z.string().nullable(),
        xForwardedFor: z.string().nullable(),
        peerHost: z.string().nullable(),
        clientIp: z.string(),
        ipHash: z.string(),
        checkoutRateLimitKey: z.string(),
      }),
    ),
    anonymousCounters: z.array(
      z.object({
        trackingId: z.string(),
        clientIp: z.string(),
        keys: z.array(z.string()),
      }),
    ),
    users: z.array(
      z.object({
        userId: z.string(),
        counterKeys: z.array(z.string()),
        checkoutGraceKey: z.string(),
        userTierKey: z.string(),
      }),
    ),
  }),
);

describe("client IP hashing matches get_client_ip and hash_ip", () => {
  it.each(golden.clientAddresses)(
    "hashes $clientIp",
    ({ cfConnectingIp, xForwardedFor, peerHost, ...expected }) => {
      const ip = clientIp({
        cfConnectingIp: cfConnectingIp ?? undefined,
        xForwardedFor: xForwardedFor ?? undefined,
        peerHost: peerHost ?? undefined,
      });
      expect(ip).toBe(expected.clientIp);
      expect(hashIp(ip)).toBe(expected.ipHash);
      expect(checkoutRateLimitKey(hashIp(ip))).toBe(
        expected.checkoutRateLimitKey,
      );
    },
  );
});

describe("Redis keys match the Python usage tracker", () => {
  it.each(golden.anonymousCounters)(
    "counts $trackingId",
    ({ trackingId, clientIp: ip, keys }) => {
      expect(
        usageCounterKeys({ kind: "anonymous", trackingId, ipHash: hashIp(ip) }),
      ).toEqual(keys);
    },
  );

  it.each(golden.users)("keys $userId", (user) => {
    expect(usageCounterKeys({ kind: "signedIn", userId: user.userId })).toEqual(
      user.counterKeys,
    );
    expect(checkoutGraceKey(user.userId)).toBe(user.checkoutGraceKey);
    expect(userTierKey(user.userId)).toBe(user.userTierKey);
  });
});
