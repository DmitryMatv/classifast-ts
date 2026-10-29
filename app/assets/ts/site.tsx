// The one client entry. Pages load it as a module script, which runs after
// the document is parsed.
import { hydrateIslands } from "./hydrate-islands.js";
import { createApiClient } from "./services/api.js";
import { createAuthService } from "./services/auth.js";
import {
  createBrowserRuntime,
  stripCheckoutSecrets,
} from "./services/runtime.js";

stripCheckoutSecrets(window);
const runtime = createBrowserRuntime(window);
hydrateIslands(document, {
  auth: createAuthService(window, runtime),
  api: createApiClient(window),
  runtime,
});
