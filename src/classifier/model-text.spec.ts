import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  buildQueryEmbeddingText,
  buildRerankQueryText,
  defaultRerankDocument,
} from "./model-text.js";

const golden = readGolden(
  "model-text.json",
  z.object({
    queryTexts: z.array(
      z.object({
        query: z.string(),
        instruction: z.string().nullable(),
        format: z.enum(["legacy", "input_first"]),
        embedding: z.string(),
        rerank: z.string(),
      }),
    ),
    rerankDocuments: z.array(
      z.object({
        payload: z.object({
          class_name: z.string().nullable().optional(),
          definition: z.string().nullable().optional(),
        }),
        document: z.string(),
      }),
    ),
  }),
);

describe("model input text matches Python", () => {
  it.each(golden.queryTexts)(
    "formats $query with a $format instruction",
    ({ query, instruction, format, embedding, rerank }) => {
      const instructionOrUndefined = instruction ?? undefined;
      expect(
        buildQueryEmbeddingText(query, instructionOrUndefined, format),
      ).toBe(embedding);
      expect(buildRerankQueryText(query, instructionOrUndefined, format)).toBe(
        rerank,
      );
    },
  );

  it.each(golden.rerankDocuments)(
    "builds the rerank document for $payload",
    ({ payload, document }) => {
      expect(defaultRerankDocument(payload)).toBe(document);
    },
  );
});
