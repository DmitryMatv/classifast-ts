export const QUEUE_CAPACITY = 5; // one active classification plus four waiting

export class ClassificationQueueFull extends Error {
  constructor() {
    super("Classification queue is full. Please try again later.");
    this.name = "ClassificationQueueFull";
  }
}

export class ClassificationQueueClosed extends Error {
  constructor() {
    super("Classification queue is closed");
    this.name = "ClassificationQueueClosed";
  }
}

interface WaitingJob {
  start(): void;
  reject(reason: unknown): void;
}

/**
 * Serializes complete classifications: one active job and up to four waiting
 * jobs, started in arrival order.
 *
 * Aborting `signal` while a job waits removes it without running `work`.
 * Aborting it while the job is active rejects the caller at once, but the job
 * keeps its turn and slot until the promise returned by `work` settles. `work`
 * receives the same signal, so a stage that honours it ends promptly and a
 * stage that ignores it runs to completion first.
 */
export class ClassificationQueue {
  readonly #waiting: WaitingJob[] = [];
  #active: Promise<void> | undefined;
  #drained: Promise<void> | undefined;

  async run<T>(
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.#drained) throw new ClassificationQueueClosed();
    if (this.#waiting.length + (this.#active ? 1 : 0) >= QUEUE_CAPACITY) {
      throw new ClassificationQueueFull();
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const index = this.#waiting.indexOf(job);
        if (index !== -1) this.#waiting.splice(index, 1);
        reject(signal.reason);
      };
      const job: WaitingJob = {
        start: () => {
          this.#active = Promise.resolve()
            .then(() => work(signal))
            .then(resolve, reject)
            .finally(() => {
              signal.removeEventListener("abort", onAbort);
              this.#active = undefined;
              this.#waiting.shift()?.start();
            });
        },
        reject: (reason) => {
          signal.removeEventListener("abort", onAbort);
          reject(reason);
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (this.#active) this.#waiting.push(job);
      else job.start();
    });
  }

  /** Rejects waiting jobs and resolves once the active job's work settles. */
  close(): Promise<void> {
    if (!this.#drained) {
      for (const job of this.#waiting.splice(0)) {
        job.reject(new ClassificationQueueClosed());
      }
      this.#drained = this.#active ?? Promise.resolve();
    }
    return this.#drained;
  }
}
