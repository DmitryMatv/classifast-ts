import { canonicalQuery, parseQueryString } from "./request-url.js";
import { resultsApiPath } from "./results-api.js";

function queryItems(path: string) {
  const [route, query = ""] = path.split("?");
  return { route, items: parseQueryString(query) };
}

describe("resultsApiPath", () => {
  it("lists the parameters in one order and always sends version and top_k", () => {
    const { route, items } = queryItems(
      resultsApiPath("UNSPSC", {
        query: "laptop",
        version: "UNSPSC_EN_v26",
        topK: 10,
        enhance: false,
      }),
    );
    expect(route).toBe("/api/results/UNSPSC");
    expect(items).toEqual([
      ["product_description", "laptop"],
      ["version", "UNSPSC_EN_v26"],
      ["top_k", "10"],
    ]);
  });

  it("adds enhance_query=1 last, and only when enhancing", () => {
    const path = resultsApiPath("NAICS", {
      query: "bakery",
      version: "v1",
      topK: 3,
      enhance: true,
    });
    expect(queryItems(path).items.at(-1)).toEqual(["enhance_query", "1"]);
    expect(path.endsWith("&enhance_query=1")).toBe(true);
  });

  it("collapses whitespace so the canonical-query middleware does not redirect", () => {
    const path = resultsApiPath("UNSPSC", {
      query: "　 laptop \t\n computer\u0085 ",
      version: "two  words",
      topK: 5,
      enhance: false,
    });
    const { items } = queryItems(path);
    expect(items[0]).toEqual(["product_description", "laptop computer"]);
    expect(canonicalQuery(items.slice(0, 1))).toBeUndefined();
  });

  it("round-trips reserved and non-ASCII characters", () => {
    const description = "a&b=c+d %25 ?#/ café \u{1f600} ß";
    const { items } = queryItems(
      resultsApiPath("CN", {
        query: description,
        version: "v&1",
        topK: 100,
        enhance: false,
      }),
    );
    expect(items).toEqual([
      ["product_description", description],
      ["version", "v&1"],
      ["top_k", "100"],
    ]);
    expect(canonicalQuery(items)).toBeUndefined();
  });

  it("gives equal queries one URL", () => {
    const query = { version: "v1", topK: 10, enhance: false };
    expect(
      resultsApiPath("UNSPSC", { ...query, query: " laptop  computer" }),
    ).toBe(resultsApiPath("UNSPSC", { ...query, query: "laptop computer " }));
  });
});
