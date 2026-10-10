import { normalizeCandidateIds } from "./entitlement.js";

describe("normalizeCandidateIds", () => {
  it("collects ids from comma lists, lists and id fields", () => {
    expect(
      normalizeCandidateIds([
        "prod_a, prod_b, ",
        { id: "mapping-id", product_id: ["mapping-product-id", ""] },
        {
          id: "object-id",
          product_id: [
            "object-product-id",
            { polar_product_id: "nested-polar-id" },
          ],
        },
        null,
        5,
        true,
      ]),
    ).toEqual(
      new Set([
        "prod_a",
        "prod_b",
        "mapping-id",
        "mapping-product-id",
        "object-id",
        "object-product-id",
        "nested-polar-id",
      ]),
    );
  });
});
