import { HttpStatusError } from "../http-status-error.js";

export class PaymentError extends HttpStatusError {
  constructor(
    readonly status: number,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(detail, options);
  }
}

export const proProductNotConfigured = () =>
  new PaymentError(500, "Polar Pro product not configured");
