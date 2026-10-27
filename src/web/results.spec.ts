import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Results } from "./results.js";
import { toResultsView } from "./results-view.js";

describe("Results", () => {
  it("renders a result without original_id with an empty ID, as Jinja does", () => {
    const html = renderToStaticMarkup(
      createElement(Results, {
        ...toResultsView(
          [{ id: 1, score: 0.5, payload: { definition: "Def" } }],
          {
            classifierType: "UNSPSC",
            version: {
              collectionName: "c",
              baseUrl: "https://example.test/",
            },
            elapsedSeconds: 0.1,
            stripCodeDots: false,
          },
        ),
        query: "q",
        loaded: true,
      }),
    );
    expect(html).toContain('data-copy-original-id=""');
    expect(html).toContain('aria-label="View details for  (opens in new tab)"');
  });

  it("renders a view as the results list", () => {
    const html = renderToStaticMarkup(
      createElement(Results, {
        results: [
          {
            originalId: "12",
            codeTokens: [
              { char: "1", gapAfter: true },
              { char: "2", gapAfter: false },
            ],
            idLevel: "Class",
            definition: "Def",
            scoreLabel: "87.7",
            scoreWidth: "87.65",
          },
        ],
        tooltip: "Version note",
        elapsed: "1.25",
        query: "q",
        loaded: true,
      }),
    );
    expect(html).toContain('data-score-width="87.65"');
    expect(html).toContain(">87.7%</span>");
    expect(html).toContain(
      '<span class="text-[#17becf]">1</span><span aria-hidden="true" class="code-spacer-halves"></span><span class="text-[#e377c2]">2</span>',
    );
    expect(html).toContain('<span class="text-gray-600 text-lg">Class</span>');
    expect(html).not.toContain("<h3");
    expect(html).not.toContain("<a ");
    expect(html).toContain('<p class="text-gray-600 mb-4">Version note</p>');
    expect(html).toContain("<span>Finished in 1.25 seconds.</span>");
  });
});
