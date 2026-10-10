import type { Readable } from "node:stream";
import { PaymentError } from "./payment-error.js";

// Starlette reads any body size; this cap keeps one request from filling the
// Raspberry Pi's memory.
export const MAX_BODY_BYTES = 1024 * 1024;

export async function readRawBody(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_BODY_BYTES) {
      throw new PaymentError(413, "Request Entity Too Large");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
