// Pure and isomorphic. The paywall's checkout and the post-checkout
// activation check as one reducer. It runs inside the classifier machine,
// which owns the request slot: this machine asks the parent for lookups
// and is told their answers.
import type {
  AuthSnapshot,
  CheckoutOutcome,
  SignInPurpose,
} from "../islands/services.js";
import type { ResultsResponse } from "../results-api.js";

const ACTIVATION_WINDOW_MS = 60_000;
const ACTIVATION_RETRY_MS = 2_000;
const CHECKOUT_ERROR_MS = 3_000;

export interface ActivationRecord {
  readonly returnUrl: string;
  /** Epoch milliseconds. Absolute, so a reload or a bfcache return keeps the window. */
  readonly deadline: number;
}

/**
 * The paywall's sessionStorage records. Keys and value shapes are the ones
 * paywall.ts writes: a payer whose checkout began on a page that still ran
 * paywall.ts resumes on an island page.
 */
export interface StoredPaywall {
  /** `classifast:upgrade-intent`: the return URL of an Upgrade waiting for sign-in. */
  readonly upgradeIntent: string | null;
  /** `classifast:checkout-recovery`: JSON `{returnUrl, deadline}`. */
  readonly activation: ActivationRecord | null;
}

const UPGRADE_INTENT_KEY = "classifast:upgrade-intent";
const ACTIVATION_KEY = "classifast:checkout-recovery";

function activationRecordOf(raw: string | null): ActivationRecord | null {
  if (raw === null) return null;
  let record: unknown;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof record === "object" &&
    record !== null &&
    "returnUrl" in record &&
    "deadline" in record &&
    typeof record.returnUrl === "string" &&
    typeof record.deadline === "number" &&
    Number.isFinite(record.deadline)
  )
    return { returnUrl: record.returnUrl, deadline: record.deadline };
  return null;
}

/** Parses the records at the storage boundary; `read` returns null for a missing key. */
export function readStoredPaywall(
  read: (key: string) => string | null,
): StoredPaywall {
  return {
    upgradeIntent: read(UPGRADE_INTENT_KEY),
    activation: activationRecordOf(read(ACTIVATION_KEY)),
  };
}

/** The sessionStorage writes a `store` command stands for; null removes the key. */
export function storedPaywallWrites(
  patch: Partial<StoredPaywall>,
): (readonly [key: string, value: string | null])[] {
  const writes: (readonly [string, string | null])[] = [];
  if (patch.upgradeIntent !== undefined)
    writes.push([UPGRADE_INTENT_KEY, patch.upgradeIntent]);
  if (patch.activation !== undefined) {
    const record = patch.activation;
    writes.push([
      ACTIVATION_KEY,
      record &&
        JSON.stringify({
          returnUrl: record.returnUrl,
          deadline: record.deadline,
        }),
    ]);
  }
  return writes;
}

const CHECKOUT_PARAMS = [
  "checkout",
  "checkout_token",
  "customer_session_token",
];

function routeOf(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const name of CHECKOUT_PARAMS) url.searchParams.delete(name);
  url.searchParams.sort();
  return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
}

/**
 * Same origin, path and query, ignoring the checkout parameters and the
 * order of the rest. A stored record or intent counts only on its route.
 */
export function sameRoute(left: string, right: string): boolean {
  const route = routeOf(left);
  return route !== null && route === routeOf(right);
}

function isCheckoutReturn(href: string): boolean {
  return new URL(href).searchParams.get("checkout") === "success";
}

/** The Upgrade flow. */
export type Checkout =
  | { readonly kind: "idle" }
  /** Upgrade waits for a usable session. Mirrors the stored upgrade intent. */
  | { readonly kind: "awaiting-sign-in"; readonly returnUrl: string }
  /** Signing out or switching user abandons it. */
  | { readonly kind: "creating"; readonly userId: string }
  | { readonly kind: "redirecting" }
  /** "Error - Try again" for CHECKOUT_ERROR_MS. Never re-creates on its own. */
  | { readonly kind: "failed" };

/**
 * After a checkout returns, rerun the lookup until it answers results or
 * the deadline passes: the Pro tier arrives with Polar's webhook, which can
 * land after the payer does.
 */
export type Activation =
  | { readonly kind: "off" }
  | {
      readonly kind: "checking";
      readonly returnUrl: string;
      readonly deadline: number;
      /** A check is queued or in flight, versus waiting on the retry timer. */
      readonly attempt: "lookup" | "waiting";
    }
  /** The deadline passed: "still pending. Try again." */
  | { readonly kind: "delayed"; readonly returnUrl: string }
  /**
   * The visitor edited, submitted or signed out: checks stopped and the
   * record is gone. Its notice stays on the panel until the next answer.
   */
  | { readonly kind: "stopped" };

export interface PaywallState {
  readonly checkout: Checkout;
  readonly activation: Activation;
  /** The last auth seen had a usable session; false to true is "became usable". */
  readonly sessionUsable: boolean;
}

export const PAYWALL_INITIAL: PaywallState = {
  checkout: { kind: "idle" },
  activation: { kind: "off" },
  sessionUsable: false,
};

export interface PaywallCtx {
  readonly now: number;
  readonly url: string;
  readonly auth: AuthSnapshot;
  /** Storage as it was before this event; read only by mounted and resumed, before any write. */
  readonly stored: StoredPaywall;
  /** The panel shows a paywall answer, which the retry after sign-in reruns. */
  readonly showingPaywall: boolean;
}

export type PaywallTimer =
  "activation-retry" | "activation-deadline" | "checkout-error";

/** Events the island forwards from the panel, the auth service and the interpreter. */
export type PaywallInput =
  | { readonly type: "sign-in-clicked" }
  | { readonly type: "upgrade-clicked" }
  | { readonly type: "retry-clicked" }
  /** auth.onSignInRequested: a plain sign-in anywhere on the page drops a pending Upgrade. */
  | { readonly type: "sign-in-requested"; readonly purpose: SignInPurpose }
  | { readonly type: "checkout-settled"; readonly outcome: CheckoutOutcome }
  | { readonly type: "timer"; readonly timer: PaywallTimer };

/** Messages only the classifier machine sends. */
export type ParentMessage =
  | { readonly type: "mounted" }
  | { readonly type: "auth-changed" }
  /** A lookup answered while the activation is not off. */
  | { readonly type: "activation-answered"; readonly answer: ResultsResponse }
  /** The visitor edited the form or submitted it. */
  | { readonly type: "form-touched" }
  /** pagehide, or Back/Forward leaving the entry. */
  | { readonly type: "suspended" }
  /** A persisted pageshow, or Back/Forward arriving at an entry. */
  | { readonly type: "resumed" };

export type PaywallEvent = PaywallInput | ParentMessage;

/** Requests the classifier machine carries out; they never reach the interpreter. */
export type ParentRequest =
  /** Run the current query as an activation lookup, reusing a queued autoload or restore. */
  | { readonly type: "check-activation" }
  /** Drop the activation lookup the slot holds, queued or in flight. */
  | { readonly type: "abort-activation" }
  /** Try again, and the retry after sign-in: a resubmit lookup. */
  | { readonly type: "retry-lookup" };

/** Effects the island's interpreter runs. */
export type PaywallEffect =
  /** auth.openSignIn(purpose). */
  | { readonly type: "open-sign-in"; readonly purpose: SignInPurpose }
  /**
   * api.checkout(returnUrl), bounded by 30 s, settled as `checkout-settled`.
   * Replaces a creation in flight; an aborted creation never settles.
   */
  | { readonly type: "create-checkout"; readonly returnUrl: string }
  | { readonly type: "abort-checkout" }
  /** runtime.navigate(url). */
  | { readonly type: "navigate"; readonly url: string }
  /** Apply storedPaywallWrites(patch) to sessionStorage, ignoring storage errors. */
  | { readonly type: "store"; readonly patch: Partial<StoredPaywall> }
  /** One timer per name: setting replaces it; it fires as `timer`. */
  | {
      readonly type: "set-timer";
      readonly timer: PaywallTimer;
      readonly ms: number;
    }
  | { readonly type: "clear-timer"; readonly timer: PaywallTimer };

export type PaywallCommand = ParentRequest | PaywallEffect;

type Step = readonly [PaywallState, readonly PaywallCommand[]];

function then(step: Step, next: (state: PaywallState) => Step): Step {
  const [after, more] = next(step[0]);
  return [after, [...step[1], ...more]];
}

function dropIntent(state: PaywallState): Step {
  if (state.checkout.kind !== "awaiting-sign-in") return [state, []];
  return [
    { ...state, checkout: { kind: "idle" } },
    [{ type: "store", patch: { upgradeIntent: null } }],
  ];
}

function startActivation(
  state: PaywallState,
  record: ActivationRecord,
  ctx: PaywallCtx,
): Step {
  return then(dropIntent(state), (cleared) => {
    const store = { type: "store", patch: { activation: record } } as const;
    if (record.deadline <= ctx.now)
      return [
        {
          ...cleared,
          activation: { kind: "delayed", returnUrl: record.returnUrl },
        },
        [store],
      ];
    return [
      {
        ...cleared,
        activation: { kind: "checking", ...record, attempt: "lookup" },
      },
      [
        store,
        {
          type: "set-timer",
          timer: "activation-deadline",
          ms: record.deadline - ctx.now,
        },
        { type: "check-activation" },
      ],
    ];
  });
}

/** Stored activation for this route first; else, only on load, `?checkout=success`. */
function restoreActivation(
  state: PaywallState,
  ctx: PaywallCtx,
  fromUrl: boolean,
): Step {
  const record = ctx.stored.activation;
  if (record !== null && sameRoute(record.returnUrl, ctx.url))
    return startActivation(state, record, ctx);
  const discard: Step = [
    state,
    record === null ? [] : [{ type: "store", patch: { activation: null } }],
  ];
  if (!fromUrl || !isCheckoutReturn(ctx.url)) return discard;
  return then(discard, (next) =>
    startActivation(
      next,
      { returnUrl: ctx.url, deadline: ctx.now + ACTIVATION_WINDOW_MS },
      ctx,
    ),
  );
}

/** Cancels what a running activation has pending: its deadline, and its retry timer or its check. */
function haltChecks(activation: Activation): PaywallCommand[] {
  if (activation.kind !== "checking") return [];
  return [
    { type: "clear-timer", timer: "activation-deadline" },
    activation.attempt === "waiting"
      ? { type: "clear-timer", timer: "activation-retry" }
      : { type: "abort-activation" },
  ];
}

function stopActivation(state: PaywallState): Step {
  const { activation } = state;
  if (activation.kind !== "checking" && activation.kind !== "delayed")
    return [state, []];
  return [
    { ...state, activation: { kind: "stopped" } },
    [{ type: "store", patch: { activation: null } }, ...haltChecks(activation)],
  ];
}

function expire(state: PaywallState): Step {
  const { activation } = state;
  if (activation.kind !== "checking") return [state, []];
  return [
    {
      ...state,
      activation: { kind: "delayed", returnUrl: activation.returnUrl },
    },
    haltChecks(activation),
  ];
}

function abandonCheckout(state: PaywallState): Step {
  if (state.checkout.kind !== "creating") return [state, []];
  return [
    { ...state, checkout: { kind: "idle" } },
    [{ type: "abort-checkout" }],
  ];
}

function createCheckout(
  state: PaywallState,
  userId: string,
  returnUrl: string,
): Step {
  return then(dropIntent(state), (cleared) => [
    {
      ...cleared,
      checkout: { kind: "creating", userId },
      sessionUsable: true,
    },
    [{ type: "create-checkout", returnUrl }],
  ]);
}

function observeAuth(state: PaywallState, ctx: PaywallCtx): Step {
  const { auth } = ctx;
  if (auth.status === "pending") return [state, []];
  if (auth.status !== "signed-in")
    return then(
      stopActivation({ ...state, sessionUsable: false }),
      abandonCheckout,
    );
  const kept =
    state.checkout.kind === "creating" && state.checkout.userId !== auth.userId
      ? abandonCheckout(state)
      : ([state, []] as const);
  if (!auth.sessionUsable) return kept;
  return then(kept, (current) => {
    const becameUsable = !current.sessionUsable;
    const usable = { ...current, sessionUsable: true };
    const { checkout } = usable;
    if (
      checkout.kind === "awaiting-sign-in" &&
      sameRoute(checkout.returnUrl, ctx.url)
    )
      return createCheckout(usable, auth.userId, checkout.returnUrl);
    return then(dropIntent(usable), (next) =>
      retryAfterSignIn(next, ctx, becameUsable),
    );
  });
}

/** The automatic retry after Sign In: rerun the lookup the paywall refused. */
function retryAfterSignIn(
  state: PaywallState,
  ctx: PaywallCtx,
  becameUsable: boolean,
): Step {
  const { checkout, activation } = state;
  const showsRefusal =
    activation.kind === "stopped" ||
    (activation.kind === "off" && ctx.showingPaywall);
  if (!becameUsable || checkout.kind !== "idle" || !showsRefusal)
    return [state, []];
  return [state, [{ type: "retry-lookup" }]];
}

function settleCheckout(
  state: PaywallState,
  outcome: CheckoutOutcome,
  ctx: PaywallCtx,
): Step {
  const { checkout } = state;
  if (checkout.kind !== "creating") return [state, []];
  const sameUser =
    ctx.auth.status === "signed-in" && ctx.auth.userId === checkout.userId;
  if (!sameUser) return [{ ...state, checkout: { kind: "idle" } }, []];
  if (outcome.kind === "redirect")
    return [
      { ...state, checkout: { kind: "redirecting" } },
      [{ type: "navigate", url: outcome.url }],
    ];
  return [
    { ...state, checkout: { kind: "failed" } },
    [{ type: "set-timer", timer: "checkout-error", ms: CHECKOUT_ERROR_MS }],
  ];
}

function answered(
  state: PaywallState,
  answer: ResultsResponse,
  ctx: PaywallCtx,
): Step {
  const { activation } = state;
  if (activation.kind === "stopped")
    return [{ ...state, activation: { kind: "off" } }, []];
  if (activation.kind !== "checking") return [state, []];
  if (answer.kind === "results")
    return [
      { ...state, activation: { kind: "off" } },
      [
        { type: "store", patch: { activation: null } },
        { type: "clear-timer", timer: "activation-deadline" },
      ],
    ];
  if (ctx.now >= activation.deadline) return expire(state);
  return [
    { ...state, activation: { ...activation, attempt: "waiting" } },
    [
      {
        type: "set-timer",
        timer: "activation-retry",
        ms: Math.min(ACTIVATION_RETRY_MS, activation.deadline - ctx.now),
      },
    ],
  ];
}

function timerFired(
  state: PaywallState,
  timer: PaywallTimer,
  ctx: PaywallCtx,
): Step {
  const { activation, checkout } = state;
  switch (timer) {
    case "checkout-error":
      return checkout.kind === "failed"
        ? [{ ...state, checkout: { kind: "idle" } }, []]
        : [state, []];
    case "activation-deadline":
      return expire(state);
    case "activation-retry":
      if (activation.kind !== "checking" || activation.attempt !== "waiting")
        return [state, []];
      if (ctx.now >= activation.deadline) return expire(state);
      return [
        { ...state, activation: { ...activation, attempt: "lookup" } },
        [{ type: "check-activation" }],
      ];
  }
}

function upgrade(state: PaywallState, ctx: PaywallCtx): Step {
  const { activation, checkout } = state;
  if (
    activation.kind === "checking" ||
    activation.kind === "delayed" ||
    checkout.kind === "creating" ||
    checkout.kind === "redirecting"
  )
    return [state, []];
  const { auth } = ctx;
  if (auth.status === "signed-in" && auth.sessionUsable)
    return createCheckout(state, auth.userId, ctx.url);
  return [
    { ...state, checkout: { kind: "awaiting-sign-in", returnUrl: ctx.url } },
    [
      { type: "store", patch: { upgradeIntent: ctx.url } },
      { type: "open-sign-in", purpose: "upgrade" },
    ],
  ];
}

function retry(state: PaywallState, ctx: PaywallCtx): Step {
  return then(dropIntent(state), (cleared) => {
    const { activation } = cleared;
    if (activation.kind === "checking") return [cleared, []];
    if (activation.kind === "delayed")
      return startActivation(
        cleared,
        {
          returnUrl: activation.returnUrl,
          deadline: ctx.now + ACTIVATION_WINDOW_MS,
        },
        ctx,
      );
    return [cleared, [{ type: "retry-lookup" }]];
  });
}

/** The intent recorded at mount, kept only on its route. */
function restoreIntent(state: PaywallState, ctx: PaywallCtx): Step {
  const intent = ctx.stored.upgradeIntent;
  if (intent === null) return [state, []];
  if (sameRoute(intent, ctx.url))
    return [
      { ...state, checkout: { kind: "awaiting-sign-in", returnUrl: intent } },
      [],
    ];
  return [state, [{ type: "store", patch: { upgradeIntent: null } }]];
}

/** The record stays, so a return to this page resumes the activation. */
function suspend(state: PaywallState): Step {
  const { activation, checkout } = state;
  const left = checkout.kind === "creating" || checkout.kind === "redirecting";
  return [
    {
      ...state,
      activation: { kind: "off" },
      checkout: left ? { kind: "idle" } : checkout,
    },
    [
      ...haltChecks(activation),
      ...(checkout.kind === "creating"
        ? [{ type: "abort-checkout" } as const]
        : []),
    ],
  ];
}

function resume(state: PaywallState, ctx: PaywallCtx): Step {
  const { checkout } = state;
  const intent: Step =
    checkout.kind === "awaiting-sign-in" &&
    !sameRoute(checkout.returnUrl, ctx.url)
      ? dropIntent(state)
      : [state, []];
  if (state.activation.kind !== "off") return intent;
  return then(intent, (next) => restoreActivation(next, ctx, false));
}

/**
 * The paywall's moves, by event.
 *
 * mounted: restore the upgrade intent when it names this route (else
 *   remove it), then the activation: the stored record for this route
 *   keeps its deadline, else `?checkout=success` starts one ending
 *   ACTIVATION_WINDOW_MS from now. Starting drops the intent, stores the
 *   record and asks for a check at once, so the base page, which renders
 *   its example's results and has no autoload, is checked too. A deadline
 *   already passed starts in `delayed`. Then auth as for auth-changed.
 * auth-changed: no user (signed out or unavailable) stops the activation
 *   and abandons a checkout being created; so does another user. A session
 *   that became usable creates the checkout an Upgrade awaits on this
 *   route; otherwise, with the checkout idle and the panel refusing (a
 *   paywall, or a stopped activation's notice), it reruns the lookup.
 * activation-answered: results end the activation and remove the record.
 *   Anything else waits min(ACTIVATION_RETRY_MS, deadline - now), or goes
 *   to `delayed` past the deadline. In `stopped` any answer clears the
 *   notice.
 * timer: the retry asks for the next check; the deadline aborts the check
 *   and moves to `delayed`; the checkout error returns to idle.
 * form-touched, and signing out: `stopped`, record removed.
 * suspended: the activation goes off with its record kept; a checkout
 *   being created is abandoned. resumed: an intent for another route is
 *   dropped, and an activation that is off restarts from its stored record
 *   for this route (the URL's `?checkout=success` counts only at mount).
 * upgrade-clicked: ignored during an activation or a checkout in progress.
 *   A usable session creates the checkout for this page; otherwise the
 *   intent is stored and sign-in opens with purpose `upgrade`.
 * retry-clicked (Try again): drops the intent; in `delayed` restarts the
 *   activation with a fresh window; ignored while checking; else reruns
 *   the lookup.
 * sign-in-clicked: drops the intent and opens a plain sign-in.
 *   sign-in-requested(plain) drops the intent.
 * checkout-settled: only for the creation in progress and its user;
 *   redirect navigates, failure shows the error for CHECKOUT_ERROR_MS.
 */
export function updatePaywall(
  state: PaywallState,
  event: PaywallEvent,
  ctx: PaywallCtx,
): Step {
  switch (event.type) {
    case "mounted":
      return then(
        then(restoreIntent(state, ctx), (next) =>
          restoreActivation(next, ctx, true),
        ),
        (next) => observeAuth(next, ctx),
      );
    case "auth-changed":
      return observeAuth(state, ctx);
    case "activation-answered":
      return answered(state, event.answer, ctx);
    case "form-touched":
      return stopActivation(state);
    case "suspended":
      return suspend(state);
    case "resumed":
      return resume(state, ctx);
    case "timer":
      return timerFired(state, event.timer, ctx);
    case "upgrade-clicked":
      return upgrade(state, ctx);
    case "retry-clicked":
      return retry(state, ctx);
    case "sign-in-clicked":
      return then(dropIntent(state), (next) => [
        next,
        [{ type: "open-sign-in", purpose: "plain" }],
      ]);
    case "sign-in-requested":
      return event.purpose === "plain" ? dropIntent(state) : [state, []];
    case "checkout-settled":
      return settleCheckout(state, event.outcome, ctx);
  }
}

/** What the Upgrade button shows. */
export type UpgradeButtonView = "ready" | "preparing" | "failed";

export function upgradeButtonView(checkout: Checkout): UpgradeButtonView {
  switch (checkout.kind) {
    case "creating":
    case "redirecting":
      return "preparing";
    case "failed":
      return "failed";
    default:
      return "ready";
  }
}
