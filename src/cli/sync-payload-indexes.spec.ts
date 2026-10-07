import {
  collectionInfo,
  expectedPayloadSchema,
  fakeQdrant,
  writeCalls,
  type FakeQdrant,
} from "../../test/support/fake-qdrant.js";
import {
  buildClassifierConfig,
  getAllCollectionNames,
} from "../classifier/classifier-config.js";
import { createQdrantClient } from "../qdrant/qdrant-connection.js";
import { defaultDeps, main, type CliDeps } from "./sync-payload-indexes.js";

vi.mock(import("../qdrant/qdrant-connection.js"), () => ({
  createQdrantClient: vi.fn(),
}));

const COLLECTIONS = getAllCollectionNames(buildClassifierConfig({}));
const FIRST = COLLECTIONS[0] ?? "";

function healthyQdrant(): FakeQdrant {
  return fakeQdrant({
    names: COLLECTIONS,
    info: collectionInfo({ vectors: { size: 2048, distance: "Cosine" } }),
  });
}

function depsFor(client: FakeQdrant, events: string[] = []): CliDeps {
  return {
    env: {},
    loadEnvFile: vi.fn(() => {
      events.push("dotenv");
    }),
    createClient: vi.fn(() => {
      events.push("client");
      return client;
    }),
  };
}

function output(stream: "log" | "error"): string {
  return vi
    .mocked(console[stream])
    .mock.calls.map((args) => args.join(" "))
    .join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sync-payload-indexes CLI", () => {
  it.each([[[]], [["sync"]], [["check", "extra"]], [["check", "--bogus"]]])(
    "exits 2 with usage for %j without loading .env or connecting",
    async (argv) => {
      const deps = depsFor(healthyQdrant());

      expect(await main(argv, deps)).toBe(2);

      expect(output("error")).toMatch(/^usage: sync-payload-indexes/);
      expect(deps.loadEnvFile).not.toHaveBeenCalled();
      expect(deps.createClient).not.toHaveBeenCalled();
    },
  );

  it("exits 2 for an unknown collection without connecting", async () => {
    const deps = depsFor(healthyQdrant());

    expect(await main(["check", "--collection", "not-configured"], deps)).toBe(
      2,
    );

    expect(output("error")).toContain(
      "error: Unknown configured collection(s): not-configured",
    );
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("exits 1 without connecting when HF_EMBEDDING_DIMS is invalid", async () => {
    const deps = {
      ...depsFor(healthyQdrant()),
      env: { HF_EMBEDDING_DIMS: "0" },
    };

    expect(await main(["check"], deps)).toBe(1);

    expect(output("error")).toContain("Invalid configuration");
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("check validates every configured collection and writes nothing", async () => {
    const client = healthyQdrant();

    expect(await main(["check"], depsFor(client))).toBe(0);

    expect(
      client.getCollection.mock.calls.map(([name]) => name).sort(),
    ).toEqual(COLLECTIONS);
    expect(writeCalls(client)).toBe(0);
    expect(client.scroll).not.toHaveBeenCalled();
    expect(output("log")).toContain(
      `Validated ${COLLECTIONS.length} configured collection(s).`,
    );
  });

  it("check exits 1 and lists each contract violation", async () => {
    const payloadSchema = expectedPayloadSchema();
    delete payloadSchema.class_name;
    const client = fakeQdrant({
      names: [FIRST],
      info: collectionInfo({
        vectors: { size: 2048, distance: "Cosine" },
        payloadSchema,
      }),
    });

    expect(await main(["check", "--collection", FIRST], depsFor(client))).toBe(
      1,
    );

    expect(output("log")).toContain(
      `Qdrant schema validation failed:\n  ! ${FIRST}: missing payload index 'class_name' [missing_payload_index]`,
    );
  });

  it("check uses HF_EMBEDDING_DIMS for the expected vector size", async () => {
    const client = healthyQdrant();
    const deps = { ...depsFor(client), env: { HF_EMBEDDING_DIMS: "1024" } };

    expect(await main(["check", "--collection", FIRST], deps)).toBe(1);

    expect(output("log")).toContain(
      `${FIRST}: vector size is 2048; expected 1024 [vector_size_mismatch]`,
    );
  });

  it("check inspects only the requested collection", async () => {
    const client = healthyQdrant();

    expect(await main(["check", "--collection", FIRST], depsFor(client))).toBe(
      0,
    );

    expect(client.getCollection.mock.calls).toEqual([[FIRST]]);
  });

  it.each(["check", "apply"])(
    "%s loads .env before it creates the client",
    async (command) => {
      const events: string[] = [];

      expect(await main([command], depsFor(healthyQdrant(), events))).toBe(0);

      expect(events).toEqual(["dotenv", "client"]);
    },
  );

  it("apply processes a repeated collection once and validates it afterwards", async () => {
    const client = healthyQdrant();

    expect(
      await main(
        ["apply", "--collection", FIRST, "--collection", FIRST],
        depsFor(client),
      ),
    ).toBe(0);

    expect(client.getCollection.mock.calls).toEqual([[FIRST], [FIRST]]);
    expect(client.scroll).toHaveBeenCalledTimes(1);
    expect(output("log")).toContain(
      "Completed: 1 collections remediated successfully",
    );
  });

  it("apply exits 1 when the final validation fails", async () => {
    const client = healthyQdrant();
    client.getCollections.mockResolvedValue({ collections: [] });

    expect(await main(["apply", "--collection", FIRST], depsFor(client))).toBe(
      1,
    );

    expect(output("log")).toContain(
      `  ! ${FIRST}: configured collection does not exist [missing_collection]`,
    );
  });

  it("apply exits 1 when a collection fails to migrate", async () => {
    const client = healthyQdrant();
    client.scroll.mockRejectedValueOnce(new Error("scroll down"));

    expect(await main(["apply", "--collection", FIRST], depsFor(client))).toBe(
      1,
    );

    expect(output("log")).toContain(
      "Errors: 1 collections had migration issues",
    );
  });

  it.each(["check", "apply"])(
    "%s exits 1 and reports a failure to create the client",
    async (command) => {
      const deps = depsFor(healthyQdrant());
      vi.mocked(deps.createClient).mockImplementation(() => {
        throw new Error("connect failed");
      });

      expect(await main([command], deps)).toBe(1);

      expect(output("log")).toContain(
        "Qdrant operation failed: connect failed",
      );
    },
  );

  it("connects with a 120 second timeout for maintenance operations", () => {
    const env = { QDRANT_URL: "qdrant.example" };

    defaultDeps.createClient(env);

    expect(createQdrantClient).toHaveBeenCalledWith(env, 120_000);
  });
});
