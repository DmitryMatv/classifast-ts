export abstract class HttpStatusError extends Error {
  abstract readonly status: number;

  // The exception filter answers {"detail": ...} for any error with one.
  get detail(): string {
    return this.message;
  }
}
