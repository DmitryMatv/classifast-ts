import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Results } from "./results.js";

describe("Results", () => {
  it("renders a result without original_id with an empty ID, as Jinja does", () => {
    const html = renderToStaticMarkup(
      createElement(Results, {
        query: "q",
        results: [{ id: 1, score: 0.5, payload: { definition: "Def" } }],
        classifierType: "UNSPSC",
        version: {
          collectionName: "c",
          baseUrl: "https://example.test/",
        },
        elapsedSeconds: 0.1,
        loaded: true,
        stripCodeDots: false,
      }),
    );
    expect(html).toContain('data-copy-original-id=""');
    expect(html).toContain('aria-label="View details for  (opens in new tab)"');
  });
});
