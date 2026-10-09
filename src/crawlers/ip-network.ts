import { isIP } from "node:net";

export type IpAddress = { readonly version: 4 | 6; readonly value: bigint };

export type IpNetwork = IpAddress & { readonly prefixLength: number };

const BITS = { 4: 32, 6: 128 } as const;

function ipv4Value(text: string): bigint {
  return text
    .split(".")
    .reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
}

function ipv6Value(text: string): bigint {
  let address = text.split("%")[0]!;
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const embedded = ipv4Value(tail);
    address = `${address.slice(0, lastColon + 1)}${(embedded >> 16n).toString(16)}:${(embedded & 0xffffn).toString(16)}`;
  }
  const [head, compressedTail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = compressedTail ? compressedTail.split(":") : [];
  const groups =
    compressedTail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill("0"),
          ...right,
        ];
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

// Python's ipaddress.ip_address accepts exactly the strings net.isIP does,
// including IPv6 zone ids, which do not take part in network membership.
export function parseIpAddress(text: string): IpAddress | undefined {
  switch (isIP(text)) {
    case 4:
      return { version: 4, value: ipv4Value(text) };
    case 6:
      return { version: 6, value: ipv6Value(text) };
    default:
      return undefined;
  }
}

// _prefix_from_ip_int: a mask is some ones followed only by zeros.
function maskPrefixLength(mask: bigint, bits: number): number | undefined {
  let trailingZeros = 0;
  while (
    trailingZeros < bits &&
    ((mask >> BigInt(trailingZeros)) & 1n) === 0n
  ) {
    trailingZeros += 1;
  }
  const prefixLength = bits - trailingZeros;
  const ones = (1n << BigInt(prefixLength)) - 1n;
  return mask >> BigInt(trailingZeros) === ones ? prefixLength : undefined;
}

// IPv4 also takes a netmask or a hostmask after the slash.
function prefixLengthOf(text: string, version: 4 | 6): number | undefined {
  if (/^[0-9]+$/.test(text)) return Number(text);
  if (version === 6 || isIP(text) !== 4) return undefined;
  const mask = ipv4Value(text);
  return maskPrefixLength(mask, 32) ?? maskPrefixLength(mask ^ 0xffffffffn, 32);
}

// Mirrors ipaddress.ip_network(text) with strict=True: host bits must be zero.
export function parseIpNetwork(text: string): IpNetwork | undefined {
  const [addressText = "", prefixText, ...extra] = text.split("/");
  if (extra.length > 0) return undefined;
  const address = parseIpAddress(addressText);
  if (address === undefined) return undefined;
  const bits = BITS[address.version];
  const prefixLength =
    prefixText === undefined
      ? bits
      : prefixLengthOf(prefixText, address.version);
  if (prefixLength === undefined || prefixLength > bits) return undefined;
  const hostMask = (1n << BigInt(bits - prefixLength)) - 1n;
  if ((address.value & hostMask) !== 0n) return undefined;
  return { ...address, prefixLength };
}

export function networkContains(
  network: IpNetwork,
  address: IpAddress,
): boolean {
  if (network.version !== address.version) return false;
  const shift = BigInt(BITS[network.version] - network.prefixLength);
  return network.value >> shift === address.value >> shift;
}
