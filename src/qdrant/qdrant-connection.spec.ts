import { qdrantClientParams, resolveQdrantUrl } from "./qdrant-connection.js";

describe("resolveQdrantUrl", () => {
  it.each([
    [{ QDRANT_URL: "https://example.test:7443/" }, "https://example.test:7443"],
    [{ QDRANT_URL: "http://qdrant:6333" }, "http://qdrant:6333"],
    [{ QDRANT_URL: " remote.example.test/ " }, "https://remote.example.test"],
    [
      {
        QDRANT_URL: "remote.example.test",
        QDRANT_HOST: "ignored",
        QDRANT_PORT: "not-a-port",
      },
      "https://remote.example.test",
    ],
    [{ QDRANT_HOST: "qdrant", QDRANT_PORT: "6334" }, "http://qdrant:6334"],
    [{ QDRANT_HOST: " ", QDRANT_URL: "" }, "http://localhost:6333"],
    [{}, "http://localhost:6333"],
  ])("resolves %j to %s", (env, url) => {
    expect(resolveQdrantUrl(env)).toBe(url);
  });

  it("rejects a non-numeric port when it falls back to host and port", () => {
    expect(() => resolveQdrantUrl({ QDRANT_PORT: "abc" })).toThrow(
      /QDRANT_PORT must be a port number/,
    );
  });
});

describe("qdrantClientParams", () => {
  it("keeps the explicit port of an on-premises host", () => {
    expect(
      qdrantClientParams(
        { QDRANT_HOST: "qdrant-eu2dfebw2y9vs524c2lrlnhw" },
        30_000,
      ),
    ).toEqual({
      url: "http://qdrant-eu2dfebw2y9vs524c2lrlnhw:6333",
      port: 6333,
      timeout: 30_000,
    });
  });

  it("uses port 443 for a bare remote hostname instead of the client default 6333", () => {
    expect(
      qdrantClientParams({ QDRANT_URL: "qdrant-eu2.classifast.com" }, 120_000),
    ).toEqual({
      url: "https://qdrant-eu2.classifast.com",
      port: 443,
      timeout: 120_000,
    });
  });

  it("uses port 80 for a portless http URL", () => {
    expect(
      qdrantClientParams({ QDRANT_URL: "http://example.test" }, 1),
    ).toEqual({
      url: "http://example.test",
      port: 80,
      timeout: 1,
    });
  });

  it("passes the URL path as the REST prefix", () => {
    expect(
      qdrantClientParams({ QDRANT_URL: "https://proxy.test/qdrant/" }, 1),
    ).toEqual({
      url: "https://proxy.test",
      port: 443,
      prefix: "/qdrant",
      timeout: 1,
    });
  });

  it("sends a trimmed API key and omits a blank one", () => {
    expect(
      qdrantClientParams(
        { QDRANT_URL: "qdrant.example", QDRANT_API_KEY: " secret " },
        1,
      ),
    ).toMatchObject({ apiKey: "secret" });
    expect(
      qdrantClientParams(
        { QDRANT_URL: "qdrant.example", QDRANT_API_KEY: " " },
        1,
      ),
    ).not.toHaveProperty("apiKey");
  });
});
