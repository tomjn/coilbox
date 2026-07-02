import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useReducer,
  useState,
} from "react";
import { lsGetCredential } from "../lobby-servers/bindings";
import type { LobbyServer } from "../lobby-servers/config";
import {
  type LobbyEvent,
  type LobbyState,
  type LoginPhase,
  mpConnect,
  mpDisconnect,
  mpSnapshot,
} from "./bindings";

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
 * here — the provider re-fetches a snapshot and dispatches `snapshot` instead, so
 * the mirror never drifts from the authoritative state.
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
          return { ...m, connected: false, error: ev.reason ?? null };
        // `delta` is handled by the provider via a snapshot refresh.
        default:
          return m;
      }
    }
    default:
      return m;
  }
}

interface MultiplayerContextValue {
  mirror: LobbyMirror;
  /** The connected `serverKey`, or null when not connected. */
  activeKey: string | null;
  busy: boolean;
  /** Open a connection to `server` (throws on missing username/password). */
  connect: (server: LobbyServer) => Promise<void>;
  disconnect: () => Promise<void>;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

/**
 * App-level provider owning the (single) live lobby connection. It lives above the
 * router so the connection and its mirror survive navigating away from the Lobby
 * page — the page just reads this context rather than holding connection state
 * locally (which would desync from the persistent Rust-side socket on remount).
 */
export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const [mirror, dispatch] = useReducer(mirrorReducer, initialMirror);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async (server: LobbyServer) => {
    if (!server.username) {
      throw new Error(
        "This server has no configured username (set one in Settings).",
      );
    }
    setBusy(true);
    const serverKey = `${server.username}@${server.host}:${server.port}`;
    try {
      const cred = await lsGetCredential({
        serverId: server.id,
        username: server.username,
      });
      if (!cred.secret) {
        throw new Error(
          "No stored password for this server (set one in Settings).",
        );
      }

      const onEvent = new Channel<LobbyEvent>();
      onEvent.onmessage = (ev) => {
        dispatch({ type: "event", ev });
        if (ev.kind === "delta") {
          mpSnapshot({ serverKey })
            .then((r) => dispatch({ type: "snapshot", state: r.state }))
            .catch(() => {});
        }
        // The Rust side evicts the connection on any teardown (socket close, or a
        // rejected login like a wrong password), so clear the active key to return
        // the UI to the connect screen while keeping the disconnect reason.
        if (ev.kind === "disconnected") {
          setActiveKey(null);
        }
      };

      dispatch({ type: "connecting" });
      await mpConnect({
        serverKey,
        host: server.host,
        port: server.port,
        tls: server.tls,
        allowSelfSigned: server.allowSelfSigned,
        username: server.username,
        password: cred.secret,
        compatFlags: ["u", "sp"],
        onEvent,
      });
      const snap = await mpSnapshot({ serverKey });
      dispatch({ type: "snapshot", state: snap.state });
      setActiveKey(serverKey);
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!activeKey) return;
    setBusy(true);
    try {
      await mpDisconnect({ serverKey: activeKey });
    } finally {
      dispatch({ type: "reset" });
      setActiveKey(null);
      setBusy(false);
    }
  }, [activeKey]);

  return (
    <MultiplayerContext.Provider
      value={{ mirror, activeKey, busy, connect, disconnect }}
    >
      {children}
    </MultiplayerContext.Provider>
  );
}

/** Access the app-level lobby connection. Must be used within the provider. */
export function useMultiplayer(): MultiplayerContextValue {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) {
    throw new Error("useMultiplayer must be used within MultiplayerProvider");
  }
  return ctx;
}
