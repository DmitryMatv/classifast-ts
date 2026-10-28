import { form, results } from "../../../test/support/classifier-fixtures.js";
import {
  HISTORY_STATE_KEY,
  historyEntryOf,
  lookupOf,
  type HistoryEntry,
} from "./lookup.js";

describe("lookupOf", () => {
  it("normalizes whitespace in the product description before sending", () => {
    expect(
      lookupOf(
        form("  Retail   facility and equipment maintenance\t\n service  "),
        null,
      )?.query,
    ).toBe("Retail facility and equipment maintenance service");
  });

  it("applies Python's whitespace, not JavaScript's, so the edge cache key matches the server's", () => {
    expect(lookupOf(form("pump\u001fseal\u0085ring"), null)?.query).toBe(
      "pump seal ring",
    );
    expect(lookupOf(form("\ufeffpump"), null)?.query).toBe("\ufeffpump");
  });

  it("keeps top-k, version and the enhance switch as the form holds them", () => {
    expect(
      lookupOf(form("pump", { version: "v2", topK: 30, enhance: true }), null),
    ).toEqual({ query: "pump", version: "v2", topK: 30, enhance: true });
  });

  it("uses the stored default example query when the textarea is empty", () => {
    expect(lookupOf(form(" \n "), "  Industrial   pump ")?.query).toBe(
      "Industrial pump",
    );
    expect(lookupOf(form("valve"), "Industrial pump")?.query).toBe("valve");
  });

  it("finds nothing to send when the textarea and the fallback are blank", () => {
    expect(lookupOf(form(" \t"), null)).toBeNull();
    expect(lookupOf(form(""), "   ")).toBeNull();
  });
});

describe("historyEntryOf", () => {
  const entry: HistoryEntry = {
    v: 1,
    fields: form("", { topK: 30, enhance: true }),
    fallbackQuery: "Industrial pump",
    title: "NAICS codes for 'Industrial Pump'",
    show: results(),
  };

  it.each([
    ["the server's page", { kind: "page" }],
    ["a refetch", { kind: "lookup" }],
    ["stored results", results()],
  ] as const)("reads back an entry that shows %s", (_name, show) => {
    const written = { ...entry, show };
    expect(
      historyEntryOf({ other: "kept", [HISTORY_STATE_KEY]: written }),
    ).toEqual(written);
  });

  it("survives the structured clone history.state goes through", () => {
    expect(
      historyEntryOf(structuredClone({ [HISTORY_STATE_KEY]: entry })),
    ).toEqual(entry);
  });

  it.each([
    ["no state", null],
    ["another script's state", { scroll: 10 }],
    ["another entry version", { [HISTORY_STATE_KEY]: { ...entry, v: 2 } }],
    [
      "a Top-K the form does not offer",
      {
        [HISTORY_STATE_KEY]: { ...entry, fields: { ...entry.fields, topK: 5 } },
      },
    ],
    [
      "results without code tokens",
      {
        [HISTORY_STATE_KEY]: {
          ...entry,
          show: {
            ...results(),
            results: [{ ...results().results[0], codeTokens: undefined }],
          },
        },
      },
    ],
    [
      "a paywall answer, which is never stored",
      {
        [HISTORY_STATE_KEY]: {
          ...entry,
          show: { kind: "paywall", signedIn: false, limit: 10 },
        },
      },
    ],
  ])("does not take %s for an entry", (_name, state) => {
    expect(historyEntryOf(state)).toBeNull();
  });
});
