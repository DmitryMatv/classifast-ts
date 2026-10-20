import { z } from "zod";
import { readGolden } from "../../test/support/golden.js";
import {
  getMappingProduct,
  getRelatedMappingProducts,
  listMappingProducts,
} from "./mapping-store.js";

const golden = readGolden(
  "mapping-store.json",
  z.object({
    products: z.array(z.record(z.string(), z.unknown())),
    lookups: z.array(z.object({ slug: z.string(), found: z.boolean() })),
    related: z.array(
      z.object({ slug: z.string(), related: z.array(z.string()) }),
    ),
  }),
);

function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      snakeKeys(item),
    ]),
  );
}

describe("the mapping store matches app/mapping_store.py", () => {
  it("lists every product with Python's fields and order", () => {
    expect(snakeKeys(listMappingProducts())).toEqual(golden.products);
  });

  it.each(golden.lookups)("finds $slug: $found", ({ slug, found }) => {
    expect(getMappingProduct(slug)?.slug).toBe(found ? slug : undefined);
  });

  it.each(golden.related)("relates $slug to $related", ({ slug, related }) => {
    const product = getMappingProduct(slug)!;
    expect(getRelatedMappingProducts(product).map((item) => item.slug)).toEqual(
      related,
    );
  });
});
