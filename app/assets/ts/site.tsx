// The one client entry. Pages load it as a module script, which runs after
// the document is parsed.
import { hydrateIslands } from "./hydrate-islands.js";
import { createApiClient } from "./services/api.js";
import {
  createBrowserRuntime,
  stripCheckoutSecrets,
} from "./services/runtime.js";

stripCheckoutSecrets(window);
hydrateIslands(document, {
  api: createApiClient(window),
  runtime: createBrowserRuntime(window),
});
