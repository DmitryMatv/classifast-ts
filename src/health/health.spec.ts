import { vi } from "vitest";
import { HEALTH_PROBE_TIMEOUT_MS, isHealthy } from "./health.js";

describe("isHealthy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is healthy when the embedding client exists and Qdrant answers", async () => {
    await expect(
      isHealthy({ embeddingReady: true, probeQdrant: async () => ({}) }),
    ).resolves.toBe(true);
  });

  it("is unhealthy without probing Qdrant when embedding is missing", async () => {
    const probeQdrant = vi.fn(async () => ({}));

    await expect(
      isHealthy({ embeddingReady: false, probeQdrant }),
    ).resolves.toBe(false);
    expect(probeQdrant).not.toHaveBeenCalled();
  });

  it("is unhealthy when the Qdrant probe fails", async () => {
    await expect(
      isHealthy({
        embeddingReady: true,
        probeQdrant: () => Promise.reject(new Error("connection refused")),
      }),
    ).resolves.toBe(false);
  });

  it("is unhealthy when Qdrant does not answer within the timeout", async () => {
    vi.useFakeTimers();
    const pending = isHealthy({
      embeddingReady: true,
      probeQdrant: () => new Promise(() => {}),
    });

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS);

    await expect(pending).resolves.toBe(false);
  });
});
