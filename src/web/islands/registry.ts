// Isomorphic: the browser bundles this module and the server imports it.
// src/web/client-boundary.spec.ts keeps server-only imports out of it.
import type { ComponentProps, ComponentType } from "react";
import { SiteHeader } from "../header/site-header.js";
import { BuyButton, CheckoutBanner } from "../storefront/storefront-islands.js";

interface IslandDefinition {
  /**
   * Cloudflare can serve HTML about a day old to a browser that loads the
   * newest site.js. The host writes this number and the client hydrates
   * only an exact match, so old HTML for a changed island stays static
   * instead of crashing. Bump it on any change that old props or old server
   * markup would not hydrate under.
   */
  readonly version: number;
  readonly component: ComponentType<never>;
}

/**
 * The one list of islands. The server renders only these names and the
 * client hydrates only these names, so adding an island is one line here.
 */
export const ISLANDS = {
  header: { version: 1, component: SiteHeader },
  "buy-button": { version: 1, component: BuyButton },
  "checkout-banner": { version: 1, component: CheckoutBanner },
} as const satisfies Record<string, IslandDefinition>;

export type IslandName = keyof typeof ISLANDS;

export type IslandProps<N extends IslandName> = ComponentProps<
  (typeof ISLANDS)[N]["component"]
>;

export function islandNamed(name: string): IslandDefinition | undefined {
  return Object.hasOwn(ISLANDS, name) ? ISLANDS[name as IslandName] : undefined;
}
