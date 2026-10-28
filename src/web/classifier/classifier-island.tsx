// Isomorphic. The `classifier` island: everything inside
// <section id="classifier-form-section">. Form values live in the DOM and
// are read per event; the machine decides, and the interpreter is the only
// code here with side effects.
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { collapseWhitespace } from "../../python/str.js";
import { useServices, type ClientServices } from "../islands/services.js";
import { useMachine, type Machine } from "../islands/use-machine.js";
import { Results, type ResultsProps } from "../results.js";
import {
  classifierView,
  initClassifier,
  updateClassifier,
  type ClassifierCommand,
  type ClassifierCtx,
  type ClassifierEvent,
  type ClassifierStart,
  type ClassifierState,
  type PanelView,
} from "./classifier-machine.js";
import {
  HISTORY_STATE_KEY,
  TOP_K_CHOICES,
  historyEntryOf,
  type FormFields,
  type HistoryEntry,
  type TopK,
} from "./lookup.js";
import {
  readStoredPaywall,
  storedPaywallWrites,
  type PaywallInput,
  type PaywallTimer,
} from "./paywall-machine.js";
import {
  ACTIVATION_STILL_PENDING,
  PaywallPanel,
  StatusMessage,
} from "./paywall-panel.js";

export interface ClassifierLogo {
  readonly src: string;
  readonly alt: string;
  readonly className: string;
}

export interface ClassifierResources {
  readonly className: string;
  readonly listClassName: string;
  readonly links: readonly (readonly [href: string, label: string])[];
}

/** Built by the page from the request URL, the config and the SSR results; nothing per visitor. */
export interface ClassifierIslandProps {
  readonly classifierType: string;
  readonly heading: string;
  /** Empty: no description toggle. */
  readonly description: string;
  readonly logo: ClassifierLogo | null;
  readonly resources: ClassifierResources | null;
  readonly form: {
    readonly versions: readonly string[];
    /** The selected version; empty when there are none. */
    readonly version: string;
    readonly topK: number;
    /** The query of a query page; empty on the base page, which shows its example as the placeholder. */
    readonly text: string;
    readonly placeholder: string;
    readonly enhance: boolean;
  };
  /** The panel the server rendered. */
  readonly initial: ResultsProps;
  readonly start: ClassifierStart;
}

const CLASSIFIER_MACHINE: Machine<
  ClassifierStart,
  ClassifierState,
  ClassifierEvent,
  ClassifierCommand,
  ClassifierCtx
> = { init: initClassifier, update: updateClassifier };

const PRESS_MS = 150;

function control<T extends Element>(
  form: HTMLFormElement,
  name: string,
  type: new () => T,
): T | null {
  const element = form.elements.namedItem(name);
  return element instanceof type ? element : null;
}

function isTopK(value: number): value is TopK {
  return (TOP_K_CHOICES as readonly number[]).includes(value);
}

export function readFields(form: HTMLFormElement): FormFields {
  const topK = Number(control(form, "top_k", HTMLSelectElement)?.value);
  return {
    text:
      control(form, "product_description", HTMLTextAreaElement)?.value ?? "",
    version: control(form, "version", HTMLSelectElement)?.value ?? "",
    topK: isTopK(topK) ? topK : TOP_K_CHOICES[0],
    enhance: control(form, "enhance_query", HTMLInputElement)?.checked ?? false,
  };
}

/** Sets the controls without dispatching input or change. */
export function writeFields(form: HTMLFormElement, fields: FormFields): void {
  const text = control(form, "product_description", HTMLTextAreaElement);
  const version = control(form, "version", HTMLSelectElement);
  const topK = control(form, "top_k", HTMLSelectElement);
  const enhance = control(form, "enhance_query", HTMLInputElement);
  if (text) text.value = fields.text;
  if (version && fields.version) version.value = fields.version;
  if (topK) topK.value = String(fields.topK);
  if (enhance) enhance.checked = fields.enhance;
}

/**
 * The native "Please fill in this field". `required` accepts whitespace,
 * which the lookup collapses to nothing, so whitespace is cleared first.
 */
function reportEmptyQuery(form: HTMLFormElement): void {
  const text = control(form, "product_description", HTMLTextAreaElement);
  if (!text) return;
  if (collapseWhitespace(text.value) === "") text.value = "";
  text.reportValidity();
}

function withEntry(state: unknown, entry: HistoryEntry): object {
  const others = typeof state === "object" && state !== null ? state : {};
  return { ...others, [HISTORY_STATE_KEY]: entry };
}

/**
 * The command interpreter. One AbortController for the request slot, one
 * for a checkout, one timer per name: `fetch` aborts its predecessor and
 * `set-timer` replaces.
 */
function createInterpreter(
  services: ClientServices,
  classifierType: string,
  form: () => HTMLFormElement,
) {
  const { api, auth, runtime } = services;
  let lookup: AbortController | null = null;
  let checkout: AbortController | null = null;
  const timers = new Map<PaywallTimer, ReturnType<typeof setTimeout>>();

  function run(
    command: ClassifierCommand,
    send: (event: ClassifierEvent) => void,
  ): void {
    switch (command.type) {
      case "fetch": {
        lookup?.abort();
        const controller = new AbortController();
        lookup = controller;
        const { seq } = command;
        api.results(classifierType, command.query, controller.signal).then(
          (answer) => {
            if (!controller.signal.aborted)
              send({ type: "answered", seq, answer });
          },
          () => {},
        );
        return;
      }
      case "abort-fetch":
        lookup?.abort();
        lookup = null;
        return;
      case "push-entry":
        runtime.pushHistory(
          withEntry(runtime.historyState(), command.entry),
          command.url,
        );
        runtime.setTitle(command.entry.title);
        return;
      case "replace-entry":
        runtime.replaceHistory(
          withEntry(runtime.historyState(), command.entry),
          command.url,
        );
        runtime.setTitle(command.entry.title);
        return;
      case "set-title":
        runtime.setTitle(command.title);
        return;
      case "write-fields":
        writeFields(form(), command.fields);
        return;
      case "report-empty-query":
        reportEmptyQuery(form());
        return;
      case "open-sign-in":
        auth.openSignIn(command.purpose);
        return;
      case "create-checkout": {
        checkout?.abort();
        const controller = new AbortController();
        checkout = controller;
        api.checkout(command.returnUrl, controller.signal).then(
          (outcome) => {
            if (!controller.signal.aborted)
              send({
                type: "paywall",
                event: { type: "checkout-settled", outcome },
              });
          },
          () => {},
        );
        return;
      }
      case "abort-checkout":
        checkout?.abort();
        checkout = null;
        return;
      case "navigate":
        runtime.navigate(command.url);
        return;
      case "store":
        for (const [key, value] of storedPaywallWrites(command.patch))
          runtime.writeSession(key, value);
        return;
      case "set-timer": {
        const { timer } = command;
        clearTimeout(timers.get(timer));
        timers.set(
          timer,
          setTimeout(() => {
            timers.delete(timer);
            send({ type: "paywall", event: { type: "timer", timer } });
          }, command.ms),
        );
        return;
      }
      case "clear-timer":
        clearTimeout(timers.get(command.timer));
        timers.delete(command.timer);
        return;
      default:
        command satisfies never;
    }
  }

  function dispose(): void {
    lookup?.abort();
    checkout?.abort();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { run, dispose };
}

function ExternalLinkIcon() {
  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="inline align-text-top ml-1 lucide lucide-external-link-icon lucide-external-link"
      >
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
      <span className="sr-only">{" (opens in new tab)"}</span>
    </>
  );
}

function ResourceLinks(props: {
  readonly classifierType: string;
  readonly resources: ClassifierResources;
}) {
  const { resources } = props;
  return (
    <div
      className={resources.className}
      aria-label={`${props.classifierType} resources`}
    >
      <div className={resources.listClassName}>
        {resources.links.map(([href, label], index) => (
          <Fragment key={href}>
            {index > 0 && " "}
            <a
              href={href}
              className="text-sky-700 hover:text-sky-800 hover:underline decoration-sky-700 underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              {label}
              <ExternalLinkIcon />
            </a>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Panel(props: {
  readonly view: PanelView;
  readonly initial: ResultsProps;
  readonly paywall: (event: PaywallInput) => void;
}): ReactElement {
  const { view, paywall } = props;
  const onRetry = () => paywall({ type: "retry-clicked" });
  switch (view.kind) {
    case "page":
      return <Results {...props.initial} />;
    case "results":
      return <Results key={view.key} {...view.answer} loaded />;
    case "paywall":
      return (
        <PaywallPanel
          kind="paywall"
          signedIn={view.signedIn}
          limit={view.limit}
          upgrade={view.upgrade}
          notice={view.activationStopped ? ACTIVATION_STILL_PENDING : null}
          onSignIn={() => paywall({ type: "sign-in-clicked" })}
          onUpgrade={() => paywall({ type: "upgrade-clicked" })}
          onRetry={onRetry}
        />
      );
    case "activation":
      return (
        <PaywallPanel kind="activation" phase={view.phase} onRetry={onRetry} />
      );
    case "busy":
    case "error":
      return <StatusMessage message={view.message} />;
  }
}

const SUBMIT_CLASS =
  "cursor-pointer bg-sky-700 hover:bg-sky-800 active:bg-sky-900 active:scale-95 text-white font-medium px-10 py-2 rounded text-base transition-all duration-150 ease-in-out transform";

export function ClassifierIsland(props: ClassifierIslandProps): ReactElement {
  const services = useServices();
  const { auth, runtime } = services;
  const { classifierType, form: fields, logo, description } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [interpreter] = useState(() =>
    createInterpreter(services, classifierType, () => formRef.current!),
  );
  const { state, send } = useMachine(
    CLASSIFIER_MACHINE,
    props.start,
    { type: "mounted" },
    () => ({
      now: runtime.now(),
      url: runtime.href(),
      fields: readFields(formRef.current!),
      auth: auth.getSnapshot(),
      stored: readStoredPaywall((key) => runtime.readSession(key)),
    }),
    interpreter.run,
  );
  const [expanded, setExpanded] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    // The submit handler is the one validation point (report-empty-query).
    formRef.current!.noValidate = true;
    const stops = [
      auth.subscribe(() => send({ type: "auth-changed" })),
      auth.onSignInRequested((purpose) =>
        send({
          type: "paywall",
          event: { type: "sign-in-requested", purpose },
        }),
      ),
      runtime.onPopState((entry) =>
        send({ type: "history-popped", entry: historyEntryOf(entry) }),
      ),
      runtime.onPageHide(() => send({ type: "page-hidden" })),
      runtime.onPageShow((persisted) =>
        send({ type: "page-shown", persisted }),
      ),
    ];
    return () => {
      for (const stop of stops) stop();
      interpreter.dispose();
    };
  }, [auth, runtime, send, interpreter]);

  useEffect(() => {
    if (!pressed) return;
    const timer = setTimeout(() => setPressed(false), PRESS_MS);
    return () => clearTimeout(timer);
  }, [pressed]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    setPressed(true);
    formRef.current!.requestSubmit(submitRef.current);
  }

  const view = classifierView(state);
  const edited = (field: "text" | "version" | "enhance") => () =>
    send({ type: "edited", field });

  return (
    <>
      <div className="relative">
        <h2 id="classifier-form-heading">{props.heading}</h2>
        {logo && (
          <>
            {" "}
            <img
              src={logo.src}
              alt={logo.alt}
              className={logo.className}
              fetchPriority="high"
              style={expanded ? { display: "none" } : undefined}
            />
          </>
        )}
      </div>{" "}
      {description && (
        <>
          <button
            id="description-toggle"
            type="button"
            aria-expanded={expanded}
            className="cursor-pointer bg-transparent text-sky-700 hover:text-sky-800 focus:outline-none hover:underline decoration-sky-700 underline-offset-2"
            aria-controls="description-content"
            aria-label={`Learn more about ${classifierType} button`}
            onClick={() => setExpanded((was) => !was)}
          >
            {expanded ? "Show less" : `Learn more about ${classifierType}`}
          </button>{" "}
          <div id="description-container" aria-live="polite">
            <div
              id="description-content"
              style={{ display: expanded ? "block" : "none" }}
              aria-hidden={!expanded}
            >
              {description}
            </div>
          </div>
        </>
      )}
      {props.resources && (
        <ResourceLinks
          classifierType={classifierType}
          resources={props.resources}
        />
      )}
      <form
        id="classifier-form"
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          send({ type: "submitted" });
        }}
      >
        {fields.versions.length > 0 && (
          <div className="flex items-center justify-start mb-1 mt-6">
            <select
              name="version"
              id="version_selector"
              role="combobox"
              aria-label="Classification version"
              aria-expanded="false"
              aria-haspopup="listbox"
              className="border border-gray-400 rounded text-left px-1 py-1 mb-1"
              defaultValue={fields.version}
              onChange={edited("version")}
            >
              {fields.versions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}{" "}
        <textarea
          name="product_description"
          id="product_description_area"
          placeholder={fields.placeholder}
          required
          aria-describedby="description-help"
          maxLength={4000}
          role="textbox"
          aria-label="Product description"
          className="w-full px-2 py-2 border border-gray-400 rounded min-h-20 h-20 max-h-200 resize-y mb-1"
          defaultValue={fields.text}
          onInput={edited("text")}
          onKeyDown={onKeyDown}
        />{" "}
        <label className="inline-flex items-center gap-2 mb-3 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            id="enhance-query-switch"
            name="enhance_query"
            value="1"
            role="switch"
            defaultChecked={fields.enhance}
            className="sr-only peer"
            onChange={edited("enhance")}
          />{" "}
          <span
            aria-hidden="true"
            className="relative h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-sky-700 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-600 peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:content-[''] peer-checked:after:translate-x-4"
          ></span>{" "}
          <span>
            Expand query <span className="text-xs text-sky-700">Beta</span>
          </span>
        </label>{" "}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <button
              ref={submitRef}
              type="submit"
              role="button"
              aria-label="Lookup code for product description"
              className={pressed ? `scale-95 ${SUBMIT_CLASS}` : SUBMIT_CLASS}
            >
              <span className="hidden md:inline">Submit</span>{" "}
              <span className="md:hidden">🔍︎</span>
            </button>{" "}
            <select
              name="top_k"
              id="show_top_k_categories"
              role="combobox"
              aria-label="Number of results to show"
              aria-expanded="false"
              aria-haspopup="listbox"
              className="border border-gray-400 rounded text-left px-1 py-2"
              defaultValue={String(fields.topK)}
              onChange={() => send({ type: "top-k-changed" })}
            >
              {TOP_K_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {`Top ${value}`}
                </option>
              ))}
            </select>{" "}
            <div
              id="loading-indicator"
              className="justify-center items-center"
              role="status"
              aria-label="Processing request"
              aria-live="polite"
              data-active={view.loading ? "" : undefined}
            >
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-sky-600 border-t-transparent border-b-transparent"></div>
            </div>
          </div>
          <div className="flex">
            <p className="text-gray-600 mobile-hidden">
              Results are sorted by relevance
            </p>
          </div>
        </div>
      </form>
      <div
        id="results-section"
        className="mt-6"
        aria-live="polite"
        role="region"
        aria-label="Classification Results"
      >
        <div id="results-container" style={{ minHeight: "200px" }}>
          <Panel
            view={view.panel}
            initial={props.initial}
            paywall={(event) => send({ type: "paywall", event })}
          />
        </div>
      </div>
    </>
  );
}
