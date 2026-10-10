import { classificationGolden as golden } from "../../test/support/classification-golden.js";
import { FakeClock } from "../../test/support/fake-http.js";
import {
  DEFAULT_RERANK_CANDIDATE_LIMIT,
  excludeIdMatches,
  mergeClassificationResults,
  partialIdMatches,
  semanticRetrieveLimit,
  sortByScoreDesc,
  type ClassificationResult,
} from "./classification.js";
import {
  rankSemanticResults,
  rerankCandidates,
  type PipelineDeps,
  type Reranker,
} from "./classification-pipeline.js";

function record({ id, score, rerankRelevanceScore }: ClassificationResult) {
  return rerankRelevanceScore === undefined
    ? { id, score }
    : { id, score, rerankRelevanceScore };
}

function result(
  id: string,
  score: number,
  payload: Record<string, unknown> = {},
): ClassificationResult {
  return { id, score, payload };
}

function recordingReranker(scores: readonly number[] | null) {
  const calls: { query: string; documents: string[] }[] = [];
  const reranker: Reranker = {
    rerank: async (query, documents) => {
      calls.push({ query, documents: [...documents] });
      if (scores === null) throw new Error("reranker down");
      return [...scores];
    },
  };
  return { reranker, calls };
}

const signal = new AbortController().signal;
const candidates: ClassificationResult[] = golden.rerankCandidates;

describe("result ordering matches Python", () => {
  it.each(golden.sorting)(
    "keeps tied scores in arrival order for top $topK",
    ({ topK, ids }) => {
      const tied = golden.tiedResults.map(({ id, score }) =>
        result(String(id), score),
      );
      expect(sortByScoreDesc(tied, topK).map((item) => item.id)).toEqual(ids);
    },
  );

  it.each(golden.limits)(
    "fetches $limit semantic candidates for top $topK when reranking is $reranking",
    ({ topK, reranking, limit }) => {
      expect(semanticRetrieveLimit(topK, reranking)).toBe(limit);
    },
  );
});

describe("rerankCandidates matches Python", () => {
  it.each(golden.rerank)(
    "reranks top $rerankTopN for top $topK with scores $scores ($format)",
    async ({
      scores,
      topK,
      rerankTopN,
      instruction,
      format,
      calls,
      results,
    }) => {
      const recording = recordingReranker(scores);

      const reranked = await rerankCandidates(
        recording.reranker,
        "industrial pump",
        candidates,
        {
          topK,
          rerankTopN,
          instruction: instruction ?? undefined,
          queryFormat: format,
        },
        signal,
      );

      expect(recording.calls).toEqual(calls);
      expect(reranked.map(record)).toEqual(results);
    },
  );

  it("keeps the semantic scores without rerank scores when the reranker fails", async () => {
    const semantic = [result("semantic-1", 0.41), result("semantic-2", 0.39)];

    const reranked = await rerankCandidates(
      recordingReranker(null).reranker,
      "industrial pump",
      semantic,
      { topK: 2, rerankTopN: 2 },
      signal,
    );

    expect(reranked.map(record)).toEqual([
      { id: "semantic-1", score: 0.41 },
      { id: "semantic-2", score: 0.39 },
    ]);
  });

  it("wraps the query in the instruction and keeps only the top results", async () => {
    const semantic = Array.from(
      { length: DEFAULT_RERANK_CANDIDATE_LIMIT },
      (_, index) =>
        result(`semantic-${index}`, 0.5, { class_name: `Pump part ${index}` }),
    );
    const recording = recordingReranker([
      0.52,
      0.91,
      ...Array<number>(DEFAULT_RERANK_CANDIDATE_LIMIT - 2).fill(0.1),
    ]);

    const reranked = await rerankCandidates(
      recording.reranker,
      "industrial pump",
      semantic,
      {
        topK: 2,
        rerankTopN: DEFAULT_RERANK_CANDIDATE_LIMIT,
        instruction: "Find matching codes.",
      },
      signal,
    );

    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]!.query).toBe(
      "Find matching codes.\nQuery: industrial pump",
    );
    expect(recording.calls[0]!.documents).toHaveLength(
      DEFAULT_RERANK_CANDIDATE_LIMIT,
    );
    expect(reranked.map(record)).toEqual([
      { id: "semantic-1", score: 0.5, rerankRelevanceScore: 0.91 },
      { id: "semantic-0", score: 0.5, rerankRelevanceScore: 0.52 },
    ]);
  });
});

describe("rankSemanticResults matches Python", () => {
  it.each(golden.ranking)(
    "ranks with reranker=$reranker, $idMatches.length ID matches and $remainingSeconds s left",
    async ({
      reranker,
      idMatches,
      remainingSeconds,
      semantic,
      rerankCalls,
      ranked,
      merged,
    }) => {
      const clock = new FakeClock();
      const recording = recordingReranker(golden.rankingScores);
      const deps = {
        reranker: reranker ? recording.reranker : null,
        clock,
      } as Pick<PipelineDeps, "reranker" | "clock"> as PipelineDeps;
      const idResults = idMatches.map(({ id, score }) =>
        result(String(id), score),
      );
      const semanticResults = semantic.map(({ id }) =>
        golden.rerankCandidates.find((candidate) => candidate.id === id)!,
      );

      const actual = await rankSemanticResults(
        deps,
        "industrial pump",
        excludeIdMatches(semanticResults, idResults),
        idResults,
        {
          topK: 3,
          rerankTopN: 100,
          instruction: "Find matching codes.",
          deadline:
            remainingSeconds === null
              ? Number.POSITIVE_INFINITY
              : clock.now() + remainingSeconds * 1000,
        },
        signal,
      );

      expect(recording.calls).toHaveLength(rerankCalls);
      expect(actual.map(record)).toEqual(ranked);
      expect(
        mergeClassificationResults(idResults, actual, 3).map(record),
      ).toEqual(merged);
    },
  );
});

describe("partialIdMatches matches Python", () => {
  it.each(golden.partialIds)(
    "keeps the points whose normalized ID starts or ends with $query",
    ({ query, ids }) => {
      expect(
        partialIdMatches(golden.partialIdPoints, query).map((item) => item.id),
      ).toEqual(ids);
    },
  );
});
