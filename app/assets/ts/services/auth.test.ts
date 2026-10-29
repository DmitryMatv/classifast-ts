import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "../../../../src/web/islands/services.js";
import {
  AuthUnavailableError,
  CLERK_JS_SRC,
  CLERK_UI_SRC,
  createAuthService,
  type ClientAuth,
} from "./auth.js";

const HREF = "https://classifast.test/UNSPSC/?a=1";
const ClerkUI = class {};

function jwt(secondsLeft: number): string {
  const exp = Math.floor(Date.now() / 1000) + secondsLeft;
  const payload = btoa(JSON.stringify({ exp }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

type TokenAnswer = () => Promise<string | null>;

function fakeClerk(options: { user?: string; tokens?: TokenAnswer[] } = {}) {
  const answers = [...(options.tokens ?? [])];
  const listeners: (() => void)[] = [];
  const getToken = vi.fn(() => (answers.shift() ?? (async () => null))());
  const clerk = {
    user: options.user === undefined ? null : { id: options.user },
    session: options.user === undefined ? null : { getToken },
    getToken,
    load: vi.fn(async (_options: { ui: { ClerkUI: unknown } }) => {}),
    addListener: vi.fn((listener: () => void) => {
      listeners.push(listener);
      listener();
      return () => {};
    }),
    mountUserButton: vi.fn(),
    unmountUserButton: vi.fn(),
    openSignIn: vi.fn(),
    openSignUp: vi.fn(),
    openGoogleOneTap: vi.fn(),
    /** Changes the visitor the way a sign-in or sign-out in Clerk would. */
    become(user: string | null) {
      clerk.user = user === null ? null : { id: user };
      clerk.session = user === null ? null : { getToken };
      for (const listener of listeners) listener();
    },
  };
  return clerk;
}

type FakeClerk = ReturnType<typeof fakeClerk>;

const globals = window as unknown as {
  Clerk?: FakeClerk;
  __internal_ClerkUICtor?: unknown;
};

function injected(src: string): HTMLScriptElement {
  const scripts = document.head.querySelectorAll<HTMLScriptElement>(
    `script[src="${src}"]`,
  );
  expect(scripts).toHaveLength(1);
  return scripts[0]!;
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/** Runs both scripts the way the browser would, then lets the bootstrap continue. */
async function loadScripts(clerk: FakeClerk | null): Promise<void> {
  if (clerk) globals.Clerk = clerk;
  globals.__internal_ClerkUICtor = ClerkUI;
  injected(CLERK_UI_SRC).dispatchEvent(new Event("load"));
  injected(CLERK_JS_SRC).dispatchEvent(new Event("load"));
  await flush();
}

let navigations: string[];
let auth: ClientAuth;
let published: AuthSnapshot[];

beforeEach(() => {
  vi.useFakeTimers();
  delete globals.Clerk;
  delete globals.__internal_ClerkUICtor;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  navigations = [];
  auth = createAuthService(window, {
    href: () => HREF,
    navigate: (url) => navigations.push(url),
  });
  published = [];
  auth.subscribe(() => published.push(auth.getSnapshot()));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth bootstrap", () => {
  it("injects Clerk's two scripts once, with the publishable key on clerk.browser.js", () => {
    auth.start();
    auth.start();

    const ui = injected(CLERK_UI_SRC);
    const js = injected(CLERK_JS_SRC);
    expect(ui.crossOrigin).toBe("anonymous");
    expect(js.crossOrigin).toBe("anonymous");
    expect(js.dataset["clerkPublishableKey"]).toBe(
      "pk_live_Y2xlcmsuY2xhc3NpZmFzdC5jb20k",
    );
    expect(ui.hasAttribute("data-clerk-publishable-key")).toBe(false);
  });

  it("loads Clerk with its UI and settles signed out", async () => {
    const clerk = fakeClerk();
    auth.start();
    expect(auth.getSnapshot()).toEqual({ status: "pending" });

    await loadScripts(clerk);

    expect(clerk.load).toHaveBeenCalledWith({ ui: { ClerkUI } });
    expect(published).toEqual([{ status: "signed-out" }]);
  });

  it("settles signed in after fetching the first token", async () => {
    const clerk = fakeClerk({ user: "user_1", tokens: [async () => jwt(60)] });
    auth.start();

    await loadScripts(clerk);

    expect(clerk.getToken).toHaveBeenCalledTimes(1);
    expect(published).toEqual([
      { status: "signed-in", userId: "user_1", sessionUsable: true },
    ]);
  });

  it("settles unavailable at once when a script fails to load", async () => {
    auth.start();

    injected(CLERK_JS_SRC).dispatchEvent(new Event("error"));
    await flush();

    expect(published).toEqual([{ status: "unavailable" }]);
  });

  it.each([
    ["the scripts never load", async () => {}],
    [
      "Clerk.load never settles",
      async () => {
        const clerk = fakeClerk();
        clerk.load.mockReturnValue(new Promise(() => {}));
        await loadScripts(clerk);
      },
    ],
    [
      "the first token never arrives",
      async () => {
        await loadScripts(
          fakeClerk({ user: "user_1", tokens: [() => new Promise(() => {})] }),
        );
      },
    ],
  ])("settles unavailable 10 s into a stage when %s", async (_, stall) => {
    auth.start();
    await stall();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(auth.getSnapshot()).toEqual({ status: "pending" });
    await vi.advanceTimersByTimeAsync(1);
    expect(published).toEqual([{ status: "unavailable" }]);
  });

  it("settles unavailable when the scripts load without setting Clerk", async () => {
    auth.start();

    await loadScripts(null);

    expect(published).toEqual([{ status: "unavailable" }]);
  });

  it("leaves pending once, then follows Clerk's listener", async () => {
    const clerk = fakeClerk({ tokens: [async () => jwt(60)] });
    auth.start();
    await loadScripts(clerk);

    clerk.become("user_1");
    clerk.become("user_1");
    clerk.become(null);

    expect(published).toEqual([
      { status: "signed-out" },
      { status: "signed-in", userId: "user_1", sessionUsable: true },
      { status: "signed-out" },
    ]);
  });

  it("keeps one snapshot object while nothing changes", async () => {
    auth.start();
    await loadScripts(fakeClerk());

    expect(auth.getSnapshot()).toBe(auth.getSnapshot());
  });
});

describe("sign-in and sign-up", () => {
  it("opens Clerk's modals with the current URL as the redirect", async () => {
    const clerk = fakeClerk();
    auth.start();
    await loadScripts(clerk);

    auth.openSignIn("plain");
    auth.openSignUp();

    expect(clerk.openSignIn).toHaveBeenCalledWith({ redirectUrl: HREF });
    expect(clerk.openSignUp).toHaveBeenCalledWith({ redirectUrl: HREF });
    expect(navigations).toEqual([]);
  });

  it("sends the visitor to the accounts site when Clerk is unavailable", async () => {
    const clerk = fakeClerk();
    clerk.load.mockRejectedValue(new Error("400"));
    auth.start();
    await loadScripts(clerk);

    auth.openSignIn("plain");
    auth.openSignUp();

    expect(clerk.openSignIn).not.toHaveBeenCalled();
    expect(navigations).toEqual([
      `https://accounts.classifast.com/sign-in?redirect_url=${encodeURIComponent(HREF)}`,
      `https://accounts.classifast.com/sign-up?redirect_url=${encodeURIComponent(HREF)}`,
    ]);
  });

  it("tells each sign-in listener the purpose before it opens, until it unsubscribes", async () => {
    const clerk = fakeClerk();
    auth.start();
    await loadScripts(clerk);
    const heard: string[] = [];
    const stop = auth.onSignInRequested((purpose) => {
      heard.push(purpose);
      expect(clerk.openSignIn).toHaveBeenCalledTimes(heard.length - 1);
    });

    auth.openSignIn("upgrade");
    auth.openSignIn("plain");
    stop();
    auth.openSignIn("plain");

    expect(heard).toEqual(["upgrade", "plain"]);
    expect(clerk.openSignIn).toHaveBeenCalledTimes(3);
  });
});

describe("Google One Tap", () => {
  it("opens once per page with FedCM for a signed-out visitor", async () => {
    const clerk = fakeClerk();
    auth.openGoogleOneTap();
    auth.start();
    await loadScripts(clerk);

    auth.openGoogleOneTap();
    auth.openGoogleOneTap();

    expect(clerk.openGoogleOneTap).toHaveBeenCalledTimes(1);
    expect(clerk.openGoogleOneTap).toHaveBeenCalledWith({
      cancelOnTapOutside: false,
      itpSupport: true,
      fedCmSupport: true,
    });
  });

  it("does not open for a signed-in visitor", async () => {
    const clerk = fakeClerk({ user: "user_1" });
    auth.start();
    await loadScripts(clerk);

    auth.openGoogleOneTap();

    expect(clerk.openGoogleOneTap).not.toHaveBeenCalled();
  });

  it("does not open in an embedded browsing context", async () => {
    const clerk = fakeClerk();
    auth.start();
    await loadScripts(clerk);
    const self = window.self;
    window.self = {} as Window & typeof globalThis;
    try {
      auth.openGoogleOneTap();
    } finally {
      window.self = self;
    }

    expect(clerk.openGoogleOneTap).not.toHaveBeenCalled();
  });
});

describe("the user button", () => {
  it("mounts Clerk's button without the trigger ring and unmounts it", async () => {
    const clerk = fakeClerk({ user: "user_1" });
    auth.start();
    await loadScripts(clerk);
    const element = document.createElement("div");

    const unmount = auth.mountUserButton(element);
    unmount();

    const [mountedInto, options] = clerk.mountUserButton.mock.calls[0]!;
    expect(mountedInto).toBe(element);
    const trigger = (
      options as { appearance: { elements: { userButtonTrigger: string } } }
    ).appearance.elements.userButtonTrigger;
    expect(trigger).toContain("focus-visible:ring-0");
    expect(trigger).not.toContain("ring-offset");
    expect(clerk.unmountUserButton).toHaveBeenCalledWith(element);
  });
});

describe("authorization", () => {
  const signal = () => new AbortController().signal;

  async function signedIn(tokens: TokenAnswer[]): Promise<FakeClerk> {
    const clerk = fakeClerk({ user: "user_1", tokens });
    auth.start();
    await loadScripts(clerk);
    return clerk;
  }

  it("waits for the snapshot to settle, then sends a signed-out visitor anonymously", async () => {
    auth.start();
    const authorization = auth.authorization(signal());
    let answered = false;
    void authorization.then(() => (answered = true));
    await flush();
    expect(answered).toBe(false);

    await loadScripts(fakeClerk());

    await expect(authorization).resolves.toEqual({ kind: "anonymous" });
  });

  it("sends a visitor anonymously when Clerk is unavailable", async () => {
    auth.start();
    injected(CLERK_UI_SRC).dispatchEvent(new Event("error"));

    await expect(auth.authorization(signal())).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("sends Clerk's current token for a signed-in visitor", async () => {
    const fresh = jwt(60);
    await signedIn([async () => jwt(60), async () => fresh]);

    await expect(auth.authorization(signal())).resolves.toEqual({
      kind: "bearer",
      token: fresh,
    });
  });

  it.each<[string, TokenAnswer]>([
    ["comes back empty", async () => null],
    ["has expired", async () => jwt(-1)],
    [
      "fails",
      async () => {
        throw new Error("network");
      },
    ],
  ])(
    "falls back to the last unexpired token when a new one %s",
    async (_, answer) => {
      const first = jwt(60);
      await signedIn([async () => first, answer]);

      await expect(auth.authorization(signal())).resolves.toEqual({
        kind: "bearer",
        token: first,
      });
    },
  );

  it("falls back to the last token when the request hangs for 10 s", async () => {
    const first = jwt(60);
    await signedIn([async () => first, () => new Promise(() => {})]);

    const authorization = auth.authorization(signal());
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(authorization).resolves.toEqual({
      kind: "bearer",
      token: first,
    });
  });

  it("never sends a signed-in visitor anonymously when no token is usable", async () => {
    const clerk = await signedIn([async () => jwt(5), async () => null]);
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(auth.authorization(signal())).rejects.toBeInstanceOf(
      AuthUnavailableError,
    );
    expect(clerk.getToken).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the user changes while the token is fetched", async () => {
    let answer: (token: string) => void = () => {};
    const clerk = await signedIn([
      async () => jwt(60),
      () => new Promise((resolve) => (answer = resolve)),
    ]);

    const authorization = auth.authorization(signal());
    await flush();
    clerk.become("user_2");
    answer(jwt(60));

    await expect(authorization).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("recovers a lost session before asking for the token", async () => {
    const recovered = jwt(60);
    const clerk = await signedIn([async () => jwt(30), async () => recovered]);
    clerk.session = null;
    clerk.load.mockImplementation(async () => {
      clerk.session = { getToken: clerk.getToken };
    });

    await expect(auth.authorization(signal())).resolves.toEqual({
      kind: "bearer",
      token: recovered,
    });
    expect(clerk.load).toHaveBeenLastCalledWith({ ui: { ClerkUI } });
  });

  it("rejects with the abort reason while waiting for the snapshot", async () => {
    auth.start();
    const controller = new AbortController();
    const authorization = auth.authorization(controller.signal);

    controller.abort(new DOMException("left", "AbortError"));

    await expect(authorization).rejects.toMatchObject({ message: "left" });
  });

  it("rejects with the abort reason while waiting for the token", async () => {
    await signedIn([async () => jwt(60), () => new Promise(() => {})]);
    const controller = new AbortController();
    const authorization = auth.authorization(controller.signal);
    await flush();

    controller.abort(new DOMException("left", "AbortError"));

    await expect(authorization).rejects.toMatchObject({ message: "left" });
  });
});
