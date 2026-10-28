// Server-only: imports react-dom/server, so the client bundle never does.
import type {
  AriaAttributes,
  AriaRole,
  ComponentType,
  ReactElement,
} from "react";
import { renderToString } from "react-dom/server";
import { ISLANDS, type IslandName, type IslandProps } from "./registry.js";
import { IslandRoot, SERVER_SERVICES } from "./services.js";

function noEditsToRestore(): void {}

export type IslandElementProps<N extends IslandName> = AriaAttributes & {
  readonly name: N;
  readonly props: IslandProps<N>;
  /** The element the page already had there, so no wrapper changes layout. */
  readonly as?: "div" | "header" | "section";
  readonly id?: string;
  readonly className?: string;
  readonly role?: AriaRole;
};

/**
 * One island inside a renderToStaticMarkup page. The inner HTML is its own
 * renderToString root, in the same IslandRoot the client hydrates, so
 * useId, text separators and image preloads match on both sides. React
 * escapes the props attribute, so no value can close the element; the
 * props must hold nothing per visitor, because pages are edge-cached.
 */
export function Island<N extends IslandName>({
  name,
  props,
  as: Host = "div",
  ...host
}: IslandElementProps<N>): ReactElement {
  const { version, component } = ISLANDS[name];
  const Component = component as ComponentType<object>;
  const html = renderToString(
    <IslandRoot services={SERVER_SERVICES} restoreEdits={noEditsToRestore}>
      <Component {...(props as object)} />
    </IslandRoot>,
  );
  return (
    <Host
      {...host}
      data-island={name}
      data-island-version={version}
      data-island-props={JSON.stringify(props)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
