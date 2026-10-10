import { pyStrip } from "../python/str.js";

export type QueryFormat = "legacy" | "input_first";

export interface RerankPayload {
  readonly class_name?: string | null;
  readonly definition?: string | null;
}

export function buildQueryEmbeddingText(
  query: string,
  instruction: string | undefined,
  queryFormat: QueryFormat = "legacy",
): string {
  const instructionText = instruction ? pyStrip(instruction) : "";
  if (!instructionText) return query;
  return queryFormat === "input_first"
    ? `${query}\n\n${instructionText}`
    : `Instruct: ${instructionText}\nQuery:${query}`;
}

export function buildRerankQueryText(
  query: string,
  instruction: string | undefined,
  queryFormat: QueryFormat = "legacy",
): string {
  const instructionText = instruction ? pyStrip(instruction) : "";
  if (!instructionText) return query;
  return queryFormat === "input_first"
    ? `${query}\n\n${instructionText}`
    : `${instructionText}\nQuery: ${query}`;
}

export function defaultRerankDocument({
  class_name: className,
  definition,
}: RerankPayload): string {
  if (className && definition) {
    return `${className} - Definition: ${definition}`;
  }
  return definition || className || "";
}
