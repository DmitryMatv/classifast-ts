// Isomorphic. The one way an island runs a pure state machine.
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * `init` depends on the island's props alone, so the hydration render
 * equals the server render. Everything browser-dependent arrives as the
 * `ctx` of an event, starting with the `mounted` event sent after
 * hydration commits. `update` returns the next state and the effects to
 * run, in order.
 */
export interface Machine<P, S, E, C, X> {
  init(props: P): S;
  update(state: S, event: E, ctx: X): readonly [S, readonly C[]];
}

export interface MachineHandle<S, E> {
  readonly state: S;
  readonly send: (event: E) => void;
}

/**
 * Holds the state, stamps each event with a fresh ctx from `observe`, and
 * hands each command to `run`. Events sent while commands run (an effect
 * that reports synchronously) queue behind them, so every event sees the
 * state its predecessors left. `observe` and `run` are read at call time,
 * so they may close over refs that hydration fills in.
 */
export function useMachine<P, S, E, C, X>(
  machine: Machine<P, S, E, C, X>,
  props: P,
  mounted: E,
  observe: () => X,
  run: (command: C, send: (event: E) => void) => void,
): MachineHandle<S, E> {
  const [state, setState] = useState(() => machine.init(props));
  const current = useRef(state);
  const queue = useRef<E[]>([]);
  const running = useRef(false);
  const handlers = useRef({ observe, run });
  handlers.current = { observe, run };

  const send = useCallback(
    (event: E) => {
      queue.current.push(event);
      if (running.current) return;
      running.current = true;
      try {
        while (queue.current.length > 0) {
          const next = queue.current.shift()!;
          const [after, commands] = machine.update(
            current.current,
            next,
            handlers.current.observe(),
          );
          current.current = after;
          setState(after);
          for (const command of commands) handlers.current.run(command, send);
        }
      } finally {
        running.current = false;
      }
    },
    [machine],
  );

  useEffect(() => send(mounted), []);

  return { state, send };
}
