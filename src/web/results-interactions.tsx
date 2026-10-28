// Isomorphic. The interactive leaves of Results. renderToStaticMarkup
// drops handlers and effects, so the static result fragment keeps its
// markup, and the legacy scripts drive these buttons there by their
// data-copy-original-id and id hooks.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useServices } from "./islands/services.js";

const TOOLTIP_MS = 500;
const SHARE_FEEDBACK_MS = 2000;
const TOOLTIP_GAP_PX = 5;

const TOOLTIP_STYLE = {
  position: "absolute",
  backgroundColor: "black",
  color: "white",
  padding: "4px 8px",
  borderRadius: "4px",
  fontSize: "1.125rem",
  zIndex: 1000,
  textAlign: "center",
} as const;

/** Centered above the button, below it when the top would clip, kept inside the viewport. */
function placeTooltip(tooltip: HTMLElement, button: HTMLElement): void {
  const view = tooltip.ownerDocument.defaultView!;
  const anchor = button.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const above = anchor.top - height - TOOLTIP_GAP_PX;
  const top = above < 0 ? anchor.bottom + TOOLTIP_GAP_PX : above;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, 0),
    view.innerWidth - width,
  );
  tooltip.style.top = `${top + view.scrollY}px`;
  tooltip.style.left = `${left + view.scrollX}px`;
}

/**
 * Copies a result's ID. "Copied!" or "Copy failed" shows for 500 ms in a
 * tooltip on body, because the result row clips overflow; the button is
 * disabled meanwhile.
 */
export function CopyIdButton(props: {
  readonly originalId: string;
  readonly children: ReactNode;
}): ReactElement {
  const { runtime } = useServices();
  const [state, setState] = useState<"idle" | "copying" | "tooltip">("idle");
  const [message, setMessage] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (state === "tooltip") placeTooltip(tooltip.current!, button.current!);
  }, [state]);
  useEffect(() => {
    if (state !== "tooltip") return;
    const timer = setTimeout(() => setState("idle"), TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy(): Promise<void> {
    setState("copying");
    const copied = await runtime.copyText(props.originalId);
    setMessage(copied ? "Copied!" : "Copy failed");
    setState("tooltip");
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        data-copy-original-id={props.originalId}
        title="Copy ID to clipboard"
        aria-label={`Copy classification ID ${props.originalId} to clipboard`}
        className="text-2xl font-mono text-gray-600 hover:text-sky-600 cursor-pointer"
        disabled={state !== "idle"}
        onClick={() => void copy()}
      >
        {props.children}
      </button>
      {state === "tooltip" &&
        createPortal(
          <span ref={tooltip} role="status" style={TOOLTIP_STYLE}>
            {message}
          </span>,
          button.current!.ownerDocument.body,
        )}
    </>
  );
}

const SHARE_CLASS =
  "text-white font-semibold px-8 py-2 rounded text-base transition-colors duration-150 ease-in-out transform";

export function ShareButton(): ReactElement {
  const { runtime } = useServices();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), SHARE_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share(): Promise<void> {
    if (await runtime.copyText(runtime.href())) setCopied(true);
  }

  return (
    <button
      type="button"
      id="share-button"
      className={`${copied ? "bg-green-600 hover:bg-green-700" : "bg-gray-600 hover:bg-gray-700"} ${SHARE_CLASS}`}
      title="Copy shareable link to clipboard"
      onClick={() => void share()}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
