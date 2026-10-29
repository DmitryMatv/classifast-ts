// Pure and isomorphic. The classifier form's one request slot, the results
// panel and history, with the paywall machine nested inside.
import type { AuthSnapshot } from "../islands/services.js";
import type {
  ResultsAnswer,
  ResultsQuery,
  ResultsResponse,
} from "../results-api.js";
import {
  lookupOf,
  type FormFields,
  type FormSnapshot,
  type HistoryEntry,
} from "./lookup.js";
import {
  PAYWALL_INITIAL,
  updatePaywall,
  upgradeButtonView,
  type PaywallCommand,
  type PaywallEffect,
  type PaywallEvent,
  type PaywallInput,
  type PaywallState,
  type StoredPaywall,
  type UpgradeButtonView,
} from "./paywall-machine.js";

/**
 * Why a lookup runs.
 * - submit: Submit or Enter. Sends the textarea text only, so an empty
 *   textarea gets the required-field message even while the base page's
 *   example is the query.
 * - resubmit: a Top-K change, Try again, or the retry after sign-in. The
 *   textarea text, else the example.
 * - autoload: the page's own query, which the server did not classify.
 * - restore: Back/Forward to an entry whose answer was not stored.
 * - activation: a post-checkout check.
 * Only submit and resubmit answers move the URL and title.
 */
export type Origin =
  "submit" | "resubmit" | "autoload" | "restore" | "activation";

/**
 * The one request slot. A new lookup replaces the old one: the interpreter
 * aborts the previous fetch, and an answer whose seq is not the slot's is
 * dropped. Every lookup waits in `awaiting-auth` until the auth snapshot
 * settles, and reads the form only when it leaves, so edits made while
 * waiting are what gets sent.
 */
export type RequestSlot =
  | { readonly kind: "idle" }
  | { readonly kind: "awaiting-auth"; readonly origin: Origin }
  | {
      readonly kind: "in-flight";
      readonly seq: number;
      readonly origin: Origin;
      /** The form this lookup read; its history entry restores it. */
      readonly form: FormSnapshot;
    };

/** What the results container holds. */
export type Panel =
  /** The panel the server rendered, from the island props. */
  | { readonly kind: "page" }
  | {
      readonly kind: "answer";
      /** A new seq remounts the list, which replays the score bars. */
      readonly seq: number;
      readonly answer: ResultsResponse;
    };

/**
 * The page's request for its own results, before it reaches the slot.
 * `cancelled`: the visitor typed before hydration, which IslandRoot
 * reports as an edit that may arrive before `mounted`.
 */
export type Autoload = "off" | "pending" | "cancelled" | "queued";

export interface ClassifierState {
  /** The last seq handed out, to a request or to an answer restored from history. */
  readonly seq: number;
  readonly request: RequestSlot;
  /** The lookup page-hidden aborted; a persisted page-shown reruns it. The paywall restarts its own checks. */
  readonly interrupted: Exclude<Origin, "activation"> | null;
  readonly panel: Panel;
  /**
   * The base page's example while it is the query. The textarea renders
   * empty with the example as its placeholder; the first edit drops it.
   */
  readonly fallbackQuery: string | null;
  readonly autoload: Autoload;
  /** The current history entry's title, kept when an answer updates the entry. */
  readonly title: string;
  readonly paywall: PaywallState;
}

/** Server-rendered facts the machine starts from; part of the island props. */
export interface ClassifierStart {
  /** The server did not render the page's results and asks the client to load them. */
  readonly autoload: boolean;
  /** The base page's example query; null on a query page. */
  readonly example: string | null;
  /** The document title the server rendered. */
  readonly title: string;
}

/** The world as the machine may observe it, read fresh for every event. */
export interface ClassifierCtx {
  readonly now: number;
  /** location.href. */
  readonly url: string;
  readonly fields: FormFields;
  readonly auth: AuthSnapshot;
  readonly stored: StoredPaywall;
}

export type ClassifierEvent =
  /** Once, after hydration commits. */
  | { readonly type: "mounted" }
  | { readonly type: "auth-changed" }
  /** Submit button or Enter; the form has noValidate, so this is the one validation point. */
  | { readonly type: "submitted" }
  | { readonly type: "top-k-changed" }
  /** An input or change in the form other than Top-K. */
  | { readonly type: "edited"; readonly field: "text" | "version" | "enhance" }
  | {
      readonly type: "answered";
      readonly seq: number;
      readonly answer: ResultsResponse;
    }
  /** popstate, with historyEntryOf(history.state). */
  | { readonly type: "history-popped"; readonly entry: HistoryEntry | null }
  | { readonly type: "page-hidden" }
  | { readonly type: "page-shown"; readonly persisted: boolean }
  | { readonly type: "paywall"; readonly event: PaywallInput };

export type ClassifierCommand =
  /**
   * Abort any fetch in flight, then api.results(classifierType, query) and
   * send its answer as `answered` with this seq.
   */
  | {
      readonly type: "fetch";
      readonly seq: number;
      readonly query: ResultsQuery;
    }
  /** Abort the fetch in flight; it sends nothing. */
  | { readonly type: "abort-fetch" }
  /**
   * history.pushState with the entry under HISTORY_STATE_KEY (other keys
   * kept), then document.title = entry.title.
   */
  | {
      readonly type: "push-entry";
      readonly url: string;
      readonly entry: HistoryEntry;
    }
  /** As push-entry with replaceState; a null url keeps the current one. */
  | {
      readonly type: "replace-entry";
      readonly url: string | null;
      readonly entry: HistoryEntry;
    }
  | { readonly type: "set-title"; readonly title: string }
  /** Set the controls' values without dispatching input or change. */
  | { readonly type: "write-fields"; readonly fields: FormFields }
  /** The textarea's native required-field message, also when it holds only whitespace. */
  | { readonly type: "report-empty-query" }
  | PaywallEffect;

type Step = readonly [ClassifierState, readonly ClassifierCommand[]];

const IDLE: RequestSlot = { kind: "idle" };

function then(step: Step, next: (state: ClassifierState) => Step): Step {
  const [after, more] = next(step[0]);
  return [after, [...step[1], ...more]];
}

/** Props only, so the hydration render equals the server render. */
export function initClassifier(start: ClassifierStart): ClassifierState {
  return {
    seq: 0,
    request: IDLE,
    interrupted: null,
    panel: { kind: "page" },
    fallbackQuery: start.example,
    autoload: start.autoload ? "pending" : "off",
    title: start.title,
    paywall: PAYWALL_INITIAL,
  };
}

function abortInFlight(state: ClassifierState): ClassifierCommand[] {
  return state.request.kind === "in-flight" ? [{ type: "abort-fetch" }] : [];
}

function startLookup(
  state: ClassifierState,
  origin: Origin,
  ctx: ClassifierCtx,
  form: FormSnapshot = {
    fields: ctx.fields,
    fallbackQuery: state.fallbackQuery,
  },
): Step {
  if (ctx.auth.status === "pending")
    return [
      { ...state, request: { kind: "awaiting-auth", origin } },
      abortInFlight(state),
    ];
  const query = lookupOf(
    form.fields,
    origin === "submit" ? null : form.fallbackQuery,
  );
  if (query === null) {
    const report: ClassifierCommand[] =
      origin === "submit" || origin === "resubmit"
        ? [{ type: "report-empty-query" }]
        : [];
    return [{ ...state, request: IDLE }, [...abortInFlight(state), ...report]];
  }
  const seq = state.seq + 1;
  return [
    { ...state, seq, request: { kind: "in-flight", seq, origin, form } },
    [{ type: "fetch", seq, query }],
  ];
}

function releaseAwaiting(state: ClassifierState, ctx: ClassifierCtx): Step {
  if (state.request.kind !== "awaiting-auth" || ctx.auth.status === "pending")
    return [state, []];
  return startLookup(state, state.request.origin, ctx);
}

/** Starting an activation always checks: a queued autoload or restore becomes the check. */
function checkActivation(state: ClassifierState, ctx: ClassifierCtx): Step {
  const { request } = state;
  const reusable =
    request.kind !== "idle" &&
    (request.origin === "autoload" ||
      request.origin === "restore" ||
      request.origin === "activation");
  if (!reusable) return startLookup(state, "activation", ctx);
  return [{ ...state, request: { ...request, origin: "activation" } }, []];
}

function abortActivation(state: ClassifierState): Step {
  const { request } = state;
  if (request.kind === "idle" || request.origin !== "activation")
    return [state, []];
  return [{ ...state, request: IDLE }, abortInFlight(state)];
}

function runPaywallCommand(
  state: ClassifierState,
  command: PaywallCommand,
  ctx: ClassifierCtx,
): Step {
  switch (command.type) {
    case "check-activation":
      return checkActivation(state, ctx);
    case "abort-activation":
      return abortActivation(state);
    case "retry-lookup":
      return startLookup(state, "resubmit", ctx);
    default:
      return [state, [command]];
  }
}

function withPaywall(
  state: ClassifierState,
  event: PaywallEvent,
  ctx: ClassifierCtx,
): Step {
  const { panel } = state;
  const [paywall, commands] = updatePaywall(state.paywall, event, {
    now: ctx.now,
    url: ctx.url,
    auth: ctx.auth,
    stored: ctx.stored,
    showingPaywall: panel.kind === "answer" && panel.answer.kind === "paywall",
  });
  return commands.reduce<Step>(
    (step, command) =>
      then(step, (next) => runPaywallCommand(next, command, ctx)),
    [{ ...state, paywall }, []],
  );
}

function mounted(state: ClassifierState, ctx: ClassifierCtx): Step {
  const entry: HistoryEntry = {
    v: 1,
    fields: ctx.fields,
    fallbackQuery: state.fallbackQuery,
    title: state.title,
    show: { kind: state.autoload === "off" ? "page" : "lookup" },
  };
  const queued: ClassifierState =
    state.autoload === "pending"
      ? {
          ...state,
          autoload: "queued",
          request: { kind: "awaiting-auth", origin: "autoload" },
        }
      : state;
  return then(
    then([queued, [{ type: "replace-entry", url: null, entry }]], (next) =>
      withPaywall(next, { type: "mounted" }, ctx),
    ),
    (next) => releaseAwaiting(next, ctx),
  );
}

function edited(
  state: ClassifierState,
  field: "text" | "version" | "enhance",
  ctx: ClassifierCtx,
): Step {
  const { request } = state;
  const typed: ClassifierState =
    field !== "text"
      ? state
      : {
          ...state,
          fallbackQuery: null,
          autoload: state.autoload === "pending" ? "cancelled" : state.autoload,
          request:
            request.kind === "awaiting-auth" && request.origin === "autoload"
              ? IDLE
              : request,
        };
  return withPaywall(typed, { type: "form-touched" }, ctx);
}

function submitted(state: ClassifierState, ctx: ClassifierCtx): Step {
  if (lookupOf(ctx.fields, null) === null)
    return [state, [{ type: "report-empty-query" }]];
  return then(withPaywall(state, { type: "form-touched" }, ctx), (next) =>
    startLookup(next, "submit", ctx),
  );
}

function topKChanged(state: ClassifierState, ctx: ClassifierCtx): Step {
  return then(withPaywall(state, { type: "form-touched" }, ctx), (next) =>
    lookupOf(ctx.fields, next.fallbackQuery) === null
      ? [next, []]
      : startLookup(next, "resubmit", ctx),
  );
}

/** Same origin, path and query; the hash does not count. */
function samePage(url: string, current: string): boolean {
  const page = new URL(url, current);
  const here = new URL(current);
  return (
    page.origin === here.origin &&
    page.pathname === here.pathname &&
    page.search === here.search
  );
}

function recordAnswer(
  state: ClassifierState,
  origin: Origin,
  form: FormSnapshot,
  answer: ResultsResponse,
  ctx: ClassifierCtx,
): Step {
  const show =
    answer.kind === "results" ? answer : ({ kind: "lookup" } as const);
  if (origin === "submit" || origin === "resubmit") {
    if (answer.kind !== "results" && answer.kind !== "paywall")
      return [state, []];
    const entry: HistoryEntry = { v: 1, ...form, title: answer.title, show };
    const command: ClassifierCommand = samePage(answer.url, ctx.url)
      ? { type: "replace-entry", url: answer.url, entry }
      : { type: "push-entry", url: answer.url, entry };
    return [{ ...state, title: answer.title }, [command]];
  }
  if (answer.kind !== "results") return [state, []];
  const entry: HistoryEntry = { v: 1, ...form, title: state.title, show };
  return [state, [{ type: "replace-entry", url: null, entry }]];
}

function answered(
  state: ClassifierState,
  seq: number,
  answer: ResultsResponse,
  ctx: ClassifierCtx,
): Step {
  const { request } = state;
  if (request.kind !== "in-flight" || request.seq !== seq) return [state, []];
  const shown: ClassifierState = {
    ...state,
    request: IDLE,
    panel: { kind: "answer", seq, answer },
  };
  return then(
    recordAnswer(shown, request.origin, request.form, answer, ctx),
    (next) =>
      next.paywall.activation.kind === "off"
        ? [next, []]
        : withPaywall(next, { type: "activation-answered", answer }, ctx),
  );
}

function showStored(
  state: ClassifierState,
  answer: ResultsAnswer,
): ClassifierState {
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    request: IDLE,
    panel: { kind: "answer", seq, answer },
  };
}

function historyPopped(
  state: ClassifierState,
  entry: HistoryEntry | null,
  ctx: ClassifierCtx,
): Step {
  if (entry === null) return [state, []];
  const restored: Step = [
    {
      ...state,
      fallbackQuery: entry.fallbackQuery,
      title: entry.title,
      interrupted: null,
    },
    [
      { type: "write-fields", fields: entry.fields },
      { type: "set-title", title: entry.title },
    ],
  ];
  const suspended = then(restored, (next) =>
    withPaywall(next, { type: "suspended" }, ctx),
  );
  const shown = then(suspended, (next): Step => {
    const { show } = entry;
    if (show.kind === "lookup")
      return startLookup(next, "restore", ctx, {
        fields: entry.fields,
        fallbackQuery: entry.fallbackQuery,
      });
    const idle = abortInFlight(next);
    if (show.kind === "page")
      return [{ ...next, request: IDLE, panel: { kind: "page" } }, idle];
    return [showStored(next, show), idle];
  });
  return then(shown, (next) => withPaywall(next, { type: "resumed" }, ctx));
}

function pageHidden(state: ClassifierState, ctx: ClassifierCtx): Step {
  const { request } = state;
  const hidden: Step =
    request.kind === "in-flight"
      ? [
          {
            ...state,
            request: IDLE,
            interrupted:
              request.origin === "activation" ? null : request.origin,
          },
          [{ type: "abort-fetch" }],
        ]
      : [state, []];
  return then(hidden, (next) => withPaywall(next, { type: "suspended" }, ctx));
}

function pageShown(
  state: ClassifierState,
  persisted: boolean,
  ctx: ClassifierCtx,
): Step {
  if (!persisted) return [state, []];
  return then(withPaywall(state, { type: "resumed" }, ctx), (next) => {
    const { interrupted } = next;
    const cleared = { ...next, interrupted: null };
    if (interrupted === null || next.request.kind !== "idle")
      return [cleared, []];
    return startLookup(cleared, interrupted, ctx);
  });
}

/**
 * mounted: replace the current history entry with the first one (`page`,
 *   or `lookup` when the page autoloads), queue the autoload unless an
 *   edit cancelled it, mount the paywall (an activation it starts takes
 *   the autoload over as its check, or runs one), then send whatever is
 *   queued once auth has settled.
 * auth-changed: the paywall first (it may stop an activation or retry
 *   after sign-in), then a settled snapshot releases `awaiting-auth`.
 * submitted: an empty textarea reports the required-field message and
 *   nothing else. Otherwise the paywall's activation stops and a submit
 *   lookup replaces the slot.
 * top-k-changed: the activation stops; a resubmit runs when there is a
 *   query (the textarea or the example), else nothing.
 * edited: the paywall's activation stops. A text edit drops the example
 *   and cancels an autoload that has not been sent.
 * answered: ignored unless seq is the slot's. The panel shows the answer.
 *   A submit or resubmit answer with a page pushes its entry and title, or
 *   replaces the entry when it is the current URL; a results answer of any
 *   other origin is stored in the current entry. An activation that is not
 *   off hears the answer.
 * history-popped: an entry that is not ours changes nothing. Otherwise
 *   write the entry's fields and title, suspend the paywall, show the page
 *   panel or the stored results with no request, or run a restore lookup,
 *   then resume the paywall for the new URL.
 * page-hidden: abort the fetch in flight and remember its origin; suspend
 *   the paywall. page-shown(persisted): resume the paywall, then rerun the
 *   interrupted lookup unless an activation check took the slot.
 * paywall: forwarded to the paywall machine.
 */
export function updateClassifier(
  state: ClassifierState,
  event: ClassifierEvent,
  ctx: ClassifierCtx,
): Step {
  switch (event.type) {
    case "mounted":
      return mounted(state, ctx);
    case "auth-changed":
      return then(withPaywall(state, { type: "auth-changed" }, ctx), (next) =>
        releaseAwaiting(next, ctx),
      );
    case "submitted":
      return submitted(state, ctx);
    case "top-k-changed":
      return topKChanged(state, ctx);
    case "edited":
      return edited(state, event.field, ctx);
    case "answered":
      return answered(state, event.seq, event.answer, ctx);
    case "history-popped":
      return historyPopped(state, event.entry, ctx);
    case "page-hidden":
      return pageHidden(state, ctx);
    case "page-shown":
      return pageShown(state, event.persisted, ctx);
    case "paywall":
      return withPaywall(state, event.event, ctx);
  }
}

/** Everything the results panel renders. */
export type PanelView =
  | { readonly kind: "page" }
  | {
      readonly kind: "results";
      readonly key: number;
      readonly answer: ResultsAnswer;
    }
  | {
      readonly kind: "paywall";
      readonly signedIn: boolean;
      readonly limit: number;
      readonly upgrade: UpgradeButtonView;
      /** "Payment activation is still pending. Try again." after an activation stopped. */
      readonly activationStopped: boolean;
    }
  /**
   * Heading "Payment activation is pending" and a role=status line, with no
   * Upgrade or Sign In. `checking`: "Checking automatically..." and Try
   * again disabled. `delayed` and `stopped`: "still pending. Try again."
   */
  | {
      readonly kind: "activation";
      readonly phase: "checking" | "delayed" | "stopped";
    }
  | { readonly kind: "busy"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface ClassifierView {
  /** The spinner: a lookup waits for auth or is in flight. */
  readonly loading: boolean;
  readonly panel: PanelView;
}

function panelView(state: ClassifierState): PanelView {
  const { panel, paywall } = state;
  const { activation } = paywall;
  if (activation.kind === "checking" || activation.kind === "delayed")
    return {
      kind: "activation",
      phase: activation.kind === "checking" ? "checking" : "delayed",
    };
  const stopped = activation.kind === "stopped";
  if (panel.kind === "page")
    return stopped
      ? { kind: "activation", phase: "stopped" }
      : { kind: "page" };
  const { answer } = panel;
  switch (answer.kind) {
    case "paywall":
      return {
        kind: "paywall",
        signedIn: answer.signedIn,
        limit: answer.limit,
        upgrade: upgradeButtonView(paywall.checkout),
        activationStopped: stopped,
      };
    case "results":
      return stopped
        ? { kind: "activation", phase: "stopped" }
        : { kind: "results", key: panel.seq, answer };
    case "busy":
    case "error":
      return stopped
        ? { kind: "activation", phase: "stopped" }
        : { kind: answer.kind, message: answer.message };
  }
}

export function classifierView(state: ClassifierState): ClassifierView {
  return { loading: state.request.kind !== "idle", panel: panelView(state) };
}
