import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  networkContains,
  parseIpAddress,
  parseIpNetwork,
} from "./ip-network.js";

const parsed = z.array(z.object({ input: z.string(), valid: z.boolean() }));

const golden = readGolden(
  "ip-network.json",
  z.object({
    addresses: parsed,
    networks: parsed,
    membership: z.array(
      z.object({
        address: z.string(),
        network: z.string(),
        contains: z.boolean(),
      }),
    ),
  }),
);

describe("parseIpAddress accepts what ipaddress.ip_address accepts", () => {
  it.each(golden.addresses)("$input -> $valid", ({ input, valid }) => {
    expect(parseIpAddress(input) !== undefined).toBe(valid);
  });
});

describe("parseIpNetwork accepts what ipaddress.ip_network accepts", () => {
  it.each(golden.networks)("$input -> $valid", ({ input, valid }) => {
    expect(parseIpNetwork(input) !== undefined).toBe(valid);
  });
});

describe("networkContains matches `address in network`", () => {
  it.each(golden.membership)(
    "$address in $network -> $contains",
    ({ address, network, contains }) => {
      expect(
        networkContains(parseIpNetwork(network)!, parseIpAddress(address)!),
      ).toBe(contains);
    },
  );
});
