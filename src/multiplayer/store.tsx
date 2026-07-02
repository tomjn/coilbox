import { useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
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
  mpJoinChannel,
  mpSnapshot,
} from "./bindings";
import { conversationCounts } from "./chat/conversation";

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
  /** Unread count for a conversation id given its current message count. */
  unreadFor: (id: string, count: number) => number;
  /** Mark a conversation read up to its current message count. */
  markSeen: (id: string, count: number) => void;
  /** Remember a joined channel so it's auto-rejoined on the next connect. */
  rememberChannel: (name: string) => void;
  /** Forget a channel so it's no longer auto-rejoined. */
  forgetChannel: (name: string) => void;
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

  // Per-conversation "seen up to N messages" marks. Seeded to the connect-time
  // snapshot so persisted DM history and already-present channel logs don't show
  // as unread; conversations appearing AFTER connect start unseen (fully unread).
  const seenRef = useRef<Record<string, number>>({});
  const [, forceSeenTick] = useReducer((n: number) => n + 1, 0);
  const baselineDoneRef = useRef(false);

  useEffect(() => {
    if (activeKey == null) {
      seenRef.current = {};
      baselineDoneRef.current = false;
      return;
    }
    if (!baselineDoneRef.current && mirror.state) {
      seenRef.current = conversationCounts(mirror.state);
      baselineDoneRef.current = true;
      forceSeenTick();
    }
  }, [activeKey, mirror.state]);

  const unreadFor = useCallback((id: string, count: number) => {
    const seen = seenRef.current[id] ?? 0;
    return Math.max(0, count - seen);
  }, []);

  const markSeen = useCallback((id: string, count: number) => {
    if (seenRef.current[id] === count) return;
    seenRef.current[id] = count;
    forceSeenTick();
  }, []);

  // Channels the user has chosen to be in, persisted per `serverKey` so they can be
  // auto-rejoined on the next connect. This is a preference list (re-derivable by
  // rejoining), so it lives in the frame settings store rather than backend state.
  const [joinedChannels, setJoinedChannels] = useSetting<
    Record<string, string[]>
  >("multiplayer.joinedChannels", {});
  const rejoinedForRef = useRef<string | null>(null);

  const rememberChannel = useCallback(
    (name: string) => {
      if (!activeKey) return;
      const cur = joinedChannels[activeKey] ?? [];
      if (cur.includes(name)) return;
      setJoinedChannels({ ...joinedChannels, [activeKey]: [...cur, name] });
    },
    [activeKey, joinedChannels, setJoinedChannels],
  );

  const forgetChannel = useCallback(
    (name: string) => {
      if (!activeKey) return;
      const cur = joinedChannels[activeKey] ?? [];
      if (!cur.includes(name)) return;
      setJoinedChannels({
        ...joinedChannels,
        [activeKey]: cur.filter((c) => c !== name),
      });
    },
    [activeKey, joinedChannels, setJoinedChannels],
  );

  // Auto-rejoin remembered channels once per connection, after login reaches the
  // `ready` phase (JOIN before ACCEPTED would be rejected). The ref guards against
  // re-firing when `joinedChannels` changes mid-session (e.g. the user joins one).
  useEffect(() => {
    if (activeKey == null) {
      rejoinedForRef.current = null;
      return;
    }
    if (mirror.phase === "ready" && rejoinedForRef.current !== activeKey) {
      rejoinedForRef.current = activeKey;
      for (const name of joinedChannels[activeKey] ?? []) {
        mpJoinChannel({ serverKey: activeKey, channel: name }).catch(() => {});
      }
    }
  }, [activeKey, mirror.phase, joinedChannels]);

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
      value={{
        mirror,
        activeKey,
        busy,
        connect,
        disconnect,
        unreadFor,
        markSeen,
        rememberChannel,
        forgetChannel,
      }}
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
