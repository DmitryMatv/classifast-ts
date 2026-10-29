// Answers and form values the classifier specs share.
import type {
  FormFields,
  ResultsAnswer,
} from "../../src/web/classifier/lookup.js";
import type { AuthSnapshot } from "../../src/web/islands/services.js";
import type { ResultsResponse } from "../../src/web/results-api.js";

export const T0 = Date.UTC(2026, 9, 27, 12);
export const ORIGIN = "http://localhost:3000";

export const PENDING: AuthSnapshot = { status: "pending" };
export const SIGNED_OUT: AuthSnapshot = { status: "signed-out" };
export const UNAVAILABLE: AuthSnapshot = { status: "unavailable" };

export function signedIn(
  userId = "user_123",
  sessionUsable = true,
): AuthSnapshot {
  return { status: "signed-in", userId, sessionUsable };
}

export function form(text = "", fields: Partial<FormFields> = {}): FormFields {
  return { text, version: "v1", topK: 10, enhance: false, ...fields };
}

export function results(
  path = "/NAICS/industrial_pump/",
  title = "NAICS codes for 'Industrial Pump'",
): ResultsAnswer {
  return {
    kind: "results",
    version: "v1",
    url: path,
    title,
    results: [
      {
        originalId: "333914",
        codeTokens: [{ char: "3", gapAfter: false }],
        definition: "Measuring, Dispensing, and Other Pumping Equipment",
        scoreLabel: "0.91",
        scoreWidth: "91%",
      },
    ],
    elapsed: "0.42",
  };
}

export function paywall(
  path = "/NAICS/industrial_pump/",
  signedIn = false,
): Extract<ResultsResponse, { kind: "paywall" }> {
  return {
    kind: "paywall",
    signedIn,
    limit: 10,
    url: path,
    title: "NAICS codes for 'Industrial Pump'",
  };
}

export const BUSY: ResultsResponse = {
  kind: "busy",
  message: "The classifier is busy. Please try again in a moment.",
};

export const NETWORK_ERROR: ResultsResponse = {
  kind: "error",
  message: "Network error. Check your connection and try again.",
};
