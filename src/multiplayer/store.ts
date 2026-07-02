import { useReducer } from "react";
import type { LobbyEvent, LobbyState, LoginPhase } from "./bindings";

/**
 * A per-connection mirror of the Rust-side lobby state. The Rust plugin owns the
 * authoritative parse; this mirror is refreshed wholesale from `mpSnapshot` on each
 * `delta` event (correctness over incremental cleverness) while `phase` and
 * `console` are driven directly off the event stream.
 */
export interface LobbyMirror {
  connected: boolean;
  phase: LoginPhase | null;
  state: LobbyState | null;
  consoleLines: string[];
  error: string | null;
}

const CONSOLE_CAP = 500;

export const initialMirror: LobbyMirror = {
  connected: false,
  phase: null,
  state: null,
  consoleLines: [],
  error: null,
};

export type MirrorAction =
  | { type: "connecting" }
  | { type: "event"; ev: LobbyEvent }
  | { type: "snapshot"; state: LobbyState }
  | { type: "reset" };

/**
 * Fold one action into the mirror. `delta` events are intentionally not applied
 * here — the page re-fetches a snapshot and dispatches `snapshot` instead, so the
 * mirror never drifts from the authoritative state.
 */
export function mirrorReducer(
  m: LobbyMirror,
  action: MirrorAction,
): LobbyMirror {
  switch (action.type) {
    case "connecting":
      return { ...initialMirror, connected: false };
    case "snapshot":
      return { ...m, state: action.state };
    case "reset":
      return initialMirror;
    case "event": {
      const ev = action.ev;
      switch (ev.kind) {
        case "connected":
          return { ...m, connected: true, error: null };
        case "phase":
          return { ...m, phase: ev.phase };
        case "console": {
          const line = `${ev.direction === "out" ? ">>" : "<<"} ${ev.line}`;
          const next = [...m.consoleLines, line];
          return {
            ...m,
            consoleLines:
              next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next,
          };
        }
        case "disconnected":
          return {
            ...m,
            connected: false,
            error: ev.reason ?? null,
          };
        // `delta` is handled by the page via a snapshot refresh.
        default:
          return m;
      }
    }
    default:
      return m;
  }
}

/** Hook wrapping the mirror reducer for a single lobby connection. */
export function useLobbyMirror() {
  const [mirror, dispatch] = useReducer(mirrorReducer, initialMirror);
  return { mirror, dispatch };
}
