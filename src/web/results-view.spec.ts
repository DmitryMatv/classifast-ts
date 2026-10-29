import type { ClassificationResult } from "../classifier/classification.js";
import { toResultsView, type ResultsViewContext } from "./results-view.js";

const UNSPSC: ResultsViewContext = {
  classifierType: "UNSPSC",
  version: { collectionName: "c", baseUrl: "https://example.test/?q=" },
  stripCodeDots: false,
};

function view(
  payload: Record<string, unknown>,
  context: ResultsViewContext = UNSPSC,
  score = 0.5,
) {
  const result: ClassificationResult = { id: 1, score, payload };
  return toResultsView([result], context).results[0]!;
}

describe("toResultsView", () => {
  it("formats a full result", () => {
    expect(
      view({
        original_id: "43211503",
        id_level: "Commodity",
        class_name: "Notebook computers",
        definition: "A small computer",
        embedding_text: "never shown",
      }),
    ).toEqual({
      originalId: "43211503",
      codeTokens: [
        { char: "4", gapAfter: false },
        { char: "3", gapAfter: true },
        { char: "2", gapAfter: false },
        { char: "1", gapAfter: true },
        { char: "1", gapAfter: false },
        { char: "5", gapAfter: true },
        { char: "0", gapAfter: false },
        { char: "3", gapAfter: false },
      ],
      detailUrl: "https://example.test/?q=43211503",
      idLevel: "Commodity",
      className: "Notebook computers",
      definition: "A small computer",
      scoreLabel: "50.0",
      scoreWidth: "50.00",
    });
  });

  it("renders a missing original_id as empty, as Jinja does", () => {
    expect(view({ definition: "Def" })).toEqual({
      originalId: "",
      codeTokens: [],
      detailUrl: "https://example.test/?q=",
      definition: "Def",
      scoreLabel: "50.0",
      scoreWidth: "50.00",
    });
  });

  it("prints payload values with Python's str()", () => {
    const result = view({
      original_id: 12,
      id_level: 3,
      definition: null,
      class_name: true,
    });
    expect(result).toMatchObject({
      originalId: "12",
      idLevel: "3",
      definition: "None",
    });
    // Jinja shows class_name only for a non-blank string.
    expect(result.className).toBeUndefined();
  });

  it("omits a falsy id_level and a blank class_name", () => {
    const result = view({ id_level: 0, class_name: " 　" });
    expect(result.idLevel).toBeUndefined();
    expect(result.className).toBeUndefined();
  });

  it("clamps the score to 0..100 percent", () => {
    expect(view({}, UNSPSC, 1.2)).toMatchObject({
      scoreLabel: "100.0",
      scoreWidth: "100.00",
    });
    expect(view({}, UNSPSC, -0.3)).toMatchObject({
      scoreLabel: "0.0",
      scoreWidth: "0.00",
    });
  });

  it("never spaces the codes of unspaced classifiers", () => {
    const tokens = view(
      { original_id: "EC000123" },
      {
        ...UNSPSC,
        classifierType: "ETIM",
      },
    ).codeTokens;
    expect(tokens.map((token) => token.char).join("")).toBe("EC000123");
    expect(tokens.every((token) => !token.gapAfter)).toBe(true);
  });

  it("builds the detail link from the version", () => {
    const nace = {
      ...UNSPSC,
      classifierType: "NACE",
      version: {
        collectionName: "c",
        baseUrl: "https://nace.test/",
        codeUrlSuffix: ".html",
      },
    };
    expect(view({ original_id: "01.11" }, nace).detailUrl).toBe(
      "https://nace.test/01.11.html",
    );
    expect(
      view({ original_id: "01.11" }, { ...nace, stripCodeDots: true })
        .detailUrl,
    ).toBe("https://nace.test/0111.html");
    expect(
      view(
        { original_id: "1" },
        {
          ...UNSPSC,
          version: {
            collectionName: "c",
            baseUrl: "https://gpc.test/",
            appendCodeToUrl: false,
          },
        },
      ).detailUrl,
    ).toBe("https://gpc.test/");
    for (const baseUrl of [undefined, "  "]) {
      const unlinked = {
        ...UNSPSC,
        version: { collectionName: "c", ...(baseUrl && { baseUrl }) },
      };
      expect(view({ original_id: "1" }, unlinked).detailUrl).toBeUndefined();
    }
  });

  it("keeps a filled tooltip and formats the elapsed time", () => {
    expect(
      toResultsView([], {
        ...UNSPSC,
        version: { collectionName: "c", tooltip: "Version note" },
        elapsedSeconds: 1.005,
      }),
    ).toEqual({ results: [], tooltip: "Version note", elapsed: "1.00" });
    expect(
      toResultsView([], {
        ...UNSPSC,
        version: { collectionName: "c", tooltip: " " },
      }),
    ).toEqual({ results: [] });
  });
});
