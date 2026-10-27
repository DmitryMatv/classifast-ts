import type { ComponentType } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { islandNamed } from "../../../src/web/islands/registry.js";
import {
  IslandRoot,
  type ClientServices,
} from "../../../src/web/islands/services.js";

/**
 * Hydration resets a prefilled textarea to its server text. Captures what
 * the visitor typed before the bundle ran and returns the function that
 * writes it back as an ordinary edit.
 */
export function captureEdits(host: Element): () => void {
  const edits = [...host.querySelectorAll("textarea")]
    .filter((textarea) => textarea.value !== textarea.defaultValue)
    .map((textarea) => [textarea, textarea.value] as const);
  return () => {
    for (const [textarea, value] of edits) {
      if (textarea.value === value) continue;
      textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
}

/**
 * Hydrates every registered island under `root`. A host whose name or
 * version this bundle does not know came from older or newer HTML and stays
 * static.
 */
export function hydrateIslands(
  root: ParentNode,
  services: ClientServices,
): Root[] {
  const roots: Root[] = [];
  for (const host of root.querySelectorAll<HTMLElement>("[data-island]")) {
    const island = islandNamed(host.dataset["island"] ?? "");
    if (island === undefined) continue;
    if (host.dataset["islandVersion"] !== String(island.version)) continue;
    const Component = island.component as ComponentType<object>;
    const props = JSON.parse(host.dataset["islandProps"] ?? "{}") as object;
    roots.push(
      hydrateRoot(
        host,
        <IslandRoot services={services} restoreEdits={captureEdits(host)}>
          <Component {...props} />
        </IslandRoot>,
      ),
    );
  }
  return roots;
}
