export abstract class HttpStatusError extends Error {
  abstract readonly status: number;
}
