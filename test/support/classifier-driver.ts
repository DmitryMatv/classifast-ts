// Drives the classifier machine as the island's interpreter will: each event
// gets a fresh ctx from a fake browser, and the commands that change what a
// later ctx observes (storage, the URL, the form, timers) change the fake.
import {
  classifierView,
  initClassifier,
  updateClassifier,
  type ClassifierCommand,
  type ClassifierEvent,
  type ClassifierStart,
  type ClassifierState,
  type ClassifierView,
} from "../../src/web/classifier/classifier-machine.js";
import type { FormFields } from "../../src/web/classifier/lookup.js";
import type {
  PaywallInput,
  PaywallTimer,
  StoredPaywall,
} from "../../src/web/classifier/paywall-machine.js";
import type { AuthSnapshot } from "../../src/web/islands/services.js";
import type { ResultsResponse } from "../../src/web/results-api.js";
import { ORIGIN, PENDING, T0, form } from "./classifier-fixtures.js";

export * from "./classifier-fixtures.js";

export interface Browser {
  now: number;
  url: string;
  fields: FormFields;
  auth: AuthSnapshot;
  stored: StoredPaywall;
}

type Fetch = Extract<ClassifierCommand, { type: "fetch" }>;

export class Classifier {
  state: ClassifierState;
  readonly browser: Browser;
  /** Every command, in order. */
  readonly log: ClassifierCommand[] = [];
  private readonly timers = new Map<PaywallTimer, number>();

  constructor(start: Partial<ClassifierStart>, browser: Partial<Browser>) {
    this.state = initClassifier({
      autoload: false,
      example: null,
      title: "NAICS Classification",
      ...start,
    });
    this.browser = {
      now: T0,
      url: `${ORIGIN}/NAICS/`,
      fields: form(),
      auth: PENDING,
      stored: { upgradeIntent: null, activation: null },
      ...browser,
    };
  }

  get view(): ClassifierView {
    return classifierView(this.state);
  }

  send(event: ClassifierEvent): readonly ClassifierCommand[] {
    const [state, commands] = updateClassifier(this.state, event, {
      ...this.browser,
    });
    this.state = state;
    this.log.push(...commands);
    for (const command of commands) this.apply(command);
    return commands;
  }

  mount(): readonly ClassifierCommand[] {
    return this.send({ type: "mounted" });
  }

  setAuth(auth: AuthSnapshot): readonly ClassifierCommand[] {
    this.browser.auth = auth;
    return this.send({ type: "auth-changed" });
  }

  type(text: string): readonly ClassifierCommand[] {
    this.browser.fields = { ...this.browser.fields, text };
    return this.send({ type: "edited", field: "text" });
  }

  submit(): readonly ClassifierCommand[] {
    return this.send({ type: "submitted" });
  }

  paywall(event: PaywallInput): readonly ClassifierCommand[] {
    return this.send({ type: "paywall", event });
  }

  fetches(): Fetch[] {
    return ofType(this.log, "fetch");
  }

  lastFetch(): Fetch {
    const fetch = this.fetches().at(-1);
    if (fetch === undefined) throw new Error("no fetch yet");
    return fetch;
  }

  /** Answers the latest fetch, or the one with `seq`. */
  answer(
    answer: ResultsResponse,
    seq = this.lastFetch().seq,
  ): readonly ClassifierCommand[] {
    return this.send({ type: "answered", seq, answer });
  }

  /** Moves the clock, firing each timer that falls due on the way, in order. */
  advance(ms: number): readonly ClassifierCommand[] {
    const end = this.browser.now + ms;
    const fired: ClassifierCommand[] = [];
    for (;;) {
      const due = [...this.timers].sort((a, b) => a[1] - b[1])[0];
      if (due === undefined || due[1] > end) break;
      const [timer, at] = due;
      this.timers.delete(timer);
      this.browser.now = at;
      fired.push(...this.paywall({ type: "timer", timer }));
    }
    this.browser.now = end;
    return fired;
  }

  pendingTimers(): PaywallTimer[] {
    return [...this.timers.keys()];
  }

  private apply(command: ClassifierCommand): void {
    switch (command.type) {
      case "store":
        this.browser.stored = { ...this.browser.stored, ...command.patch };
        return;
      case "push-entry":
      case "replace-entry":
        if (command.url !== null)
          this.browser.url = new URL(command.url, this.browser.url).href;
        return;
      case "write-fields":
        this.browser.fields = command.fields;
        return;
      case "set-timer":
        this.timers.set(command.timer, this.browser.now + command.ms);
        return;
      case "clear-timer":
        this.timers.delete(command.timer);
        return;
      default:
        return;
    }
  }
}

export function ofType<T extends ClassifierCommand["type"]>(
  commands: readonly ClassifierCommand[],
  type: T,
): Extract<ClassifierCommand, { type: T }>[] {
  return commands.filter(
    (command): command is Extract<ClassifierCommand, { type: T }> =>
      command.type === type,
  );
}
