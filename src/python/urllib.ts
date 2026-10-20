import { isIP } from "node:net";

// encodeURIComponent leaves !'()* unescaped, and decodeURIComponent throws
// on malformed input where Python substitutes U+FFFD.

const ALWAYS_SAFE = /^[A-Za-z0-9_.~-]$/;
const LONE_SURROGATE = /\p{Surrogate}/u;
const encoder = new TextEncoder();
// Python's UTF-8 codec keeps a leading BOM; TextDecoder strips it by default.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export class UnicodeEncodeError extends Error {
  constructor() {
    super("'utf-8' codec can't encode a lone surrogate");
    this.name = "UnicodeEncodeError";
  }
}

// TextEncoder replaces a lone surrogate with U+FFFD; Python's codec raises.
function encodeUtf8(value: string): Uint8Array {
  if (LONE_SURROGATE.test(value)) throw new UnicodeEncodeError();
  return encoder.encode(value);
}

export function quote(value: string, safe = "/"): string {
  let quoted = "";
  for (const byte of encodeUtf8(value)) {
    const character = String.fromCharCode(byte);
    quoted +=
      byte < 0x80 && (ALWAYS_SAFE.test(character) || safe.includes(character))
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return quoted;
}

export function quotePlus(value: string, safe = ""): string {
  if (!value.includes(" ")) return quote(value, safe);
  return quote(value, `${safe} `).replaceAll(" ", "+");
}

function percentDecodeBytes(ascii: string): Uint8Array {
  const [head = "", ...rest] = ascii.split("%");
  const bytes = Array.from(head, (c) => c.charCodeAt(0));
  for (const item of rest) {
    const hex = item.slice(0, 2);
    const isByte = /^[0-9A-Fa-f]{2}$/.test(hex);
    if (isByte) bytes.push(parseInt(hex, 16));
    for (const c of isByte ? item.slice(2) : `%${item}`) {
      bytes.push(c.charCodeAt(0));
    }
  }
  return Uint8Array.from(bytes);
}

// Python decodes each run of ASCII characters on its own and passes other
// characters through, so "%C3é%A9" yields two replacement characters.
export function unquote(value: string): string {
  if (!value.includes("%")) return value;
  return value.replace(/[\0-\x7f]+/g, (ascii) =>
    decoder.decode(percentDecodeBytes(ascii)),
  );
}

export function unquotePlus(value: string): string {
  return unquote(value.replaceAll("+", " "));
}

export function urlencode(
  pairs: readonly (readonly [string, string])[],
): string {
  return pairs
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(value)}`)
    .join("&");
}

export class UrlSplitError extends Error {
  override readonly name = "UrlSplitError";
}

const C0_CONTROL_OR_SPACE = /^[\0-\x20]+/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

// urlsplit(url).netloc, or undefined where Python's is None. Throws where
// urlsplit raises ValueError.
export function urlsplitNetloc(url: string): string | undefined {
  let rest = url.replace(C0_CONTROL_OR_SPACE, "").replace(/[\t\r\n]/g, "");
  const colon = rest.indexOf(":");
  if (colon > 0 && SCHEME.test(rest.slice(0, colon))) {
    rest = rest.slice(colon + 1);
  }
  if (!rest.startsWith("//")) return undefined;
  const end = rest.slice(2).search(/[/?#]/);
  const netloc = end === -1 ? rest.slice(2) : rest.slice(2, end + 2);
  if (netloc.includes("[") !== netloc.includes("]")) {
    throw new UrlSplitError("Invalid IPv6 URL");
  }
  if (netloc.includes("[")) checkBracketedNetloc(netloc);
  checkNetloc(netloc);
  return netloc;
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = netloc.slice(netloc.lastIndexOf("@") + 1);
  const open = hostAndPort.indexOf("[");
  let hostname: string;
  if (open === -1) {
    hostname = hostAndPort.split(":", 1)[0] ?? "";
  } else {
    if (open > 0) throw new UrlSplitError("Invalid IPv6 URL");
    const bracketed = hostAndPort.slice(open + 1);
    const close = bracketed.indexOf("]");
    hostname = close === -1 ? bracketed : bracketed.slice(0, close);
    const port = close === -1 ? "" : bracketed.slice(close + 1);
    if (port && !port.startsWith(":")) {
      throw new UrlSplitError("Invalid IPv6 URL");
    }
  }
  if (/^[vV]/.test(hostname)) {
    if (!/^[vV][a-fA-F0-9]+\.[^]+$/.test(hostname)) {
      throw new UrlSplitError("IPvFuture address is invalid");
    }
  } else if (isIP(hostname) !== 6) {
    throw new UrlSplitError("Invalid IPv6 URL");
  }
}

function checkNetloc(netloc: string): void {
  if (/^[\0-\x7f]*$/.test(netloc)) return;
  const stripped = netloc.replace(/[@:#?]/g, "");
  const normalized = stripped.normalize("NFKC");
  if (stripped !== normalized && /[/?#@:]/.test(normalized)) {
    throw new UrlSplitError(
      `netloc '${netloc}' contains invalid characters under NFKC normalization`,
    );
  }
}
