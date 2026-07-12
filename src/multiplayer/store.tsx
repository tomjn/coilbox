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
import { notify } from "../notify/notify";
import {
  type ChatMsg,
  type Delta,
  type LobbyEvent,
  type LobbyState,
  type LoginPhase,
  mpActiveKeys,
  mpConfirmAgreement,
  mpConnect,
  mpDisconnect,
  mpFriendList,
  mpFriendRequestList,
  mpIgnore,
  mpIgnoreList,
  mpJoinBattle,
  mpJoinChannel,
  mpReattach,
  mpRegister,
  mpSnapshot,
} from "./bindings";
import {
  addChannel,
  normalizeChannelList,
  removeChannel,
  useJoinedChannels,
} from "./channels";
import { conversationCounts } from "./chat/conversation";
import {
  HIGHLIGHT_OWN_KEY,
  HIGHLIGHT_SOUND_KEY,
  HIGHLIGHT_WORDS_KEY,
  matchesHighlight,
} from "./chat/highlight";
import { triggerMentionCue } from "./chat/mentionCue";
import { favouritesFor, useFavourites } from "./friends";
import { addIgnore, ignoredFor, useIgnored } from "./ignore";
import { triggerIngameCue } from "./ingameCue";
import { triggerRing } from "./ringEffect";
import { ServerMessageBoxDialog } from "./ServerMessageBoxDialog";
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
 * The just-arrived chat message referenced by a `chatMessage` / `privateMessage`
 * delta, resolved against the fresh snapshot (deltas carry only a location, not the
 * text). Returns null for any other delta or when it can't be resolved. Used to
 * decide whether an incoming message should fire the highlight mention cue.
 */
function incomingChatMsg(d: Delta, state: LobbyState): ChatMsg | null {
  if (d.kind === "chatMessage" && d.channel) {
    return state.channels[d.channel]?.messages[d.index] ?? null;
  }
  if (d.kind === "privateMessage") {
    const arr = state.dms[d.from];
    return arr?.[arr.length - 1] ?? null;
  }
  return null;
}

/**
 * Backoff delays (ms) between auto-reconnect attempts after an unexpected server
 * drop. Indexed by attempt; the last value is the cap. The array length doubles as
 * the attempt budget — after this many failed attempts the loop gives up.
 */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000];

/** The backoff delay for a 0-based attempt, clamped to the final (capped) value. */
export function reconnectDelay(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[i];
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
  /**
   * The server's confirmed ignore list from the last `IGNORELIST` (the
   * `serverIgnoreList` delta), plus a monotonic count of how many have arrived.
   * The reconcile effect watches the seq advance and reads this payload directly
   * (rather than the async snapshot) so it can't race an in-flight snapshot fetch.
   */
  serverIgnoreList: string[];
  serverIgnoreListSeq: number;
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
  serverIgnoreList: [],
  serverIgnoreListSeq: 0,
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
          // The full server ignore list finished streaming: record it and tick the
          // seq so the reconcile effect runs exactly once against this payload.
          if (d.kind === "serverIgnoreList") {
            return {
              ...m,
              serverIgnoreList: d.ignores,
              serverIgnoreListSeq: m.serverIgnoreListSeq + 1,
            };
          }
          // The server's message-of-the-day arrives as a run of MOTD lines at
          // login. Log each as a clean `MOTD |` entry so the welcome/news reads
          // as a contiguous block in the console, distinct from the raw `<<`
          // wire echo of the same lines.
          if (d.kind === "motd") {
            const next = [...m.consoleLines, `MOTD | ${d.line}`];
            return {
              ...m,
              consoleLines:
                next.length > CONSOLE_CAP ? next.slice(-CONSOLE_CAP) : next,
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
  /**
   * Remember a joined channel (with an optional key) so it's auto-joined on the
   * next connect. Adding an already-remembered channel with a key updates its key.
   */
  rememberChannel: (name: string, key?: string) => void;
  /** Forget a channel so it's no longer auto-joined. */
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
  /**
   * Names of players who *just* transitioned to in-game, held transiently (~2.5s)
   * off each `playerWentIngame` delta so a battle/player row can briefly flash as
   * someone launches. This is a fleeting cue, not persisted status (the steady
   * in-game bit lives in `mirror.state.users[name].status.ingame`).
   */
  justWentIngame: ReadonlySet<string>;
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

  // FIFO queue of `SERVERMSGBOX` texts awaiting acknowledgement. Boxed server
  // messages are important enough that the server asked for a modal, so they're
  // queued (never dropped) rather than overwriting each other; the dialog shows the
  // front and dismissing pops it.
  const [serverMsgBoxes, setServerMsgBoxes] = useState<string[]>([]);

  // Transient "just launched the game" set, populated off `playerWentIngame`
  // deltas and drained per-name after a short delay, so battle rows can flash as a
  // player goes in-game. `stateRef` mirrors the latest snapshot so the frozen
  // event handler (openChannel is `useCallback(..., [])`) can read current battle /
  // founder to decide whether the launcher is our battle's host.
  const [ingameFlash, setIngameFlash] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const stateRef = useRef<LobbyState | null>(null);
  useEffect(() => {
    stateRef.current = mirror.state;
  }, [mirror.state]);

  // Highlight-word preferences (issue #193), mirrored into a ref so the frozen
  // event handler (openChannel is `useCallback(..., [])`) can read the current
  // values when an incoming message arrives, without re-creating the handler.
  const [hlWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [hlOwn] = useSetting<boolean>(HIGHLIGHT_OWN_KEY, true);
  const [hlSound] = useSetting<boolean>(HIGHLIGHT_SOUND_KEY, true);
  const highlightRef = useRef({ words: hlWords, own: hlOwn, sound: hlSound });
  useEffect(() => {
    highlightRef.current = { words: hlWords, own: hlOwn, sound: hlSound };
  }, [hlWords, hlOwn, hlSound]);

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
  const [joinedChannels, setJoinedChannels] = useJoinedChannels();
  const rejoinedForRef = useRef<string | null>(null);

  const rememberChannel = useCallback(
    (name: string, key?: string) => {
      if (!activeKey) return;
      const cur = normalizeChannelList(joinedChannels[activeKey]);
      setJoinedChannels({
        ...joinedChannels,
        [activeKey]: addChannel(cur, name, key),
      });
    },
    [activeKey, joinedChannels, setJoinedChannels],
  );

  const forgetChannel = useCallback(
    (name: string) => {
      if (!activeKey) return;
      const cur = normalizeChannelList(joinedChannels[activeKey]);
      setJoinedChannels({
        ...joinedChannels,
        [activeKey]: removeChannel(cur, name),
      });
    },
    [activeKey, joinedChannels, setJoinedChannels],
  );

  // Auto-join the configured channels once per connection, after login reaches the
  // `ready` phase (JOIN before ACCEPTED would be rejected). The ref guards against
  // re-firing when `joinedChannels` changes mid-session (e.g. the user joins one).
  // Each entry may carry a key/password, passed straight through to JOIN.
  useEffect(() => {
    if (activeKey == null) {
      rejoinedForRef.current = null;
      return;
    }
    if (mirror.phase === "ready" && rejoinedForRef.current !== activeKey) {
      rejoinedForRef.current = activeKey;
      for (const { name, key } of normalizeChannelList(
        joinedChannels[activeKey],
      )) {
        // A settings row can be added before it's named; don't JOIN "".
        if (!name.trim()) continue;
        mpJoinChannel({ serverKey: activeKey, channel: name, key }).catch((e) =>
          console.warn("multiplayer: auto-join channel failed", name, e),
        );
      }
      // Pull the server's ignore list so it can be reconciled with the local one
      // (see the reconcile effect). Best-effort: unsupported servers just never
      // send a list, and local hiding still applies.
      mpIgnoreList({ serverKey: activeKey }).catch(() => {});
    }
  }, [activeKey, mirror.phase, joinedChannels]);

  // Reconcile the local ignore list with the server's once its IGNORELIST arrives:
  // fold any server-confirmed ignores we lack into the local store, and push any
  // local-only ignores up so the server suppresses them too. Driven off the
  // received-list seq (not the map) so setting the map here can't re-trigger it,
  // and reading the delta payload (`serverIgnoreList`) avoids racing the snapshot.
  const [ignored, setIgnored] = useIgnored();
  const ignoredRef = useRef(ignored);
  useEffect(() => {
    ignoredRef.current = ignored;
  }, [ignored]);
  const ignoreReconciledRef = useRef(0);
  useEffect(() => {
    if (activeKey == null) {
      ignoreReconciledRef.current = 0;
      return;
    }
    const seq = mirror.serverIgnoreListSeq;
    if (seq === 0 || seq === ignoreReconciledRef.current) return;
    ignoreReconciledRef.current = seq;

    const server = mirror.serverIgnoreList;
    const local = ignoredFor(ignoredRef.current, activeKey);

    // Add server-confirmed ignores we don't have locally (addIgnore dedupes).
    let next = ignoredRef.current;
    for (const name of server) next = addIgnore(next, activeKey, name);
    if (next !== ignoredRef.current) setIgnored(next);

    // Push local-only ignores up so both sides converge. Best-effort; a server
    // that just replied with an empty list may still not support IGNORE.
    const known = new Set(server.map((n) => n.toLowerCase()));
    for (const name of local) {
      if (name.trim() && !known.has(name.toLowerCase())) {
        mpIgnore({ serverKey: activeKey, username: name }).catch(() => {});
      }
    }
  }, [
    activeKey,
    mirror.serverIgnoreListSeq,
    mirror.serverIgnoreList,
    setIgnored,
  ]);

  // Sync the server-side friend list + pending requests once per connection, after
  // login reaches `ready`. These commands are a no-op on servers without friend
  // support (they just ignore the line), so failure is swallowed and never blocks
  // the UI — local favourites keep working regardless.
  const friendsSyncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      friendsSyncedForRef.current = null;
      return;
    }
    if (mirror.phase === "ready" && friendsSyncedForRef.current !== activeKey) {
      friendsSyncedForRef.current = activeKey;
      mpFriendList({ serverKey: activeKey }).catch(() => {});
      mpFriendRequestList({ serverKey: activeKey }).catch(() => {});
    }
  }, [activeKey, mirror.phase]);

  // Notify when a friend (server-side or a client-local favourite) comes online or
  // goes offline. The lobby has no friend presence event, so this is derived from
  // the roster: diff the online set between snapshots. Gated on `ready` (the
  // initial ADDUSER dump completes before then) and baselined on the first ready
  // snapshot so the login roster flood never fires a burst of notifications.
  const [favourites] = useFavourites();
  const prevRosterRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const st = mirror.state;
    if (activeKey == null || mirror.phase !== "ready" || !st) {
      prevRosterRef.current = null;
      return;
    }
    const roster = new Set(Object.keys(st.users));
    const prev = prevRosterRef.current;
    prevRosterRef.current = roster;
    if (prev == null) return; // baseline the first ready snapshot, don't notify
    const watched = new Set<string>([
      ...(st.friends ?? []),
      ...favouritesFor(favourites, activeKey),
    ]);
    for (const name of watched) {
      if (name === st.myUsername) continue;
      const online = roster.has(name);
      if (online && !prev.has(name))
        void notify({ title: `${name} is online` });
      else if (!online && prev.has(name))
        void notify({ title: `${name} went offline` });
    }
  }, [activeKey, mirror.phase, mirror.state, favourites]);

  // --- Auto-rejoin on unexpected server drop (issue #192) --------------------
  // Distinct from the reload-reattach path above: this handles a genuine server-
  // side disconnect, where the Rust task dies and self-evicts. We re-run `connect`
  // (which re-fetches the password and, on reaching `ready`, replays channels via
  // the effect above) and best-effort rejoin the battle we were in.
  const [autoRejoin] = useSetting<boolean>("multiplayer.autoRejoin", true);
  const autoRejoinRef = useRef(autoRejoin);
  useEffect(() => {
    autoRejoinRef.current = autoRejoin;
  }, [autoRejoin]);

  // `true` while a user-initiated disconnect/cancel is in flight, so its clean
  // `disconnected` event isn't mistaken for an unexpected drop. Reset on connect.
  const intentionalRef = useRef(false);
  // `true` once a session reached `ready`; only then is a drop worth reconnecting
  // (excludes login-denied / initial-connect failures, which never logged in).
  const loggedInRef = useRef(false);
  // Enough to call `connect()` again; captured on each connect attempt.
  const reconnectCtxRef = useRef<{
    server: LobbyServer;
    username: string;
  } | null>(null);
  // The battle to rejoin after a reconnect reaches `ready` (captured before the
  // drop tears down state). Cleared once attempted or on a manual connect.
  const rejoinBattleRef = useRef<{
    id: number;
    scriptPassword: string | null;
  } | null>(null);
  // Single-loop guards: a monotonic generation invalidates any in-flight loop, and
  // the pending timer is tracked so it can be cancelled.
  const reconnectGenRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  // Late-bound so the frozen `openChannel` handler can invoke the latest logic.
  const handleUnexpectedDropRef = useRef<() => void>(() => {});

  // Cancel any running reconnect loop (a manual connect/disconnect supersedes it).
  const stopReconnect = useCallback(() => {
    reconnectGenRef.current += 1;
    reconnectAttemptRef.current = 0;
    rejoinBattleRef.current = null;
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

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
        const d = ev.delta;
        // An autohost `!ring` is a transient event, not state - react to it directly
        // (gong + reverberation + taskbar flash) rather than through the snapshot.
        if (d.kind === "ring") triggerRing(d.from);
        // A player transitioning to in-game is a transient moment, not just the
        // resulting status (which the snapshot already carries). Flash the launcher's
        // row briefly for everyone; when it's the founder of the battle we're in (and
        // not ourselves), also fire the softer "it's starting, get in" cue - the host
        // launching is the actionable "everyone's waiting on one person" case.
        else if (d.kind === "playerWentIngame") {
          const name = d.name;
          setIngameFlash((prev) => new Set(prev).add(name));
          window.setTimeout(() => {
            setIngameFlash((prev) => {
              if (!prev.has(name)) return prev;
              const next = new Set(prev);
              next.delete(name);
              return next;
            });
          }, 2500);
          const st = stateRef.current;
          const battle =
            st?.currentBattle != null
              ? st.battles[String(st.currentBattle)]
              : undefined;
          if (battle && battle.host === name && st?.myUsername !== name) {
            triggerIngameCue(name);
          }
        }
        // Server refusals are one-off error events with nothing to re-render, so
        // surface them as non-blocking error toasts (routed to an OS banner when
        // unfocused). The raw FAILED/JOINFAILED line is already in the lobby
        // console for history.
        else if (d.kind === "joinChannelFailed")
          void notify({
            title: `Couldn't join ${d.channel}`,
            body: d.reason || undefined,
            level: "error",
          });
        else if (d.kind === "commandFailed") {
          // Ignore-sync commands are best-effort: a server without IGNORE support
          // may reject them, but local hiding still applies, so degrade silently
          // rather than nag the user (the raw FAILED line is still in the console).
          const cmd = d.command.toUpperCase();
          if (cmd !== "IGNORE" && cmd !== "UNIGNORE" && cmd !== "IGNORELIST") {
            void notify({
              title: d.command
                ? `Command failed: ${d.command}`
                : "Command failed",
              body: d.reason || undefined,
              level: "error",
            });
          }
        }
        // A server announcement is a transient event too. Plain SERVERMSG is an
        // unobtrusive info toast; a SERVERMSGBOX was flagged important by the
        // server, so it's queued into a blocking dialog. Empty payloads are
        // ignored so a malformed line can't pop a contentless toast/modal. The raw
        // line is already in the protocol console for history.
        else if (d.kind === "serverMessage") {
          const text = d.text.trim();
          if (text) {
            if (d.boxed) setServerMsgBoxes((q) => [...q, d.text]);
            else void notify({ title: "Server message", body: d.text });
          }
        }
        mpSnapshot({ serverKey })
          .then((r) => {
            dispatch({ type: "snapshot", state: r.state });
            // A chat/private message that mentions a highlight word or our own
            // username fires the mention cue (a soft ping + taskbar flash), gated
            // behind the sound setting. Skip our own messages and non-chat lines
            // (join/leave/system). The text lives in the snapshot, not the delta.
            const msg = incomingChatMsg(d, r.state);
            const hl = highlightRef.current;
            if (
              hl.sound &&
              msg &&
              msg.from !== r.state.myUsername &&
              (msg.kind === "said" ||
                msg.kind === "saidEx" ||
                msg.kind === "saidBattle" ||
                msg.kind === "private") &&
              matchesHighlight(msg.text, hl.words, r.state.myUsername, hl.own)
            ) {
              triggerMentionCue(msg.from);
            }
          })
          .catch(() => {});
      }
      // The server can pause a new account's first login on the agreement/
      // verification-code handshake; surface that so the dialog can prompt. Any
      // other phase (e.g. the resume after submitting the code) clears it.
      if (ev.kind === "phase") {
        // Mark a session as "logged in" once it reaches ready — only such a
        // session's later drop is worth auto-reconnecting.
        if (ev.phase === "ready") loggedInRef.current = true;
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
        handleUnexpectedDropRef.current();
      }
    };
    return onEvent;
  }, []);

  // The core connect, shared by the public `connect` and the auto-reconnect loop.
  // Records the reconnect context and resets the per-session drop flags so a later
  // unexpected disconnect can rebuild the session.
  const doConnect = useCallback(
    async (server: LobbyServer, username: string) => {
      setBusy(true);
      intentionalRef.current = false;
      loggedInRef.current = false;
      reconnectCtxRef.current = { server, username };
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

  // Public connect: a manual login supersedes any in-flight auto-reconnect loop.
  const connect = useCallback(
    async (server: LobbyServer, username: string) => {
      stopReconnect();
      await doConnect(server, username);
    },
    [doConnect, stopReconnect],
  );

  // Run the reconnect loop after an unexpected drop: retry `doConnect` on a bounded
  // backoff. A monotonic generation lets a manual connect/disconnect invalidate it,
  // and it self-stops on success or after exhausting the attempt budget.
  const runReconnect = useCallback(() => {
    const gen = ++reconnectGenRef.current;
    reconnectAttemptRef.current = 0;
    const step = async () => {
      if (reconnectGenRef.current !== gen) return; // superseded
      const ctx = reconnectCtxRef.current;
      if (!ctx) return;
      try {
        await doConnect(ctx.server, ctx.username);
        if (reconnectGenRef.current !== gen) return;
        void notify({ title: "Reconnected to multiplayer", level: "success" });
      } catch {
        if (reconnectGenRef.current !== gen) return;
        const attempt = ++reconnectAttemptRef.current;
        if (attempt >= RECONNECT_DELAYS_MS.length) {
          void notify({
            title: "Couldn't reconnect to multiplayer",
            body: "Log in again from the topbar when you're ready.",
            level: "error",
          });
          return;
        }
        reconnectTimerRef.current = window.setTimeout(
          step,
          reconnectDelay(attempt),
        );
      }
    };
    reconnectTimerRef.current = window.setTimeout(step, reconnectDelay(0));
  }, [doConnect]);

  // React to a `disconnected` event: start the reconnect loop only for a genuine,
  // unexpected drop of a logged-in session (not a manual disconnect, a login
  // denial, or when the feature is off). Captures the current battle first so it
  // can be rejoined once reconnected.
  const handleUnexpectedDrop = useCallback(() => {
    if (intentionalRef.current) return;
    if (!autoRejoinRef.current) return;
    if (!loggedInRef.current) return;
    if (!reconnectCtxRef.current) return;
    const st = stateRef.current;
    if (st?.currentBattle != null) {
      const battle = st.battles[String(st.currentBattle)];
      const me = st.myUsername ? battle?.members[st.myUsername] : undefined;
      rejoinBattleRef.current = {
        id: st.currentBattle,
        scriptPassword: me?.scriptPassword ?? null,
      };
    } else {
      rejoinBattleRef.current = null;
    }
    void notify({ title: "Connection lost — reconnecting…" });
    runReconnect();
  }, [runReconnect]);
  useEffect(() => {
    handleUnexpectedDropRef.current = handleUnexpectedDrop;
  }, [handleUnexpectedDrop]);

  // After a reconnect reaches `ready`, rejoin the battle captured before the drop if
  // it's still open (channels replay via the effect above). Once per connection and
  // best-effort — a closed/passworded battle is skipped, never a crash.
  const rejoinBattleDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      rejoinBattleDoneRef.current = null;
      return;
    }
    if (mirror.phase !== "ready" || rejoinBattleDoneRef.current === activeKey) {
      return;
    }
    rejoinBattleDoneRef.current = activeKey;
    const target = rejoinBattleRef.current;
    rejoinBattleRef.current = null;
    if (!target) return;
    const stillOpen = mirror.state?.battles[String(target.id)] != null;
    if (!stillOpen) {
      void notify({ title: "Your battle is no longer open" });
      return;
    }
    mpJoinBattle({
      serverKey: activeKey,
      id: target.id,
      scriptPassword: target.scriptPassword,
    }).catch((e) => console.warn("multiplayer: auto-rejoin battle failed", e));
  }, [activeKey, mirror.phase, mirror.state]);

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
    // User-abandoned login: its `disconnected` is intentional, not a drop.
    intentionalRef.current = true;
    const serverKey = pendingAgreement.serverKey;
    setPendingAgreement(null);
    await mpDisconnect({ serverKey }).catch(() => {});
  }, [pendingAgreement]);

  const disconnect = useCallback(async () => {
    // Mark intentional and kill any reconnect loop before the guard, so a manual
    // "log out" can't be mistaken for a drop even mid-reconnect (no active key).
    intentionalRef.current = true;
    stopReconnect();
    if (!activeKey) return;
    setBusy(true);
    try {
      await mpDisconnect({ serverKey: activeKey });
    } finally {
      dispatch({ type: "reset" });
      setActiveKey(null);
      setBusy(false);
    }
  }, [activeKey, stopReconnect]);

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
        justWentIngame: ingameFlash,
      }}
    >
      {children}
      <VerificationCodeDialog />
      <ServerMessageBoxDialog
        text={serverMsgBoxes[0] ?? null}
        onDismiss={() => setServerMsgBoxes((q) => q.slice(1))}
      />
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
