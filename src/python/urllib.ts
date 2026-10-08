// encodeURIComponent leaves !'()* unescaped, and decodeURIComponent throws
// on malformed input where Python substitutes U+FFFD.

const ALWAYS_SAFE = /^[A-Za-z0-9_.~-]$/;
const encoder = new TextEncoder();
// Python's UTF-8 codec keeps a leading BOM; TextDecoder strips it by default.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

export function quote(value: string, safe = "/"): string {
  let quoted = "";
  for (const byte of encoder.encode(value)) {
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
