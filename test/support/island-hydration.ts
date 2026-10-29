// Hydrates server pages the way site.js does, inside a node test: the e2e
// project runs in node, and the pages come from the Nest app.
import { builtinEnvironments } from "vitest/environments";
import type { ClientServices } from "../../src/web/islands/services.js";

const PENDING = { status: "pending" } as const;

/** Auth that never settles and an API that never answers, so hydration and mount are all that run. */
function inertServices(runtime: ClientServices["runtime"]): ClientServices {
  const never = () => new Promise<never>(() => {});
  return {
    auth: {
      subscribe: () => () => {},
      getSnapshot: () => PENDING,
      start: () => {},
      openSignIn: () => {},
      onSignInRequested: () => () => {},
      openSignUp: () => {},
      mountUserButton: () => () => {},
      openGoogleOneTap: () => {},
    },
    api: { mappingCheckout: never, results: never, checkout: never },
    runtime,
  };
}

/**
 * Loads each page into a jsdom document at its URL, hydrates its islands
 * with hydrateIslands, and returns how many it hydrated and what React or
 * the page reported:
 * a hydration mismatch arrives as a console.error or a window error event.
 */
export async function hydrationErrors(
  pages: readonly { readonly url: string; readonly html: string }[],
): Promise<Map<string, { hydrated: number; errors: unknown[] }>> {
  const environment = await builtinEnvironments.jsdom.setup(globalThis, {
    jsdom: { url: "http://testserver/" },
  });
  const found = new Map<string, { hydrated: number; errors: unknown[] }>();
  try {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // Imported after the environment exists, as the browser evaluates them.
    const { act } = await import("react");
    const { hydrateIslands } =
      await import("../../app/assets/ts/hydrate-islands.js");
    const { createBrowserRuntime } =
      await import("../../app/assets/ts/services/runtime.js");
    for (const { url, html } of pages) {
      window.history.replaceState(null, "", url);
      document.open();
      document.write(html);
      document.close();
      const errors: unknown[] = [];
      let hydrated = 0;
      const onError = (event: ErrorEvent) => errors.push(event.error);
      const consoleError = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      window.addEventListener("error", onError);
      try {
        const roots = await act(async () =>
          hydrateIslands(document, inertServices(createBrowserRuntime(window))),
        );
        hydrated = roots.length;
        await act(async () => roots.forEach((root) => root.unmount()));
      } finally {
        window.removeEventListener("error", onError);
        console.error = consoleError;
      }
      found.set(url, { hydrated, errors });
    }
  } finally {
    await environment.teardown(globalThis);
  }
  return found;
}
