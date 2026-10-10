import { Logger } from "@nestjs/common";
import { z } from "zod";
import { codePointLength, pyCasefold } from "../python/str.js";
import type { EnhancementStatus } from "./classification.js";
import { fetchJson, type Fetch } from "./outbound.js";
import {
  isCodeLike,
  normalizeProductDescription,
  sanitizeQueryText,
  sanitizeSearchText,
} from "./query-text.js";

export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";
export const QUERY_ENHANCEMENT_MODEL = "google/gemini-3.1-flash-lite";
const TIMEOUT_MS = 3_000;
const MAX_DESCRIPTION_LENGTH = 240;

export interface EnhancementOutcome {
  readonly text: string;
  readonly status: EnhancementStatus;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.unknown() }) })),
});

function enhancementPrompt(query: string, classifierType: string): string {
  return (
    `${query}\n\n` +
    `For a ${classifierType} classification search, ` +
    "write one short, neutral description of the " +
    "user's product or service. Use only its common " +
    "meaning and details supported by the input. " +
    "Do not guess materials, uses, industry, or " +
    "specifications. If the meaning is unclear, return " +
    "an empty string. Output only the description, " +
    "with no preface."
  );
}

export class QueryEnhancer {
  readonly #logger = new Logger(QueryEnhancer.name);

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  /** Never throws except when `signal` aborts. */
  async enhance(
    original: string,
    classifierType: string,
    signal: AbortSignal,
  ): Promise<EnhancementOutcome> {
    if (isCodeLike(original)) return { text: original, status: "skipped" };
    try {
      return await this.#describe(original, classifierType, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      this.#logger.warn(
        `Query enhancement unavailable: ${error instanceof Error ? error.name : typeof error}`,
      );
      return { text: original, status: "failed" };
    }
  }

  async #describe(
    original: string,
    classifierType: string,
    signal: AbortSignal,
  ): Promise<EnhancementOutcome> {
    const failed = { text: original, status: "failed" } as const;
    const skipped = { text: original, status: "skipped" } as const;
    const sanitizedOriginal = sanitizeQueryText(original);
    if (sanitizedOriginal.kind === "invalid") return failed;

    const response = await fetchJson(
      this.fetchFn,
      OPENROUTER_CHAT_URL,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: QUERY_ENHANCEMENT_MODEL,
          max_tokens: 80,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: enhancementPrompt(
                sanitizedOriginal.query,
                classifierType,
              ),
            },
          ],
        }),
      },
      TIMEOUT_MS,
      signal,
    );
    const content =
      completionSchema.parse(response).choices[0]?.message.content;
    if (typeof content !== "string") return failed;
    const description = normalizeProductDescription(content);
    if (!description) return skipped;
    if (
      codePointLength(description) > MAX_DESCRIPTION_LENGTH ||
      Array.from(description).some((character) => character.charCodeAt(0) < 32)
    ) {
      return failed;
    }
    const searchText = sanitizeSearchText(description);
    if (searchText.kind === "invalid" || !searchText.query) return failed;
    if (pyCasefold(searchText.query) === pyCasefold(sanitizedOriginal.query)) {
      return skipped;
    }
    return {
      text: `${sanitizedOriginal.query}\n\n${searchText.query}`,
      status: "applied",
    };
  }
}
