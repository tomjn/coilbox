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
  mpActiveKeys,
  mpConfirmAgreement,
  mpConnect,
  mpDisconnect,
  mpJoinChannel,
  mpReattach,
  mpRegister,
  mpSnapshot,
} from "./bindings";
import { conversationCounts } from "./chat/conversation";
import { triggerRing } from "./ringEffect";
import { VerificationCodeDialog } from "./VerificationCodeDialog";

/**
 * The connection key for a server: `username@host:port`. Shared by the store and
 * any UI that needs to match a configured server against the live connection
 * (e.g. the settings "Connected" badge), so the derivation can't drift.
 */
export function serverKeyFor(server: LobbyServer, username: string): string {
  return `${username}@${server.host}:${server.port}`;
}

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
  /** Reason from the last failed JOINBATTLE/OPENBATTLE, cleared on next attempt. */
  lastJoinError: string | null;
  /**
   * Reason from the last rejected LOGIN (`DENIED`), for a precise inline error on
   * the login form ("Login failed: …"). Set from the `loginDenied` delta, which
   * arrives just before the connection's `disconnected` teardown, and deliberately
   * preserved across that `disconnected` so the inline message survives it. Cleared
   * on the next connect attempt (`connecting` resets the whole mirror).
   */
  loginError: string | null;
  /**
   * Monotonic count of `ENDOFCHANNELS` completions (the `channelListReceived`
   * delta). The channel-list stream emits no per-row delta, so this is the only
   * observable "directory finished loading" signal — the browser drawer watches
   * it advance to end its loading state, honestly, even for an empty directory.
   */
  channelListReceivedSeq: number;
}

const CONSOLE_CAP = 500;

export const initialMirror: LobbyMirror = {
  connected: false,
  phase: null,
  state: null,
  consoleLines: [],
  error: null,
  lastJoinError: null,
  loginError: null,
  channelListReceivedSeq: 0,
};

export type MirrorAction =
  | { type: "connecting" }
  | { type: "event"; ev: LobbyEvent }
  | { type: "snapshot"; state: LobbyState }
  | { type: "reset" }
  | { type: "clearJoinError" };

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
    case "clearJoinError":
      return { ...m, lastJoinError: null };
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
        case "delta": {
          const d = ev.delta;
          if (d.kind === "joinBattleFailed" || d.kind === "openBattleFailed") {
            return { ...m, lastJoinError: d.reason };
          }
          if (d.kind === "loginDenied") {
            return { ...m, loginError: d.reason };
          }
          if (d.kind === "channelListReceived") {
            return {
              ...m,
              channelListReceivedSeq: m.channelListReceivedSeq + 1,
            };
          }
          return m;
        }
        // `delta` is otherwise handled by the provider via a snapshot refresh.
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
  /** Whether a connection is currently live (`activeKey != null`). */
  connected: boolean;
  /**
   * Session-sticky: `true` once the user has connected at least once this app run,
   * and never cleared by a later disconnect/logout. Gates the Chat/Battles sidebar
   * items so they appear on first connect and stay until the app is closed.
   */
  revealed: boolean;
  busy: boolean;
  /** Open a connection as `username` to `server` (throws if no stored password). */
  connect: (server: LobbyServer, username: string) => Promise<void>;
  /**
   * Register a new account on `server`. Resolves once the server accepts it (the
   * connection is then closed); rejects with the server's reason on denial. Does
   * not log in or persist anything — the caller stores the credential/account.
   */
  register: (
    server: LobbyServer,
    username: string,
    password: string,
    email?: string,
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * The connection currently parked awaiting agreement acceptance / an emailed
   * verification code (its `serverKey` and the server's agreement `text`, which
   * may be empty), or null. Drives the verification-code dialog.
   */
  pendingAgreement: { serverKey: string; text: string } | null;
  /** Submit the verification code for the parked connection and resume login. */
  submitAgreementCode: (code: string) => Promise<void>;
  /** Abandon the verification prompt by disconnecting the parked connection. */
  cancelAgreement: () => Promise<void>;
  /** Unread count for a conversation id given its current message count. */
  unreadFor: (id: string, count: number) => number;
  /** Mark a conversation read up to its current message count. */
  markSeen: (id: string, count: number) => void;
  /** Remember a joined channel so it's auto-rejoined on the next connect. */
  rememberChannel: (name: string) => void;
  /** Forget a channel so it's no longer auto-rejoined. */
  forgetChannel: (name: string) => void;
  /** Reason from the last failed battle join, or null. */
  lastJoinError: string | null;
  /** Clear the last join-failure reason (call at the start of a join attempt). */
  clearJoinError: () => void;
  /** Whether the topbar login/status popover is open. */
  loginPopoverOpen: boolean;
  /** Open the topbar login/status popover (used by not-connected CTAs app-wide). */
  openLoginPopover: () => void;
  /** Close the topbar login/status popover. */
  closeLoginPopover: () => void;
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
  const [pendingAgreement, setPendingAgreement] = useState<{
    serverKey: string;
    text: string;
  } | null>(null);

  // One-way "has ever connected this session" latch driving Chat/Battles sidebar
  // visibility. Set on any transition to connected (fresh connect or reload
  // reattach) and never reset, so those views stick across a logout until quit.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (activeKey != null) setRevealed(true);
  }, [activeKey]);
  const [loginPopoverOpen, setLoginPopoverOpen] = useState(false);
  const openLoginPopover = useCallback(() => setLoginPopoverOpen(true), []);
  const closeLoginPopover = useCallback(() => setLoginPopoverOpen(false), []);

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
        mpJoinChannel({ serverKey: activeKey, channel: name }).catch((e) =>
          console.warn("multiplayer: auto-rejoin channel failed", name, e),
        );
      }
    }
  }, [activeKey, mirror.phase, joinedChannels]);

  // Build the event Channel for a connection and wire it to the mirror. Shared by
  // `connect` and the reload-rehydrate path so both handle events identically. The
  // Rust side evicts the connection on any teardown (socket close, or a rejected
  // login), so a `disconnected` event clears the active key to return the UI to the
  // connect screen while keeping the reason.
  const openChannel = useCallback((serverKey: string) => {
    const onEvent = new Channel<LobbyEvent>();
    onEvent.onmessage = (ev) => {
      dispatch({ type: "event", ev });
      if (ev.kind === "delta") {
        // An autohost `!ring` is a transient event, not state - react to it directly
        // (gong + reverberation + taskbar flash) rather than through the snapshot.
        if (ev.delta.kind === "ring") triggerRing(ev.delta.from);
        mpSnapshot({ serverKey })
          .then((r) => dispatch({ type: "snapshot", state: r.state }))
          .catch(() => {});
      }
      // The server can pause a new account's first login on the agreement/
      // verification-code handshake; surface that so the dialog can prompt. Any
      // other phase (e.g. the resume after submitting the code) clears it.
      if (ev.kind === "phase") {
        setPendingAgreement((p) =>
          ev.phase === "awaitAgreement"
            ? { serverKey, text: ev.agreement ?? "" }
            : p?.serverKey === serverKey
              ? null
              : p,
        );
      }
      if (ev.kind === "disconnected") {
        setActiveKey(null);
        setPendingAgreement((p) => (p?.serverKey === serverKey ? null : p));
      }
    };
    return onEvent;
  }, []);

  const connect = useCallback(
    async (server: LobbyServer, username: string) => {
      setBusy(true);
      const serverKey = serverKeyFor(server, username);
      try {
        const cred = await lsGetCredential({ serverId: server.id, username });
        if (!cred.secret) {
          throw new Error(
            "No stored password for this login (set one in Settings).",
          );
        }

        const onEvent = openChannel(serverKey);

        dispatch({ type: "connecting" });
        await mpConnect({
          serverKey,
          host: server.host,
          port: server.port,
          tls: server.tls,
          allowSelfSigned: server.allowSelfSigned,
          username,
          password: cred.secret,
          compatFlags: ["u", "sp"],
          onEvent,
        });
        const snap = await mpSnapshot({ serverKey });
        dispatch({ type: "snapshot", state: snap.state });
        setActiveKey(serverKey);
        setLoginPopoverOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [openChannel],
  );

  // Register a new account: open a throwaway connection that sends REGISTER, then
  // resolve on the `registered` phase / reject on `disconnected` (denial). The
  // connection is torn down before returning so a subsequent login can reuse the
  // key. Registration never logs us in — the emailed-code step happens on the
  // login that follows. `register` doesn't persist anything; the caller stores the
  // credential + account on success.
  const register = useCallback(
    async (
      server: LobbyServer,
      username: string,
      password: string,
      email?: string,
    ) => {
      setBusy(true);
      const serverKey = serverKeyFor(server, username);
      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const onEvent = new Channel<LobbyEvent>();
          onEvent.onmessage = (ev) => {
            if (settled) return;
            if (ev.kind === "phase" && ev.phase === "registered") {
              settled = true;
              resolve();
            } else if (ev.kind === "phase" && ev.phase === "awaitAgreement") {
              // Not expected during REGISTER (uberserver verifies on LOGIN). Fail
              // loud rather than hang: the account may exist — tell the user to
              // log in to enter their code.
              settled = true;
              reject(
                new Error(
                  "Server asked for verification during registration. Try logging in to enter your code.",
                ),
              );
            } else if (
              ev.kind === "delta" &&
              ev.delta.kind === "registrationDenied"
            ) {
              // The purpose-built denial delta carries the server's reason and
              // arrives just before the `disconnected` teardown — reject on it so
              // the form shows a precise reason rather than the generic close.
              settled = true;
              reject(new Error(ev.delta.reason));
            } else if (ev.kind === "disconnected") {
              settled = true;
              reject(new Error(ev.reason ?? "Registration failed"));
            }
          };
          mpRegister({
            serverKey,
            host: server.host,
            port: server.port,
            tls: server.tls,
            allowSelfSigned: server.allowSelfSigned,
            username,
            password,
            email: email ?? null,
            compatFlags: ["u", "sp"],
            onEvent,
          }).catch(reject);
        });
      } finally {
        // Free the registry slot (the register connection stays open on success).
        await mpDisconnect({ serverKey }).catch((e) =>
          console.warn("multiplayer: disconnect cleanup failed", e),
        );
        setBusy(false);
      }
    },
    [],
  );

  const submitAgreementCode = useCallback(
    async (code: string) => {
      if (!pendingAgreement) return;
      await mpConfirmAgreement({ serverKey: pendingAgreement.serverKey, code });
      setPendingAgreement(null);
    },
    [pendingAgreement],
  );

  const cancelAgreement = useCallback(async () => {
    if (!pendingAgreement) return;
    const serverKey = pendingAgreement.serverKey;
    setPendingAgreement(null);
    await mpDisconnect({ serverKey }).catch(() => {});
  }, [pendingAgreement]);

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

  const clearJoinError = useCallback(() => {
    dispatch({ type: "clearJoinError" });
  }, []);

  // After a webview reload the React state resets but the Rust connection task keeps
  // running, so re-adopt any live connection on mount (via `mp_reattach`). Without
  // this a Vite hot-reload / refresh strands the UI as "disconnected" while the
  // backend is still logged in — and a fresh connect would be rejected as a
  // duplicate login. Runs once.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    (async () => {
      try {
        const { keys } = await mpActiveKeys({});
        const serverKey = keys[0];
        if (!serverKey) return;
        const onEvent = openChannel(serverKey);
        await mpReattach({ serverKey, onEvent });
        const snap = await mpSnapshot({ serverKey });
        dispatch({ type: "snapshot", state: snap.state });
        setActiveKey(serverKey);
      } catch {
        // No live connection to re-adopt; stay disconnected.
      }
    })();
  }, [openChannel]);

  return (
    <MultiplayerContext.Provider
      value={{
        mirror,
        activeKey,
        connected: activeKey != null,
        revealed,
        busy,
        connect,
        register,
        disconnect,
        pendingAgreement,
        submitAgreementCode,
        cancelAgreement,
        unreadFor,
        markSeen,
        rememberChannel,
        forgetChannel,
        lastJoinError: mirror.lastJoinError,
        clearJoinError,
        loginPopoverOpen,
        openLoginPopover,
        closeLoginPopover,
      }}
    >
      {children}
      <VerificationCodeDialog />
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

/**
 * Nav/route predicate: has the user connected at least once this session? Gates
 * the Chat/Battles sidebar items and routes (via `useVisible` / `NavGate`).
 */
export function useMpRevealed(): boolean {
  return useMultiplayer().revealed;
}

/**
 * Nav/route predicate: is multiplayer currently disconnected? Gates the Login
 * sidebar item + route so it shows only while logged out.
 */
export function useMpDisconnected(): boolean {
  return !useMultiplayer().connected;
}

/**
 * Nav/route predicate: is the user currently in a battle? Gates the Battle Room
 * sidebar item + route so it appears on join and vanishes on leave.
 */
export function useMpInBattle(): boolean {
  return useMultiplayer().mirror.state?.currentBattle != null;
}

/**
 * The dynamic label for the Battle Room nav item: the joined battle's title, or
 * a generic fallback. Read reactively so picoframe re-renders it as the battle
 * changes (`NavItem.useLabel`).
 */
export function useBattleRoomLabel(): string {
  const state = useMultiplayer().mirror.state;
  const battle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  return battle?.title?.trim() || "Battle Room";
}
