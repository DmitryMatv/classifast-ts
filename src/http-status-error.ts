/**
 * A failure whose HTTP response the Python app fixes: `status` is the status
 * code and `message` is the response's `detail`.
 */
export abstract class HttpStatusError extends Error {
  abstract readonly status: number;
}
