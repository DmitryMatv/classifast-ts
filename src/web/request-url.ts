import { codePointLength, collapseWhitespace } from "../python/str.js";
import { quote, unquotePlus } from "../python/urllib.js";

export type QueryItem = readonly [name: string, value: string];

export function parseQueryString(latin1Query: string): QueryItem[] {
  return latin1Query
    .split("&")
    .filter(Boolean)
    .map((field) => {
      const equals = field.indexOf("=");
      return equals === -1
        ? [unquotePlus(field), ""]
        : [
            unquotePlus(field.slice(0, equals)),
            unquotePlus(field.slice(equals + 1)),
          ];
    });
}

const QUERY_COMPONENT_SAFE = "()*,:";

export function canonicalQuery(
  items: readonly QueryItem[],
): string | undefined {
  const normalized = items.map(
    ([name, value]) => [name, collapseWhitespace(value)] as const,
  );
  if (normalized.every(([, value], index) => value === items[index]![1])) {
    return undefined;
  }
  return normalized
    .map(
      ([name, value]) =>
        `${quote(name, QUERY_COMPONENT_SAFE)}=${quote(value, QUERY_COMPONENT_SAFE)}`,
    )
    .join("&");
}

const MAX_URL_LENGTH = 4000;
const SPAM_SIGNATURES = [
  "cfRLUnblockHandlers",
  "UnblockHandlers",
  "copyOriginalId",
];
const ATTACK_PATTERN =
  /(?:%25){3,}|\p{Nd}{50,}|%3c%3c|%3e%3e|(?<![a-zA-Z0-9])[0-9A-Fa-f]{64,}(?![a-zA-Z0-9])/u;

function lastValuePerName(items: readonly QueryItem[]): string[] {
  const values = new Map<string, string>();
  for (const [name, value] of items) values.set(name, value);
  return [...values.values()];
}

export function isSuspiciousRequestUrl(
  decodedPath: string,
  latin1Query: string,
): boolean {
  if (codePointLength(decodedPath + latin1Query) > MAX_URL_LENGTH) return true;
  const checked = [
    decodedPath,
    latin1Query,
    ...lastValuePerName(parseQueryString(latin1Query)),
  ].join("");
  return (
    ATTACK_PATTERN.test(checked) ||
    SPAM_SIGNATURES.some((signature) => checked.includes(signature))
  );
}
