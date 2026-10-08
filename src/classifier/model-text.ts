import { pyStrip } from "../python/str.js";

// "input_first" puts an enhanced query before its instruction.
export type QueryFormat = "legacy" | "input_first";

export interface RerankPayload {
  readonly class_name?: string | null;
  readonly definition?: string | null;
}

// build_query_embedding_text: the Qwen3 embedding input.
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

// build_rerank_query_text: the reranker query.
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

// _default_rerank_document: the text the reranker scores for a candidate.
export function defaultRerankDocument({
  class_name: className,
  definition,
}: RerankPayload): string {
  if (className && definition) {
    return `${className} - Definition: ${definition}`;
  }
  return definition || className || "";
}
