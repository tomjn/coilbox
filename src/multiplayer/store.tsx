import { useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { directServer } from "../direct/room";
import { lsGetCredential } from "../lobby-servers/bindings";
import {
  allServers,
  autoConnectTargets,
  BUILTIN_SERVERS,
  type LobbyAccount,
  type LobbyProtocol,
  type LobbyServer,
  resolveLastLogin,
  serverProtocol,
  tachyonBaseUrl,
  tlsModeFor,
  useCustomServers,
  useLastLogin,
  useLobbyAccounts,
} from "../lobby-servers/config";
import { notify } from "../notify/notify";
import type { ClientFlags } from "./awayStatus";
import {
  forgetBattleMovedUnless,
  recordBattleMoved,
} from "./battle/battleMoved";
import {
  type ChatMsg,
  type Delta,
  type LobbyEvent,
  type LobbyState,
  mpActiveKeys,
  mpCancelConnect,
  mpChangeEmail,
  mpChangeEmailRequest,
  mpChangePassword,
  mpConfirmAgreement,
  mpConnect,
  mpConnectTachyon,
  mpConnectZerok,
  mpDisconnect,
  mpGetUserInfo,
  mpJoinChannel,
  mpReattach,
  mpRecoverPassword,
  mpRegister,
  mpRegisterZerok,
  mpResendVerification,
  mpSnapshot,
  mpSubmitRecoveryCode,
  mpTachyonSignedIn,
  mpTachyonSignIn,
  mpWaitUntilReady,
} from "./bindings";
import { ConnectionSession } from "./ConnectionSession";
import {
  forgetJoinedChannel,
  rememberJoinedChannel,
  useJoinedChannels,
} from "./channels";
import {
  HIGHLIGHT_OWN_KEY,
  HIGHLIGHT_WORDS_KEY,
  matchesHighlight,
} from "./chat/highlight";
import { triggerMentionCue } from "./chat/mentionCue";
import {
  CLIENT_ID_KEY,
  newClientId,
  newZerokInstallId,
  ZEROK_INSTALL_ID_KEY,
} from "./clientId";
import {
  type AccountInfo,
  type ConnectionRuntime,
  type ConnectionState,
  type Connections,
  connectionsReducer,
  hasLiveLogin,
  newRuntime,
  pendingAgreement as pickPendingAgreement,
  pendingDebriefing as pickPendingDebriefing,
} from "./connections";
import { DebriefingDrawer } from "./DebriefingDrawer";
import { useFavourites } from "./friends";
import { useIgnored } from "./ignore";
import { triggerIngameCue } from "./ingameCue";
import { MatchFoundPanel } from "./MatchFoundPanel";
import { initialMirror, type LobbyMirror, type MirrorAction } from "./mirror";
import { protocolForKey } from "./protocol";
import { triggerRing } from "./ringEffect";
import { ServerMessageBoxDialog } from "./ServerMessageBoxDialog";
import { VerificationCodeDialog } from "./VerificationCodeDialog";

export type { AccountInfo, ConnectionState, Connections } from "./connections";
export { hasLiveLogin, liveConnectionKeys, liveRoomKey } from "./connections";
export {
  initialMirror,
  type LobbyMirror,
  type MirrorAction,
  mirrorReducer,
  serverMessagesSince,
} from "./mirror";

/**
 * The connection key for a server: `username@host:port`. Shared by the store and
 * any UI that needs to match a configured server against the live connection
 * (e.g. the settings "Connected" badge), so the derivation can't drift.
 */
export function serverKeyFor(server: LobbyServer, username: string): string {
  return `${username}@${server.host}:${server.port}`;
}

/** The `host:port` half of a `serverKey`, for a `coilbox://join` link (issue
 * #498) - a link should carry where to connect, not who was connected. */
export function serverAddressFromKey(serverKey: string): string {
  return serverKey.slice(serverKey.indexOf("@") + 1);
}

/** The `username` half of a `serverKey`, e.g. for a sidebar heading that
 * names which account a grouped connection belongs to (issue #2843). */
export function usernameFromKey(serverKey: string): string {
  return serverKey.slice(0, serverKey.indexOf("@"));
}

/**
 * The configured display name of the server a `serverKey` names, matched the
 * same way {@link protocolForKey} matches protocol (host:port against the
 * built-in catalog plus the user's own servers, not the profile-filtered
 * list). Falls back to the bare `host:port` for a key naming a server no
 * longer in the catalog, or a direct room, which has no catalog entry at all.
 */
export function serverNameFor(
  serverKey: string,
  servers: LobbyServer[],
): string {
  const server = servers.find((s) =>
    serverKey.endsWith(`@${s.host}:${s.port}`),
  );
  return server?.name ?? serverAddressFromKey(serverKey);
}

/**
 * The host half of a `serverKey`, lower-cased, which is what decides whether two
 * keys are the same lobby server. Beyond All Reason's TASServer and Tachyon
 * entries share a host on different ports and are one server behind two
 * protocols (issue #2848).
 */
export function serverHostFromKey(serverKey: string): string {
  const address = serverAddressFromKey(serverKey);
  const colon = address.lastIndexOf(":");
  return (colon < 0 ? address : address.slice(0, colon)).toLowerCase();
}

/** A connection that stands in the way of another, for `connectBlockedReason`. */
export interface OpenConnection {
  serverKey: string;
  /** Still in its handshake, rather than live. */
  opening: boolean;
  /** A room this client hosts or joined, rather than a lobby server. */
  direct: boolean;
}

/**
 * Why a connect must not go ahead, or null when it may. Pure.
 *
 * Coilbox holds one connection per lobby server, where the same host is the
 * same server whichever port or account (issue #2848). Two accounts on one
 * server at once would be confusing to follow and could upset the server.
 * Beside those it holds at most one room (issue #2850). A room is not a lobby
 * server, so a room and a lobby login never stand in each other's way, even
 * when both are on this machine.
 *
 * This is read where the rule can actually be enforced, at the moment the
 * connection is opened, because a form handed to a drawer keeps the element it
 * was opened with and cannot see a connection arriving behind it (issue #2149).
 *
 * A connect still in its handshake counts as much as a live one. It is the case
 * a form cannot see at all, because an auto-reconnect halfway through has no
 * active key yet, and it is read from a ref written before the first `await`, so
 * two connects racing each other cannot both find the way clear. A live
 * connection is named in preference to one still opening, because it is the one
 * somebody can act on.
 *
 * A room is named by its address rather than as "the room" someone hosts. Both
 * kinds of key are `username@host:port`, and a room could be this client's own
 * or somebody else's, which is the mistake behind issue #1618, so this says
 * where instead of whose.
 */
export function connectBlockedReason(
  open: readonly OpenConnection[],
  /** The key the caller is about to open. */
  serverKey: string,
  /** Whether that key is a room. */
  direct: boolean,
): string | null {
  const host = serverHostFromKey(serverKey);
  const inTheWay = open.filter(
    (c) =>
      c.serverKey !== serverKey &&
      c.direct === direct &&
      (direct || serverHostFromKey(c.serverKey) === host),
  );
  const other =
    inTheWay.find((c) => !c.opening) ?? inTheWay.find((c) => c.opening);
  if (!other) return null;
  if (direct) {
    const address = serverAddressFromKey(other.serverKey);
    return other.opening
      ? `A room at ${address} is already opening. Wait for that one to finish: coilbox can be in one room at a time.`
      : `You are in a room already, at ${address}. Leave it first: coilbox can be in one room at a time.`;
  }
  const who = usernameFromKey(other.serverKey);
  const where = serverHostFromKey(other.serverKey);
  return other.opening
    ? `A login to ${where} as ${who} is already opening. Wait for that one to finish.`
    : `You are already logged in to ${where} as ${who}. Log out of that account first.`;
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

/**
 * How long to wait for the server's answer to a command that has no reply of its
 * own. `CHANGEPASSWORD` is answered by a bare `SERVERMSG`, so the only way to
 * pair a reply with a request is to watch for the next one after asking.
 *
 * Matches the Rust `READY_TIMEOUT` (`conn.rs:122`) and for the same reason.
 * Generous, because a real server behind a slow link is not a failure, and
 * bounded, because nothing below this times out at all.
 */
export const SERVER_REPLY_TIMEOUT_MS = 20_000;

/** uberserver's exact wording on a successful `CHANGEPASSWORD` (`Protocol.py:3327`). */
export const CHANGE_PASSWORD_SUCCESS = "Password changed successfully.";

/**
 * Wait for whichever of a pair of deltas answers a signed-in account command
 * that does carry its own accept/deny token (`CHANGEEMAILREQUEST`,
 * `CHANGEEMAIL`, `RESENDVERIFICATION`), unlike `CHANGEPASSWORD`, which has
 * none and is paired against a bare `SERVERMSG` instead. Resolves on
 * `acceptKind`, rejects with the delta's `reason` on `denyKind`, and times
 * out after `SERVER_REPLY_TIMEOUT_MS` if neither arrives.
 *
 * `denyKind` is shared between a request step and its follow-up code step
 * (the reducer folds e.g. `CHANGEEMAILREQUESTDENIED` and `CHANGEEMAILDENIED`
 * into the one `changeEmailDenied` delta), which is fine as long as only one
 * step is ever waiting at a time: whichever call is pending is the one the
 * denial belongs to.
 *
 * `cleanup` is returned alongside the promise so a caller whose send failed,
 * meaning the command never reached the wire and so no reply is coming, can
 * remove the waiter and clear the timer immediately rather than leaving both
 * live to reject into nothing `SERVER_REPLY_TIMEOUT_MS` later and, in the
 * meantime, block a retry behind a stale waiter. Safe to call more than once
 * and after the promise has already settled.
 */
function waitForAccountDelta(
  waiters: Set<(d: Delta) => void>,
  acceptKind: Delta["kind"],
  denyKind: Delta["kind"],
): { promise: Promise<void>; cleanup: () => void } {
  let waiter: (d: Delta) => void = () => {};
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    clearTimeout(timer);
    waiters.delete(waiter);
  };
  const promise = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("The server did not answer."));
    }, SERVER_REPLY_TIMEOUT_MS);
    waiter = (d) => {
      if (d.kind !== acceptKind && d.kind !== denyKind) return;
      cleanup();
      if (d.kind === denyKind) {
        reject(new Error("reason" in d ? d.reason : "Request refused."));
      } else {
        resolve();
      }
    };
    waiters.add(waiter);
  });
  return { promise, cleanup };
}

/**
 * How long deltas accumulate before the mirror is refreshed once for all of
 * them. Short enough to read as immediate, long enough that a server announcing
 * a few hundred status changes at once costs one snapshot rather than hundreds.
 */
export const SNAPSHOT_BATCH_MS = 50;

/** The backoff delay for a 0-based attempt, clamped to the final (capped) value. */
export function reconnectDelay(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[i];
}

/**
 * Whether a failed connect needs a new browser sign-in rather than another try.
 *
 * Only a Tachyon connect can, and only once the server has refused the stored
 * sign-in. A TASServer login has a password behind it and a Tachyon sign-in that
 * is merely unreachable is worth retrying, so both answer false and take the
 * backoff. So does a question the Rust side could not answer.
 */
async function needsSignIn(
  server: LobbyServer,
  username: string,
): Promise<boolean> {
  if (serverProtocol(server) !== "tachyon") return false;
  try {
    const { signedIn } = await mpTachyonSignedIn({
      serverId: server.id,
      username,
    });
    return !signedIn;
  } catch {
    return false;
  }
}

/**
 * How `recoverPassword` ended. uberserver emails a code and waits for
 * `submitRecoveryCode`. teiserver has no in-lobby recovery and hands back a web
 * address instead, with nothing further to send.
 */
export type RecoveryStart =
  | { kind: "codeSent"; serverKey: string }
  | { kind: "redirected"; url: string };

interface MultiplayerContextValue {
  /**
   * The mirror of the connection this context describes: the live one, or the
   * one opening, or the last one to drop so its error stays readable.
   */
  mirror: LobbyMirror;
  /**
   * Every connection this session has opened and not closed, by server key
   * (issue #2841). Read one with {@link useConnection}.
   */
  connections: Connections;
  /** The connected `serverKey`, or null when not connected. */
  activeKey: string | null;
  /**
   * Whether a lobby login is currently live. A room does not count (issue
   * #2905), so it alone does not hold this open the way a login does.
   */
  connected: boolean;
  /**
   * The wire protocol the live connection speaks, `tasserver` when there is none.
   * Surfaces with no Tachyon equivalent read this and hide themselves: named
   * channels, moderation, and hosting a battle. See `docs/tachyon-protocol.md`.
   */
  protocol: LobbyProtocol;
  /**
   * Session-sticky: `true` once the user has connected at least once this app run,
   * and never cleared by a later disconnect/logout. Gates the Chat/Battles sidebar
   * items so they appear on first connect and stay until the app is closed.
   */
  revealed: boolean;
  /** Whether anything at all is busy: connecting, disconnecting, registering,
   * signing in or recovering, on any connection. For a caller that gates on
   * one specific account rather than the whole app, see {@link busyKeys}. */
  busy: boolean;
  /**
   * The server keys with a connect, disconnect, sign-in, registration or
   * recovery in flight against them (issue #2846). A register or recovery
   * key is the account it targets, computed the same way {@link connect}
   * does, even before that account has a live connection entry.
   */
  busyKeys: ReadonlySet<string>;
  /** Open a connection as `username` to `server` (throws if no stored password). */
  connect: (server: LobbyServer, username: string) => Promise<void>;
  /**
   * Connect every one of `targets` not already connected, one after another,
   * skipping a Tachyon login that needs a browser sign-in the same way the
   * boot reconnect does (issue #2849). Backs the login panel's "Reconnect
   * all" (issue #2927). One failing does not stop the rest, and each raises
   * its own notification.
   */
  reconnectAll: (
    targets: { account: LobbyAccount; server: LobbyServer }[],
  ) => Promise<void>;
  /**
   * Connect to a room, and answer with its `serverKey` so the caller can act on
   * the connection before React has re-rendered. Loopback for a room this client
   * hosts, or `address` for somebody else's, found on the network or typed in.
   *
   * Separate from `connect` only in where the credential comes from: a room has no
   * accounts, so there is no keychain entry to read and nothing worth remembering
   * as a last-used login.
   */
  connectDirect: (
    port: number,
    username: string,
    address?: string,
  ) => Promise<string>;
  /**
   * Sign in to a Tachyon server through the system browser, storing the result so
   * `connect` can use it. Resolves once the user has finished in the browser, and
   * rejects if they never do. This is the only path in the app that opens one, so
   * an automatic reconnect cannot.
   */
  signIn: (server: LobbyServer, username: string) => Promise<void>;
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
  /**
   * Start account recovery for `email` on a throwaway connection. Resolves with
   * where the flow landed: a code was emailed and `submitRecoveryCode` is next,
   * or the server redirected us to a web page and there is nothing further to
   * do. The connection stays open on `codeSent` for `submitRecoveryCode` to
   * finish and tear down. Rejects with the server's reason on denial.
   */
  recoverPassword: (
    server: LobbyServer,
    email: string,
  ) => Promise<RecoveryStart>;
  /**
   * Finish account recovery with the emailed code, on the connection
   * `recoverPassword` left open. Resolves with the username a locked-out user
   * had no other way to learn, and disconnects. Rejects with the server's
   * reason on a wrong code, but leaves the connection live for a retry
   * (uberserver allows three attempts) rather than disconnecting. Call
   * `cancelRecovery` to close it if the user gives up instead.
   *
   * Resolves with a null username when the server closed the connection
   * without answering, which uberserver does after a good code. See the
   * implementation for why.
   */
  submitRecoveryCode: (
    serverKey: string,
    code: string,
  ) => Promise<{ username: string | null }>;
  /**
   * Close a recovery connection left open by a refused code, for when the
   * user abandons the flow rather than retrying. Safe to call on a
   * connection that never parked awaiting a code, or one already gone.
   */
  cancelRecovery: (serverKey: string) => Promise<void>;
  /**
   * Change the signed-in account's password. `CHANGEPASSWORD` has no accept or
   * deny reply of its own, so this resolves off the next `SERVERMSG` and reads
   * `succeeded` to tell a refusal from the real answer.
   */
  changePassword: (
    current: string,
    next: string,
    serverKey?: string,
  ) => Promise<{ message: string; succeeded: boolean }>;
  /** Ask for a code to confirm a new email address on the signed-in account. */
  changeEmailRequest: (email: string, serverKey?: string) => Promise<void>;
  /** Confirm a new email address with the emailed code. */
  changeEmail: (
    email: string,
    code: string,
    serverKey?: string,
  ) => Promise<void>;
  /** Ask for the signup verification code again. */
  resendVerification: (email: string, serverKey?: string) => Promise<void>;
  /** Ask the server for the signed-in account's details, answered as
   * `accountInfo` deltas that land in {@link accountInfo}. */
  getUserInfo: (serverKey?: string) => void;
  /** The signed-in account's details, merged from the deltas `getUserInfo`
   * triggers, or null before any have arrived. */
  accountInfo: AccountInfo | null;
  disconnect: (serverKey?: string) => Promise<void>;
  /** Abort a connect still in progress (the "Connecting…" state), returning to
   * disconnected without an error or an auto-reconnect. */
  cancelConnect: (serverKey?: string) => Promise<void>;
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
  unreadFor: (id: string, count: number, serverKey?: string) => number;
  /** Mark a conversation read up to its current message count. */
  markSeen: (id: string, count: number, serverKey?: string) => void;
  /**
   * Remember a joined channel (with an optional key) so it's auto-joined on the
   * next connect. Adding an already-remembered channel with a key updates its key.
   */
  rememberChannel: (name: string, key?: string, serverKey?: string) => void;
  /** Forget a channel so it's no longer auto-joined. */
  forgetChannel: (name: string, serverKey?: string) => void;
  /**
   * Send a `JOIN` for a channel the user chose, marking it as user-requested so the
   * server's join confirm persists it to the autojoin list (server-forced joins are
   * not). Prefer this over calling `mpJoinChannel` directly from the UI.
   */
  requestJoinChannel: (
    channel: string,
    key?: string,
    serverKey?: string,
  ) => Promise<unknown>;
  /** Reason from the last failed battle join, or null. */
  lastJoinError: string | null;
  /** Clear the last join-failure reason (call at the start of a join attempt). */
  clearJoinError: (serverKey?: string) => void;
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
  /**
   * Channels whose auto-rejoin the server refused this session (name -> reason),
   * for the active connection. Transient — the entry stays on the autojoin list,
   * but the auto-join settings flag it. Empty for other accounts / when offline.
   */
  channelJoinFailures: Record<string, string>;
  /**
   * Our own client status as last resolved (issue #333). `MYSTATUS` sends both
   * bits together, so the provider owns the pair and is its only sender.
   */
  status: ClientFlags;
  /** Flag the running game, from the battle room's launch/exit path. Sent on
   *  every connection, since the player is in the game on all of them. */
  setIngame: (ingame: boolean) => void;
  /** Whether the user has set themselves away by hand. */
  manualAway: boolean;
  /** Set (or clear) away by hand, on every connection. Sticky: activity won't
   *  clear it, only the user will, and it survives the idle watcher being
   *  off. Cleared once no connection is left. */
  setManualAway: (away: boolean) => void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

/**
 * App-level provider owning the (single) live lobby connection. It lives above the
 * router so the connection and its mirror survive navigating away from the Lobby
 * page — the page just reads this context rather than holding connection state
 * locally (which would desync from the persistent Rust-side socket on remount).
 */
export function MultiplayerProvider({ children }: { children: ReactNode }) {
  // Each connection's state, keyed by server key (issue #2841). The context's
  // single-connection fields read one entry, `focusKey`, so every caller that
  // predates the map keeps working unchanged.
  const [connections, dispatchConn] = useReducer(
    connectionsReducer,
    {} as Connections,
  );
  const dispatchMirror = useCallback(
    (serverKey: string, action: MirrorAction) =>
      dispatchConn({ type: "mirror", serverKey, action }),
    [],
  );
  const updateConnection = useCallback(
    (serverKey: string, update: (c: ConnectionState) => ConnectionState) =>
      dispatchConn({ type: "update", serverKey, update }),
    [],
  );

  // The connection the context's single-connection fields describe: the live
  // one, the one opening, or the last to drop. A drop leaves it in place, which
  // is what keeps a drop's reason on the login panel after the key clears.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focus: ConnectionState | undefined =
    focusKey != null ? connections[focusKey] : undefined;
  const mirror = focus?.mirror ?? initialMirror;

  // The values each connection's handler, reconnect loop and account commands
  // read and write outside a render. See `ConnectionRuntime`.
  const runtimesRef = useRef(new Map<string, ConnectionRuntime>());
  const runtimeFor = useCallback((serverKey: string) => {
    let rt = runtimesRef.current.get(serverKey);
    if (!rt) {
      rt = newRuntime();
      runtimesRef.current.set(serverKey, rt);
    }
    return rt;
  }, []);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  // The same key as a value rather than as state, because the two readers that
  // decide with it both run before React has re-rendered: `doConnect` checks it
  // before its first `await`, and the frozen event handler reads it from inside
  // a Channel callback. Written here beside the state rather than synced from it
  // in an effect, so it is never a render behind.
  const activeKeyRef = useRef<string | null>(null);
  // Every connection that finished opening and has not dropped since, the
  // focused one among them. Kept as a ref for the same reason as the key above:
  // the connect rule and the drop handler read it before React re-renders.
  const liveKeysRef = useRef(new Set<string>());
  const focusOn = useCallback((key: string | null) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    if (key != null) setFocusKey(key);
  }, []);
  // A connection has opened. It takes focus when asked to (a login somebody
  // just pressed) or when nothing else has it.
  const markLive = useCallback(
    (key: string, focus: boolean) => {
      liveKeysRef.current.add(key);
      updateConnection(key, (c) => (c.live ? c : { ...c, live: true }));
      if (focus || activeKeyRef.current == null) focusOn(key);
    },
    [focusOn, updateConnection],
  );
  // A connection has closed or dropped. Focus moves only if it was the focused
  // one, to another live connection if one is still up (issue #2894). With none
  // left the focus entry stays put, which keeps a drop's reason on screen.
  const markGone = useCallback(
    (key: string) => {
      liveKeysRef.current.delete(key);
      updateConnection(key, (c) => (c.live ? { ...c, live: false } : c));
      if (activeKeyRef.current !== key) return;
      const next = liveKeysRef.current.values().next().value ?? null;
      focusOn(next);
    },
    [focusOn, updateConnection],
  );
  // Busy by server key rather than one shared flag, so an account command in
  // flight on one connection does not grey out another connection's controls
  // (issue #2846). `busy` below stays a single boolean for callers that
  // genuinely want "anything busy at all" (the login panel, the battles join
  // gate). A caller that cares about one account reads `busyKeys` instead.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const beginBusy = useCallback((key: string) => {
    setBusyKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const endBusy = useCallback((key: string) => {
    setBusyKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  const busy = busyKeys.size > 0;

  // FIFO queue of `SERVERMSGBOX` texts awaiting acknowledgement, across every
  // connection (issue #2847). Boxed server messages are important enough
  // that the server asked for a modal, so they're queued (never dropped)
  // rather than overwriting each other, and a box on a connection nobody is
  // looking at still queues rather than being lost. The dialog shows the
  // front, naming its server once there is more than one connection to tell
  // apart, and dismissing pops it.
  const [serverMsgBoxes, setServerMsgBoxes] = useState<
    { serverKey: string; text: string }[]
  >([]);

  // Highlight-word preferences (issue #193), mirrored into a ref so the frozen
  // event handler (openChannel is `useCallback(..., [])`) can read the current
  // values when an incoming message arrives, without re-creating the handler.
  const [hlWords] = useSetting<string[]>(HIGHLIGHT_WORDS_KEY, []);
  const [hlOwn] = useSetting<boolean>(HIGHLIGHT_OWN_KEY, true);
  const highlightRef = useRef({ words: hlWords, own: hlOwn });
  useEffect(() => {
    highlightRef.current = { words: hlWords, own: hlOwn };
  }, [hlWords, hlOwn]);

  // One-way "has ever connected this session" latch driving Chat/Battles sidebar
  // visibility. Set on any transition to connected (fresh connect or reload
  // reattach) and never reset, so those views stick across a logout until quit.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (activeKey != null) setRevealed(true);
  }, [activeKey]);

  // The protocol the live connection speaks. Read back from its key against the
  // built-in catalog plus the user's own servers rather than the profile-filtered
  // list, so a profile that hides a server can't quietly turn a Tachyon connection
  // into a TASServer one. Everything TASServer has and Tachyon does not gates on
  // this: see `docs/tachyon-protocol.md`.
  const [customCfg] = useCustomServers();
  const protocolServers = useMemo(
    () => [...BUILTIN_SERVERS, ...customCfg.servers],
    [customCfg.servers],
  );
  const protocol = useMemo(
    () => protocolForKey(activeKey, protocolServers),
    [activeKey, protocolServers],
  );

  const [loginPopoverOpen, setLoginPopoverOpen] = useState(false);
  const openLoginPopover = useCallback(() => setLoginPopoverOpen(true), []);
  const closeLoginPopover = useCallback(() => setLoginPopoverOpen(false), []);

  // Per-conversation "seen up to N messages" marks live in each connection's
  // runtime and are seeded by its session. This tick re-renders when one moves.
  const [, forceSeenTick] = useReducer((n: number) => n + 1, 0);

  const unreadFor = useCallback(
    (id: string, count: number, serverKey?: string) => {
      const key = serverKey ?? activeKeyRef.current;
      const seen = (key && runtimesRef.current.get(key)?.seen[id]) || 0;
      return Math.max(0, count - seen);
    },
    [],
  );

  const markSeen = useCallback(
    (id: string, count: number, serverKey?: string) => {
      const key = serverKey ?? activeKeyRef.current;
      const rt = key ? runtimesRef.current.get(key) : undefined;
      if (!rt || rt.seen[id] === count) return;
      rt.seen[id] = count;
      forceSeenTick();
    },
    [],
  );

  // Channels the user has chosen to be in, persisted per `serverKey` so they can be
  // auto-rejoined on the next connect. This is a preference list (re-derivable by
  // rejoining), so it lives in the frame settings store rather than backend state.
  const [joinedChannels, setJoinedChannels] = useJoinedChannels();
  // The frozen event handler (openChannel) persists a confirmed join through
  // this. The list itself does not come from a render (issue #1375), so a
  // confirm that lands before the next one has rendered still sees the channel
  // it added.
  const setJoinedChannelsRef = useRef(setJoinedChannels);
  useEffect(() => {
    setJoinedChannelsRef.current = setJoinedChannels;
  }, [setJoinedChannels]);

  const rememberChannel = useCallback(
    (name: string, key?: string, serverKey?: string) => {
      const target = serverKey ?? activeKeyRef.current;
      if (!target) return;
      rememberJoinedChannel(target, name, key, setJoinedChannelsRef.current);
    },
    [],
  );

  const forgetChannel = useCallback((name: string, serverKey?: string) => {
    const target = serverKey ?? activeKeyRef.current;
    if (!target) return;
    forgetJoinedChannel(target, name, setJoinedChannelsRef.current);
  }, []);

  // Channels WE asked to join, awaiting the server's confirm, are held per
  // connection. The `channelJoined` delta fires for any self-join, including
  // channels a server auto-joins us to on login, so we only persist a confirm
  // whose channel is in that set, i.e. one the user actually chose.
  const requestJoinChannel = useCallback(
    (channel: string, key?: string, serverKey?: string): Promise<unknown> => {
      const target = serverKey ?? activeKeyRef.current;
      if (!target) return Promise.resolve();
      runtimesRef.current.get(target)?.pendingJoins.add(channel);
      return mpJoinChannel({ serverKey: target, channel, key });
    },
    [],
  );

  const [ignored, setIgnored] = useIgnored();
  const [favourites] = useFavourites();

  // --- Auto-rejoin on unexpected server drop (issue #192) --------------------
  // Distinct from the reload-reattach path below: this handles a genuine server-
  // side disconnect, where the Rust task dies and self-evicts. We re-run `connect`
  // (which re-fetches the password and, on reaching `ready`, replays channels via
  // the connection's session) and best-effort rejoin the battle we were in.
  const [autoRejoin] = useSetting<boolean>("multiplayer.autoRejoin", true);
  const autoRejoinRef = useRef(autoRejoin);
  useEffect(() => {
    autoRejoinRef.current = autoRejoin;
  }, [autoRejoin]);

  // The `LOGIN` userID, generated on first use and kept from then on. Declared
  // before the boot auto-connect effect below so the ref is filled by the time
  // anything can connect.
  const [clientId, setClientId] = useSetting<string>(CLIENT_ID_KEY, "");
  const clientIdRef = useRef(clientId);
  useEffect(() => {
    if (clientId) {
      clientIdRef.current = clientId;
      return;
    }
    const fresh = newClientId();
    clientIdRef.current = fresh;
    setClientId(fresh);
  }, [clientId, setClientId]);

  // Zero-K's `InstallID`, generated on first use and kept from then on. Its own
  // value rather than a second use of the one above: they are for two different
  // servers, and Zero-K reads a changed one as a different machine.
  const [zerokInstallId, setZerokInstallId] = useSetting<string>(
    ZEROK_INSTALL_ID_KEY,
    "",
  );
  const zerokInstallIdRef = useRef(zerokInstallId);
  useEffect(() => {
    if (zerokInstallId) {
      zerokInstallIdRef.current = zerokInstallId;
      return;
    }
    const fresh = newZerokInstallId();
    zerokInstallIdRef.current = fresh;
    setZerokInstallId(fresh);
  }, [zerokInstallId, setZerokInstallId]);

  // The key of the connection that is a room rather than a server. The
  // connection's own `direct` flag is what everything reads. This is only how
  // that flag survives a reload.
  //
  // Kept in settings rather than in React state because the Rust connection
  // outlives a webview reload and is re-adopted below with nothing to say where
  // it came from, and a room re-adopted as a server hands out a link that
  // reaches nobody (issue #1617). One key is enough, because coilbox is in one
  // room at a time. A room connect writes it and closing that room clears it.
  // A lobby login leaves it alone, since a room now sits beside lobby logins
  // (issue #2850), unless the login has the very key it names.
  const [roomKey, setRoomKey] = useSetting<string>("multiplayer.roomKey", "");
  const setRoomKeyRef = useRef(setRoomKey);
  const roomKeyRef = useRef(roomKey);
  useEffect(() => {
    setRoomKeyRef.current = setRoomKey;
    roomKeyRef.current = roomKey;
  }, [roomKey, setRoomKey]);
  // Written through here so the ref is right before React re-renders, for a
  // close that follows a connect in the same tick.
  const saveRoomKey = useCallback((key: string) => {
    roomKeyRef.current = key;
    setRoomKeyRef.current(key);
  }, []);
  // Whether a connection is a room, for the connect rule, which runs before
  // React has re-rendered. A reattached connection has no connect behind it,
  // so the saved key answers for it.
  const isRoomKey = useCallback(
    (key: string) =>
      runtimesRef.current.get(key)?.reconnectCtx?.direct ??
      key === roomKeyRef.current,
    [],
  );
  // The saved key can arrive after the reload's reattach has run, because
  // settings load asynchronously, so the reattached room is marked here too.
  const roomEntryOpen = roomKey !== "" && connections[roomKey] !== undefined;
  useEffect(() => {
    if (roomEntryOpen)
      dispatchConn({ type: "open", serverKey: roomKey, direct: true });
  }, [roomEntryOpen, roomKey]);

  // Startup auto-connect (issue #404, opt-in, default off) + one-click reconnect.
  // The last-used login is written on every successful connect and read once at
  // boot. The decision inputs are mirrored into a ref so the once-only boot effect
  // can read the hydrated values without re-running when they change.
  const [autoConnect] = useSetting<boolean>("multiplayer.autoConnect", false);
  const [lastLogin, setLastLogin] = useLastLogin();
  const [accountsCfg, setAccountsCfg] = useLobbyAccounts();
  const setLastLoginRef = useRef(setLastLogin);
  useEffect(() => {
    setLastLoginRef.current = setLastLogin;
  }, [setLastLogin]);
  // Stamp the connected account's recency + known-secret flag (a connect just
  // read the password successfully) and flag it `openAtQuit`, feeding the login
  // panel's most-recent-first ordering and the boot reconnect list (issue
  // #2849). Ref'd like `setLastLoginRef` so `doConnect` stays stable.
  const markAccountUsedRef = useRef(
    (_serverId: string, _username: string) => {},
  );
  useEffect(() => {
    markAccountUsedRef.current = (serverId: string, username: string) => {
      setAccountsCfg({
        accounts: accountsCfg.accounts.map((a) =>
          a.serverId === serverId && a.username === username
            ? {
                ...a,
                lastUsedAt: Date.now(),
                hasSecret: true,
                openAtQuit: true,
              }
            : a,
        ),
      });
    };
  }, [accountsCfg.accounts, setAccountsCfg]);
  // Clear `openAtQuit` on a manual log out, matched by server + username the
  // same way `serverKeyFor` builds a key, so a player who logs out by hand is
  // not reconnected at the next boot. Left alone by an unexpected drop, which
  // is what lets a connection mid-reconnect, or one still open when coilbox
  // quit, stay remembered. Ref'd for the same reason as `markAccountUsedRef`.
  const clearOpenAtQuitRef = useRef((_serverKey: string) => {});
  useEffect(() => {
    clearOpenAtQuitRef.current = (serverKey: string) => {
      const server = allServers(customCfg.servers).find((s) =>
        serverKey.endsWith(`@${s.host}:${s.port}`),
      );
      if (!server) return;
      const username = serverKey.slice(0, serverKey.indexOf("@"));
      setAccountsCfg({
        accounts: accountsCfg.accounts.map((a) =>
          a.serverId === server.id && a.username === username
            ? { ...a, openAtQuit: false }
            : a,
        ),
      });
    };
  }, [accountsCfg.accounts, customCfg.servers, setAccountsCfg]);
  const bootRef = useRef({
    autoConnect,
    lastLogin,
    accounts: accountsCfg.accounts,
    custom: customCfg.servers,
  });
  useEffect(() => {
    bootRef.current = {
      autoConnect,
      lastLogin,
      accounts: accountsCfg.accounts,
      custom: customCfg.servers,
    };
  }, [autoConnect, lastLogin, accountsCfg.accounts, customCfg.servers]);

  // The server keys of connects still in their handshake (before they register
  // as live connections), in the order they started, so the connect rule can
  // see them and `cancelConnect` knows which pending connect to abort. Each is
  // cleared once its connect resolves either way.
  const connectingKeysRef = useRef(new Set<string>());
  // Late-bound so the frozen `openChannel` handler can invoke the latest logic.
  // It is handed the key that dropped, because which connection it was decides
  // everything the handler does (issue #2149).
  const handleDropRef = useRef<
    (serverKey: string, reason: string | null) => void
  >(() => {});

  // Cancel a connection's reconnect loop, or every loop when no key is given (a
  // manual connect/disconnect supersedes it).
  const stopReconnect = useCallback((serverKey?: string) => {
    const stop = (rt: ConnectionRuntime) => {
      rt.reconnectGen += 1;
      rt.reconnectAttempt = 0;
      rt.rejoinBattle = null;
      if (rt.reconnectTimer != null) {
        window.clearTimeout(rt.reconnectTimer);
        rt.reconnectTimer = null;
      }
    };
    if (serverKey === undefined) {
      for (const rt of runtimesRef.current.values()) stop(rt);
    } else {
      const rt = runtimesRef.current.get(serverKey);
      if (rt) stop(rt);
    }
  }, []);

  // Mark a user-initiated disconnect or cancel as intended, so its clean
  // `disconnected` event isn't mistaken for an unexpected drop. With no key it
  // marks every connection that is not live, so a cancel with nothing named
  // cannot stop a live connection's drop from reconnecting.
  const markIntentional = useCallback((serverKey?: string) => {
    if (serverKey === undefined) {
      for (const [key, rt] of runtimesRef.current) {
        if (!liveKeysRef.current.has(key)) rt.intentional = true;
      }
    } else {
      const rt = runtimesRef.current.get(serverKey);
      if (rt) rt.intentional = true;
    }
  }, []);

  // A connect is past its checks and about to open: give it an entry, reset
  // its mirror, and point the context at it when it is to take focus, the
  // same rule `markLive` follows. A room or a reconnect opening beside a live
  // login leaves the context on that login (issue #2850).
  const beginConnecting = useCallback(
    (serverKey: string, direct: boolean, focus: boolean) => {
      dispatchConn({ type: "open", serverKey, direct });
      dispatchMirror(serverKey, { type: "connecting" });
      if (focus || activeKeyRef.current == null) setFocusKey(serverKey);
    },
    [dispatchMirror],
  );

  // Forget a connection the user has closed. Its runtime goes too, so anything
  // its channel still sends is ignored.
  const closeConnection = useCallback(
    (serverKey: string) => {
      stopReconnect(serverKey);
      runtimesRef.current.delete(serverKey);
      dispatchConn({ type: "close", serverKey });
      if (roomKeyRef.current === serverKey) saveRoomKey("");
    },
    [saveRoomKey, stopReconnect],
  );

  // Build the event Channel for a connection and wire it to that connection's
  // entry. Shared by `connect` and the reload-rehydrate path so both handle
  // events identically. The Rust side evicts the connection on any teardown
  // (socket close, or a rejected login), so a `disconnected` event clears the
  // active key to return the UI to the connect screen while keeping the reason.
  //
  // Everything here is read and written against `serverKey`, so an event on
  // one connection never reaches another's entry (issue #2841). A connection
  // that has been closed has no runtime, and its events are dropped.
  const openChannel = useCallback(
    (serverKey: string) => {
      const onEvent = new Channel<LobbyEvent>();
      // The Rust side emits one delta per server line, and the mirror is rebuilt
      // wholesale from a snapshot, so on a busy server (hundreds of battles, a few
      // thousand users) a delta per event means a full serialise of every battle,
      // user and channel across IPC many times a second. Batch instead: a burst of
      // deltas costs one snapshot, which caps the rate at one per SNAPSHOT_BATCH_MS
      // however loud the server gets. The deltas themselves still act immediately
      // in the handler below. Only the state refresh waits.
      let pendingDeltas: Delta[] = [];
      let flushTimer: number | null = null;
      const flush = () => {
        flushTimer = null;
        const batch = pendingDeltas;
        pendingDeltas = [];
        mpSnapshot({ serverKey })
          .then((r) => {
            const live = runtimesRef.current.get(serverKey);
            if (live) live.state = r.state;
            dispatchMirror(serverKey, { type: "snapshot", state: r.state });
            // A chat/private message that mentions a highlight word or our own
            // username fires the mention cue (a sound + taskbar flash). Whether
            // it makes a noise is Sound settings' business, not this loop's.
            // Skip our own messages and non-chat lines (join/leave/system). The
            // text lives in the snapshot, not the delta. Skip replayed channel
            // history too (`id != null`): joining a channel would otherwise ping
            // once per past mention in its backlog.
            const hl = highlightRef.current;
            for (const d of batch) {
              const msg = incomingChatMsg(d, r.state);
              if (
                msg &&
                msg.id == null &&
                msg.from !== r.state.myUsername &&
                (msg.kind === "said" ||
                  msg.kind === "saidEx" ||
                  msg.kind === "saidBattle" ||
                  msg.kind === "private") &&
                matchesHighlight(msg.text, hl.words, r.state.myUsername, hl.own)
              ) {
                triggerMentionCue(msg.from);
              }
            }
          })
          .catch(() => {});
      };
      const queueSnapshot = (d: Delta) => {
        pendingDeltas.push(d);
        if (flushTimer == null) {
          flushTimer = window.setTimeout(flush, SNAPSHOT_BATCH_MS);
        }
      };
      onEvent.onmessage = (ev) => {
        const rt = runtimesRef.current.get(serverKey);
        if (!rt) return;
        dispatchMirror(serverKey, { type: "event", ev });
        if (ev.kind === "delta") {
          const d = ev.delta;
          // The server has refused these credentials. Recorded so the reconnect
          // loop stops rather than spending attempts on a password that will be
          // refused again, which on Zero-K is counted against the IP address.
          if (d.kind === "loginDenied" || d.kind === "registrationDenied") {
            rt.denied = true;
          }
          // An autohost `!ring` is a transient event, not state - react to it directly
          // (gong + reverberation + taskbar flash) rather than through the snapshot.
          if (d.kind === "ring") triggerRing(d.from);
          // A player transitioning to in-game is a transient moment, not just the
          // resulting status (which the snapshot already carries). Flash the
          // launcher's row briefly for everyone. When it's the founder of the
          // battle we're in (and not ourselves), also fire the softer "it's
          // starting, get in" cue - the host launching is the actionable
          // "everyone's waiting on one person" case.
          else if (d.kind === "playerWentIngame") {
            const name = d.name;
            updateConnection(serverKey, (c) => ({
              ...c,
              justWentIngame: new Set(c.justWentIngame).add(name),
            }));
            window.setTimeout(() => {
              updateConnection(serverKey, (c) => {
                if (!c.justWentIngame.has(name)) return c;
                const next = new Set(c.justWentIngame);
                next.delete(name);
                return { ...c, justWentIngame: next };
              });
            }, 2500);
            const st = rt.state;
            const battle =
              st?.currentBattle != null
                ? st.battles[String(st.currentBattle)]
                : undefined;
            if (battle && battle.host === name && st?.myUsername !== name) {
              triggerIngameCue(name);
            }
          }
          // The server confirmed we joined a channel (a bare JOIN echo, sent only
          // to the joining client): persist it to the autojoin list now, on
          // confirm and not on the optimistic send, so a channel the server
          // refuses is never remembered. Clear any prior failure record for it
          // (it recovered).
          else if (d.kind === "channelJoined") {
            // Only persist channels the user asked to join (in the pending set), so a
            // channel the server auto-joins us to isn't silently added to the list.
            if (rt.pendingJoins.delete(d.channel)) {
              rememberJoinedChannel(
                serverKey,
                d.channel,
                undefined,
                setJoinedChannelsRef.current,
              );
            }
            rt.notifiedJoinFailures.delete(d.channel);
            updateConnection(serverKey, (c) => {
              if (c.channelJoinFailures[d.channel] === undefined) return c;
              const next = { ...c.channelJoinFailures };
              delete next[d.channel];
              return { ...c, channelJoinFailures: next };
            });
          }
          // A refused JOIN (e.g. a restricted #moderators, or a channel that became
          // passworded after we'd joined it). Keep the entry on the autojoin list,
          // since the restriction may lift, but record it so the settings can flag
          // it, and toast only once per session so a permanently-restricted channel
          // doesn't nag on every reconnect. The raw JOINFAILED line stays in the
          // console.
          else if (d.kind === "joinChannelFailed") {
            rt.pendingJoins.delete(d.channel);
            updateConnection(serverKey, (c) =>
              c.channelJoinFailures[d.channel] === d.reason
                ? c
                : {
                    ...c,
                    channelJoinFailures: {
                      ...c.channelJoinFailures,
                      [d.channel]: d.reason,
                    },
                  },
            );
            if (!rt.notifiedJoinFailures.has(d.channel)) {
              rt.notifiedJoinFailures.add(d.channel);
              void notify({
                title: `Couldn't join ${d.channel}`,
                body: d.reason || undefined,
                level: "error",
              });
            }
          }
          // A player is in our relayed battle and their traffic will not reach
          // the game, because the relay would not take their address. Only the
          // host is told, because only the host has anything to tell: the joiner
          // sees a battle they are in and a game that never starts for them.
          else if (d.kind === "joinerNotLetThrough") {
            void notify({
              title: `${d.username} cannot reach your relayed battle`,
              body: d.reason || undefined,
              level: "error",
            });
          }
          // The lobby would not advertise the battle at the relay's address. Rust
          // closes the room the lobby opened anyway and returns the reason as the
          // hosting command's error, so a host still looking at the Host button
          // has already seen it. This is for the host who is not: the refusal can
          // arrive after they have stopped waiting, and without it they find out
          // from players saying they cannot connect.
          else if (d.kind === "relayedHostRefused") {
            void notify({
              title: "Your battle is not going through the relay",
              body: d.reason || undefined,
              level: "error",
            });
          }
          // A battle changed address without closing. The reducer has already
          // pointed us at the new one, so nothing here has to be repaired, and
          // until issue #2073 that was the whole of it: everybody in the room was
          // silently moved and never told. Recorded rather than notified, because
          // it is a fact that keeps rather than a question waiting on an answer,
          // and the panel that reads it decides who it is worth saying to.
          else if (d.kind === "battleHostMoved") {
            recordBattleMoved(d.id);
          }
          // The relay came back at a new address, the lobby was asked to move the
          // battle to it, and the lobby either said no or said nothing. The battle
          // is open, quite possibly with a game in it, and the address everybody
          // was given has gone, so nobody new can join and nothing here can put
          // that right. The host is the only person who can, by hosting again.
          //
          // One warning covers both, because to the person hosting they are the
          // same battle in the same state. A lobby too old to know the command
          // does not refuse it, so silence is what today's servers all give, and
          // reading differently from a refusal would only make it look less
          // serious than it is.
          else if (
            d.kind === "relayedHostMoveRefused" ||
            d.kind === "relayedHostMoveUnanswered"
          ) {
            const reason = d.kind === "relayedHostMoveRefused" ? d.reason : "";
            void notify({
              title: "Nobody can reach your battle any more",
              body: reason
                ? `Its relay moved and the lobby would not update the address: ${reason}`
                : "Its relay moved and the lobby would not update the address.",
              level: "error",
            });
          }
          // The relay credential the lobby minted has run out and it would not
          // mint another. Nothing is broken yet and nothing looks wrong, which is
          // exactly why the host has to be told: the game carries on until the
          // relay has to be rebuilt, and then it ends for everybody at once.
          // Hosting again is the only thing that gets a live credential.
          else if (d.kind === "relayCredentialExpired") {
            void notify({
              title: "Your battle is running on an expired relay pass",
              body: "The lobby would not issue another one. The game carries on, but if the relay has to reconnect everybody will be dropped. Host again when you can.",
              level: "error",
            });
          } else if (d.kind === "commandFailed") {
            // Ignore-sync commands are best-effort: a server without IGNORE support
            // may reject them, but local hiding still applies, so degrade silently
            // rather than nag the user (the raw FAILED line is still in the console).
            const cmd = d.command.toUpperCase();
            if (
              cmd !== "IGNORE" &&
              cmd !== "UNIGNORE" &&
              cmd !== "IGNORELIST"
            ) {
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
            // A command with no reply of its own (e.g. `CHANGEPASSWORD`) is
            // answered by whatever `SERVERMSG` comes next, and this is the only
            // place every one passes through. Fire every waiter rather than just
            // the first, since nothing stops two such commands overlapping.
            for (const waiter of rt.serverMessageWaiters) waiter(d.text);
            const text = d.text.trim();
            if (text) {
              if (d.boxed)
                setServerMsgBoxes((q) => [...q, { serverKey, text: d.text }]);
              else void notify({ title: "Server message", body: d.text });
            }
          }
          // A staff `BROADCAST` (issue #2775). It never answers a command the way
          // a plain SERVERMSG can, so it doesn't feed `serverMessageWaiters`, and
          // it's titled apart from a routine server message so a player can tell
          // an admin sent it.
          else if (d.kind === "broadcast") {
            const text = d.text.trim();
            if (text)
              void notify({ title: "Staff announcement", body: d.text });
          }
          // A game we played has finished and the server has said what it did to
          // everybody's rating. Only the id is recorded: the result itself is in
          // the snapshot that follows, and the drawer waits for it. Zero-K only
          // (issue #2003).
          else if (d.kind === "debriefingReceived") {
            const battleId = d.battleId;
            updateConnection(serverKey, (c) => ({
              ...c,
              debriefingShown: battleId,
            }));
          }
          // One labelled line of a `GETUSERINFO` answer. The three arrive
          // separately, so a field that arrives null keeps whatever this already
          // held rather than blanking it.
          else if (d.kind === "accountInfo") {
            updateConnection(serverKey, (c) => ({
              ...c,
              accountInfo: {
                registrationDate:
                  d.registrationDate ?? c.accountInfo?.registrationDate ?? null,
                email: d.email ?? c.accountInfo?.email ?? null,
                ingameHours:
                  d.ingameHours ?? c.accountInfo?.ingameHours ?? null,
              },
            }));
          }
          // The paired accept/deny delta for whichever of `changeEmailRequest`,
          // `changeEmail` or `resendVerification` is currently awaited. Fire
          // every waiter rather than just the first, the same reasoning as
          // `serverMessageWaiters` above: each filters to the pair it was
          // registered for and ignores the rest.
          else if (
            d.kind === "changeEmailCodeSent" ||
            d.kind === "changeEmailAccepted" ||
            d.kind === "changeEmailDenied" ||
            d.kind === "resendVerificationAccepted" ||
            d.kind === "resendVerificationDenied"
          ) {
            for (const waiter of rt.accountDeltaWaiters) waiter(d);
          }
          queueSnapshot(d);
        }
        // The server can pause a new account's first login on the agreement or
        // verification-code handshake. Surface that so the dialog can prompt.
        // Any other phase (e.g. the resume after submitting the code) clears it.
        if (ev.kind === "phase") {
          // Mark a session as "logged in" once it reaches ready. Only such a
          // session's later drop is worth auto-reconnecting.
          if (ev.phase === "ready") rt.loggedIn = true;
          const agreement =
            ev.phase === "awaitAgreement" ? (ev.agreement ?? "") : null;
          updateConnection(serverKey, (c) =>
            c.agreement === agreement ? c : { ...c, agreement },
          );
        }
        if (ev.kind === "disconnected") {
          // Nothing left to snapshot: the Rust side has already evicted this
          // connection, so a pending refresh would only fetch a dead key.
          if (flushTimer != null) {
            window.clearTimeout(flushTimer);
            flushTimer = null;
            pendingDeltas = [];
          }
          updateConnection(serverKey, (c) =>
            c.agreement == null ? c : { ...c, agreement: null },
          );
          // Whose drop this was decides the rest, so the key goes with it.
          // Acting on every drop meant a connection somebody had stopped using
          // could log them out of the one they were on, and start a reconnect
          // loop for it too (issue #2149).
          handleDropRef.current(serverKey, ev.reason);
        }
      };
      return onEvent;
    },
    [dispatchMirror, updateConnection],
  );

  // The core connect, shared by the public `connect` and the auto-reconnect loop.
  // Records the reconnect context and resets the per-session drop flags so a later
  // unexpected disconnect can rebuild the session.
  const doConnect = useCallback(
    async (
      server: LobbyServer,
      username: string,
      direct = false,
      /** Take focus once open, rather than only when nothing else has it. */
      focus = true,
    ) => {
      const serverKey = serverKeyFor(server, username);
      // The one place every connection is opened, and so the one place the
      // one-connection-per-server rule can hold. Read and thrown before anything
      // is recorded, so a refused connect leaves no reconnect context and no busy
      // flag behind (issue #2149). Every caller shows the message: the login
      // panel, the host form and the join form all put a thrown reason on screen.
      const open: OpenConnection[] = [
        ...[...liveKeysRef.current].map((key) => ({
          serverKey: key,
          opening: false,
          direct: isRoomKey(key),
        })),
        ...[...connectingKeysRef.current].map((key) => ({
          serverKey: key,
          opening: true,
          direct: isRoomKey(key),
        })),
      ];
      const blocked = connectBlockedReason(open, serverKey, direct);
      if (blocked) throw new Error(blocked);
      beginBusy(serverKey);
      const rt = runtimeFor(serverKey);
      rt.intentional = false;
      rt.loggedIn = false;
      rt.denied = false;
      rt.reconnectCtx = { server, username, direct };
      connectingKeysRef.current.add(serverKey);
      try {
        const onEvent = openChannel(serverKey);
        const protocol = serverProtocol(server);
        if (protocol === "zerok") {
          // Same credentials as a TASServer login, from the same keychain entry,
          // because Zero-K hashes a password the same way. What differs is the
          // handshake, which the Rust side runs off the server's unprompted
          // greeting, and that there is no TLS to choose.
          const cred = await lsGetCredential({
            serverId: server.id,
            username,
          });
          if (!cred.secret) {
            throw new Error(
              "No stored password for this login (set one in Settings).",
            );
          }
          beginConnecting(serverKey, direct, focus);
          await mpConnectZerok({
            serverKey,
            host: server.host,
            port: server.port,
            username,
            password: cred.secret,
            installId: zerokInstallIdRef.current,
            onEvent,
          });
        } else if (protocol === "tachyon") {
          // No password to read and no handshake to run. The Rust side refreshes
          // the token the browser sign-in stored, so this never opens a browser,
          // which is what makes an auto-reconnect safe on a Tachyon server.
          beginConnecting(serverKey, direct, focus);
          await mpConnectTachyon({
            serverKey,
            host: server.host,
            port: server.port,
            tls: server.tls,
            serverId: server.id,
            username,
            onEvent,
          });
        } else {
          // A room has no accounts, so it accepts any password and there is none
          // to look up. Everything after the handshake is identical.
          let secret = "*";
          if (!direct) {
            const cred = await lsGetCredential({
              serverId: server.id,
              username,
            });
            if (!cred.secret) {
              throw new Error(
                "No stored password for this login (set one in Settings).",
              );
            }
            secret = cred.secret;
          }
          beginConnecting(serverKey, direct, focus);
          await mpConnect({
            serverKey,
            host: server.host,
            port: server.port,
            tlsMode: tlsModeFor(server),
            allowSelfSigned: server.allowSelfSigned,
            username,
            password: secret,
            clientId: clientIdRef.current,
            compatFlags: ["u", "sp"],
            onEvent,
          });
        }
        const snap = await mpSnapshot({ serverKey });
        rt.state = snap.state;
        dispatchMirror(serverKey, { type: "snapshot", state: snap.state });
        markLive(serverKey, focus);
        if (direct) saveRoomKey(serverKey);
        else if (roomKeyRef.current === serverKey) saveRoomKey("");
        setLoginPopoverOpen(false);
        // Remember this login as the last used, so opt-in auto-connect and the
        // one-click reconnect row can seed it next launch. Keyed by id+username so
        // it survives the account being re-created (not by the volatile account id).
        // A room is skipped: it is gone by the next launch, and it is not an
        // account, so it belongs in neither list.
        if (!direct) {
          setLastLoginRef.current({ serverId: server.id, username });
          markAccountUsedRef.current(server.id, username);
        }
      } catch (e) {
        // A user cancel aborts the in-flight connect, so `mpConnect` rejects by
        // design: swallow it, forget the connection, and leave the UI
        // disconnected rather than surfacing it as a login error or triggering a
        // reconnect.
        if (rt.intentional) {
          closeConnection(serverKey);
          return;
        }
        throw e;
      } finally {
        connectingKeysRef.current.delete(serverKey);
        endBusy(serverKey);
      }
    },
    [
      beginBusy,
      beginConnecting,
      closeConnection,
      dispatchMirror,
      endBusy,
      isRoomKey,
      markLive,
      openChannel,
      runtimeFor,
      saveRoomKey,
    ],
  );

  // The browser sign-in that gives a Tachyon connect something to refresh. Kept
  // out of `connect` deliberately: a reconnect must never put a browser window in
  // front of someone who has walked away from a dropped connection.
  const signIn = useCallback(
    async (server: LobbyServer, username: string) => {
      const serverKey = serverKeyFor(server, username);
      beginBusy(serverKey);
      try {
        await mpTachyonSignIn({
          baseUrl: tachyonBaseUrl(server),
          serverId: server.id,
          username,
        });
        markAccountUsedRef.current(server.id, username);
      } finally {
        endBusy(serverKey);
      }
    },
    [beginBusy, endBusy],
  );

  // Public connect: a manual login supersedes any auto-reconnect loop on the
  // same server, whichever account it is for, since that server can hold only
  // one of them. Loops for other servers carry on (issue #2848).
  const connect = useCallback(
    async (server: LobbyServer, username: string) => {
      const host = serverHostFromKey(serverKeyFor(server, username));
      for (const key of [...runtimesRef.current.keys()]) {
        if (serverHostFromKey(key) === host) stopReconnect(key);
      }
      await doConnect(server, username);
    },
    [doConnect, stopReconnect],
  );

  // Connect every one of `targets` that isn't already connected, one after
  // another, skipping a Tachyon login the server no longer accepts without
  // opening a browser for it. Shared by the boot reconnect (issue #2849,
  // below) and the login panel's "Reconnect all" (issue #2927), so there is
  // one place this loop is written. `doConnect` is called directly rather
  // than through the public `connect`: every login here is meant to run
  // unfocused and independent of any other server's reconnect loop, which is
  // exactly what boot always assumed. One failing does not stop the rest,
  // and each raises its own notification.
  const connectRemembered = useCallback(
    async (targets: { account: LobbyAccount; server: LobbyServer }[]) => {
      for (const { account, server } of targets) {
        const serverKey = serverKeyFor(server, account.username);
        if (serverKey in connections) continue;
        if (
          serverProtocol(server) === "tachyon" &&
          (await needsSignIn(server, account.username))
        ) {
          void notify({
            title: "Signed out of multiplayer",
            body: `${account.username} on ${server.name} needs a new sign-in. Log in again from the topbar to sign in with your browser.`,
            level: "error",
          });
          continue;
        }
        try {
          await doConnect(server, account.username, false, false);
        } catch {
          void notify({
            title: "Couldn't connect to multiplayer",
            body: `Log in as ${account.username} on ${server.name} from the topbar when you're ready.`,
            level: "error",
          });
        }
      }
    },
    [connections, doConnect],
  );

  // Connect to a room, ours or somebody else's. The key is returned rather
  // than read off `activeKey`, because a caller that starts a room then opens a
  // battle in it does both before React has re-rendered with the new key, and a
  // room does not take focus from a lobby login (issue #2850).
  //
  // Only a room's reconnect loop is stopped, because coilbox is in one room at
  // a time and a loop for an old room would dial into the way of this one. A
  // lobby login's loop carries on beside it.
  const connectDirect = useCallback(
    async (port: number, username: string, address?: string) => {
      for (const [key, rt] of runtimesRef.current) {
        if (rt.reconnectCtx?.direct) stopReconnect(key);
      }
      const server = directServer(port, address);
      await doConnect(server, username, true, false);
      const serverKey = serverKeyFor(server, username);
      // Connected is not logged in. `mpConnect` answers as soon as the socket is
      // up, and the caller's next act is to open a battle, which a room refuses
      // from a client it has not greeted yet. Over loopback the handshake beat
      // the round trips nearly every time, and nearly was the bug (issue #1590).
      try {
        await mpWaitUntilReady({ serverKey });
      } catch (e) {
        // A socket that never logged in can do nothing and still holds the key,
        // so a second attempt would be refused as a duplicate. Drop it.
        await mpDisconnect({ serverKey }).catch(() => {});
        closeConnection(serverKey);
        // Moves focus only if this room had it, so a connection that became
        // focused meanwhile keeps it.
        markGone(serverKey);
        throw e;
      }
      return serverKey;
    },
    [closeConnection, doConnect, markGone, stopReconnect],
  );

  // Run a connection's reconnect loop after an unexpected drop: retry
  // `doConnect` on a bounded backoff. A generation on the connection's runtime
  // lets a manual connect/disconnect invalidate it, and it self-stops on
  // success, after exhausting the attempt budget, or once the connection is
  // closed.
  const runReconnect = useCallback(
    (serverKey: string) => {
      const rt = runtimesRef.current.get(serverKey);
      if (!rt) return;
      const gen = ++rt.reconnectGen;
      rt.reconnectAttempt = 0;
      const superseded = () =>
        rt.reconnectGen !== gen || runtimesRef.current.get(serverKey) !== rt;
      const step = async () => {
        if (superseded()) return;
        const ctx = rt.reconnectCtx;
        if (!ctx) return;
        try {
          // A reconnect takes focus only when nothing else has it, so a
          // connection coming back does not pull the interface away from the
          // one somebody moved on to.
          await doConnect(ctx.server, ctx.username, ctx.direct, false);
          if (superseded()) return;
          void notify({
            title: "Reconnected to multiplayer",
            level: "success",
          });
        } catch {
          if (superseded()) return;
          // A password the server has already refused will be refused again, so a
          // retry costs a failed attempt and buys nothing. On Zero-K it costs more
          // than that: it logs failed attempts per IP address, so a loop bans the
          // address rather than the account. Stop and let the person fix it.
          if (rt.denied) {
            void notify({
              title: "Multiplayer login refused",
              body: "Check the password in Settings, then log in again from the topbar.",
              level: "error",
            });
            return;
          }
          // A Tachyon sign-in the server has refused will be refused again, so
          // retrying it only delays the one thing that can fix it: another trip
          // through the browser, which a reconnect must never open by itself.
          if (await needsSignIn(ctx.server, ctx.username)) {
            if (superseded()) return;
            void notify({
              title: "Signed out of multiplayer",
              body: "The server no longer accepts your sign-in. Log in again from the topbar to sign in with your browser.",
              level: "error",
            });
            return;
          }
          const attempt = ++rt.reconnectAttempt;
          if (attempt >= RECONNECT_DELAYS_MS.length) {
            void notify({
              title: "Couldn't reconnect to multiplayer",
              body: "Log in again from the topbar when you're ready.",
              level: "error",
            });
            return;
          }
          rt.reconnectTimer = window.setTimeout(step, reconnectDelay(attempt));
        }
      };
      rt.reconnectTimer = window.setTimeout(step, reconnectDelay(0));
    },
    [doConnect],
  );

  // React to a `disconnected` event: return the UI to disconnected, and start the
  // reconnect loop only for a genuine, unexpected drop of a logged-in session
  // (not a manual disconnect, a login denial, or when the feature is off).
  // Captures the current battle first so it can be rejoined once reconnected.
  //
  // Nothing happens at all for a connection that is not live. A connection
  // somebody has closed still has a socket to lose, and losing it used to clear
  // the key and start a reconnect for whoever held it next (issue #2149). A
  // connect that fails in its handshake is not live either, and its own caller
  // reports that.
  const handleDrop = useCallback(
    (serverKey: string, reason: string | null) => {
      if (!liveKeysRef.current.has(serverKey)) return;
      markGone(serverKey);
      const rt = runtimesRef.current.get(serverKey);
      if (!rt || rt.intentional) return;
      // A room is one running process, not an address worth retrying: once it
      // has told us why it ended (a stop, and later a kick), reconnecting would
      // dial whatever else has since taken that address and port, and land us
      // in a battle nobody chose (issue #2733). An unnamed drop is still worth
      // the reconnect below, since that is the shape a network blip takes and
      // the same room is what is still there to reclaim a seat in.
      if (rt.reconnectCtx?.direct && reason) {
        void notify({ title: "Disconnected from the room", body: reason });
        return;
      }
      if (!autoRejoinRef.current) return;
      if (!rt.loggedIn) return;
      if (!rt.reconnectCtx) return;
      const st = rt.state;
      if (st?.currentBattle != null) {
        const battle = st.battles[String(st.currentBattle)];
        const me = st.myUsername ? battle?.members[st.myUsername] : undefined;
        rt.rejoinBattle = {
          id: st.currentBattle,
          scriptPassword: me?.scriptPassword ?? null,
        };
      } else {
        rt.rejoinBattle = null;
      }
      void notify({ title: "Connection lost — reconnecting…" });
      runReconnect(serverKey);
    },
    [markGone, runReconnect],
  );
  useEffect(() => {
    handleDropRef.current = handleDrop;
  }, [handleDrop]);

  // Drop a move that is about a battle this client has left. Somebody who leaves
  // and rejoins the same battle is handed its address afresh and was never
  // holding a dead one, so the strip would be telling them about a move they
  // were not in. Driven from the battle we are in rather than from leaving,
  // because being kicked and the host closing the battle arrive as state rather
  // than as an action (issue #2073).
  const inBattle = mirror.state?.currentBattle ?? null;
  useEffect(() => {
    forgetBattleMovedUnless(inBattle);
  }, [inBattle]);

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
      const serverKey = serverKeyFor(server, username);
      beginBusy(serverKey);
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
          // Zero-K creates an account over its own protocol. Everything above
          // this call is unchanged, because it streams the same events.
          const opened =
            serverProtocol(server) === "zerok"
              ? mpRegisterZerok({
                  serverKey,
                  host: server.host,
                  port: server.port,
                  username,
                  password,
                  email: email ?? null,
                  installId: zerokInstallIdRef.current,
                  onEvent,
                })
              : mpRegister({
                  serverKey,
                  host: server.host,
                  port: server.port,
                  tlsMode: tlsModeFor(server),
                  allowSelfSigned: server.allowSelfSigned,
                  username,
                  password,
                  email: email ?? null,
                  clientId: clientIdRef.current,
                  compatFlags: ["u", "sp"],
                  onEvent,
                });
          opened.catch(reject);
        });
      } finally {
        // Free the registry slot (the register connection stays open on success).
        await mpDisconnect({ serverKey }).catch((e) =>
          console.warn("multiplayer: disconnect cleanup failed", e),
        );
        endBusy(serverKey);
      }
    },
    [beginBusy, endBusy],
  );

  // The recovery connection's event channel, kept while parked awaiting the
  // emailed code, so `submitRecoveryCode` can take over listening on the same
  // connection `recoverPassword` opened. A Tauri `Channel` has exactly one
  // `onmessage` slot, so this is the only way a second call can observe
  // anything on it. Do not remove this for looking redundant.
  // Removed once the connection actually closes: a wrong code leaves the
  // entry in place, since uberserver allows two more attempts and the
  // connection is still there to retry on.
  const recoveryChannelsRef = useRef<Map<string, Channel<LobbyEvent>>>(
    new Map(),
  );

  // Start account recovery: open a throwaway connection that sends
  // RESETPASSWORDREQUEST, then resolve on wherever the flow lands. Unlike
  // `register`, the connection is torn down only on `redirected` or a denial.
  // A `codeSent` outcome leaves it open (and handed to `submitRecoveryCode`)
  // because the code step needs that same connection.
  const recoverPassword = useCallback(
    async (server: LobbyServer, email: string): Promise<RecoveryStart> => {
      const serverKey = serverKeyFor(server, email);
      beginBusy(serverKey);
      const onEvent = new Channel<LobbyEvent>();
      let outcome: RecoveryStart | null = null;
      try {
        outcome = await new Promise<RecoveryStart>((resolve, reject) => {
          let settled = false;
          onEvent.onmessage = (ev) => {
            if (settled) return;
            if (ev.kind === "phase" && ev.phase === "awaitRecoveryCode") {
              settled = true;
              recoveryChannelsRef.current.set(serverKey, onEvent);
              resolve({ kind: "codeSent", serverKey });
            } else if (ev.kind === "delta" && ev.delta.kind === "recoveryUrl") {
              // teiserver's redirect: the phase that follows carries no
              // payload, so the address is read off this delta instead.
              settled = true;
              resolve({ kind: "redirected", url: ev.delta.url });
            } else if (
              ev.kind === "delta" &&
              ev.delta.kind === "recoveryDenied"
            ) {
              settled = true;
              reject(new Error(ev.delta.reason));
            } else if (ev.kind === "disconnected") {
              settled = true;
              reject(new Error(ev.reason ?? "Account recovery failed"));
            }
          };
          mpRecoverPassword({
            serverKey,
            host: server.host,
            port: server.port,
            tlsMode: tlsModeFor(server),
            allowSelfSigned: server.allowSelfSigned,
            email,
            clientId: clientIdRef.current,
            compatFlags: ["u", "sp"],
            onEvent,
          }).catch(reject);
        });
        return outcome;
      } finally {
        // Only `codeSent` leaves the connection parked for `submitRecoveryCode`
        // to finish and close. Every other outcome is torn down here, same as
        // `register` always does.
        if (outcome?.kind !== "codeSent") {
          await mpDisconnect({ serverKey }).catch((e) =>
            console.warn("multiplayer: disconnect cleanup failed", e),
          );
        }
        endBusy(serverKey);
      }
    },
    [beginBusy, endBusy],
  );

  // Finish account recovery with the emailed code, on the connection
  // `recoverPassword` left open awaiting it. Resolves on a `passwordReset`
  // delta with the username, the one time the protocol tells a locked-out
  // user who they are, and disconnects. The server drops us there anyway.
  //
  // Rejects with the server's reason on `recoveryDenied`, but does NOT
  // disconnect on that path. The login machine deliberately stays parked in
  // `AwaitRecoveryCode` after a wrong code (uberserver allows three
  // attempts), so the connection is left live and the channel stays in
  // `recoveryChannelsRef` for a retry. Calling this again with a fresh code
  // reaches the same connection rather than failing with "Not awaiting a
  // recovery code." `cancelRecovery` is what closes it if the user gives up
  // instead of retrying.
  //
  // The connection closing after the code went out resolves with no username
  // rather than rejecting. uberserver resets the password, emails it, queues
  // `RESETPASSWORDACCEPTED` and then aborts the connection, which throws the
  // queued line away, so a good code arrives as a dropped connection. A wrong
  // code is answered and leaves the connection open, so a drop here is almost
  // always the reset having worked.
  const submitRecoveryCode = useCallback(
    async (serverKey: string, code: string) => {
      const onEvent = recoveryChannelsRef.current.get(serverKey);
      if (!onEvent) throw new Error("Not awaiting a recovery code.");
      beginBusy(serverKey);
      let disconnect = true;
      try {
        return await new Promise<{ username: string | null }>(
          (resolve, reject) => {
            let settled = false;
            onEvent.onmessage = (ev) => {
              if (settled) return;
              if (ev.kind === "delta" && ev.delta.kind === "passwordReset") {
                settled = true;
                resolve({ username: ev.delta.username });
              } else if (
                ev.kind === "delta" &&
                ev.delta.kind === "recoveryDenied"
              ) {
                settled = true;
                disconnect = false;
                reject(new Error(ev.delta.reason));
              } else if (ev.kind === "disconnected") {
                settled = true;
                resolve({ username: null });
              }
            };
            mpSubmitRecoveryCode({ serverKey, code }).catch(reject);
          },
        );
      } finally {
        if (disconnect) {
          recoveryChannelsRef.current.delete(serverKey);
          await mpDisconnect({ serverKey }).catch((e) =>
            console.warn("multiplayer: disconnect cleanup failed", e),
          );
        }
        endBusy(serverKey);
      }
    },
    [beginBusy, endBusy],
  );

  // Tear down a recovery connection `recoverPassword` left open awaiting the
  // emailed code. A refused code deliberately leaves that connection live
  // (see `submitRecoveryCode`) so the user can retry, which means something
  // has to own closing it for the case where they give up instead. Also
  // fine to call on a connection that never reached that point, or one
  // already gone.
  const cancelRecovery = useCallback(async (serverKey: string) => {
    recoveryChannelsRef.current.delete(serverKey);
    await mpDisconnect({ serverKey }).catch((e) =>
      console.warn("multiplayer: disconnect cleanup failed", e),
    );
  }, []);

  // CHANGEPASSWORD is answered by a bare SERVERMSG with no token to correlate
  // on, so the only place a reply can be paired with a request is where the
  // request was made. Resolve on the next server message, and treat only
  // uberserver's exact success string as success: a stale saved password can
  // be retyped, one overwritten wrongly cannot.
  //
  // Guarded against a second call overlapping the first on the same
  // connection: with no token, two pending calls would each register a waiter,
  // and a single SERVERMSG would resolve both, handing one command's answer to
  // the other. Refusing a second call outright while one is already pending
  // closes that off.
  //
  // What stays unguarded, because nothing at any layer can tell a
  // CHANGEPASSWORD reply apart from any other SERVERMSG: an unrelated
  // broadcast (server maintenance, some other announcement) arriving while
  // this is the only pending call still resolves it. This is a known limit
  // of the protocol, not an oversight. What actually protects the user is
  // the exact-string check rather than any correlation. `succeeded` is only
  // ever true for that one literal success string, so a stray broadcast can
  // never read as a successful change, and so can never overwrite a good
  // saved password with a wrong one. The worst it can do is show the wrong
  // message while the real and saved passwords stay exactly as they were,
  // which the user fixes by retyping it.
  const changePassword = useCallback(
    async (current: string, next: string, serverKey?: string) => {
      const key = serverKey ?? activeKeyRef.current;
      const rt = key ? runtimesRef.current.get(key) : undefined;
      if (!key || !rt) throw new Error("Not connected.");
      const waiters = rt.serverMessageWaiters;
      if (waiters.size > 0) {
        throw new Error("A password change is already in progress.");
      }
      let waiter: (text: string) => void = () => {};
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(waiter);
      };
      const reply = new Promise<{ message: string; succeeded: boolean }>(
        (resolve, reject) => {
          timer = setTimeout(() => {
            cleanup();
            reject(new Error("The server did not answer."));
          }, SERVER_REPLY_TIMEOUT_MS);
          waiter = (text: string) => {
            cleanup();
            resolve({
              message: text,
              succeeded: text === CHANGE_PASSWORD_SUCCESS,
            });
          };
          waiters.add(waiter);
        },
      );
      // If the send itself fails (not connected by the time it reaches Rust, or
      // the connection just closed), no reply is ever coming: clean up now
      // rather than leaving the waiter live to block a retry behind "already in
      // progress" and the timer to reject into a promise nobody is holding.
      try {
        await mpChangePassword({
          serverKey: key,
          currentPassword: current,
          newPassword: next,
        });
      } catch (e) {
        cleanup();
        throw e;
      }
      return reply;
    },
    [],
  );

  // The connection an account command goes to, with its runtime, or a throw
  // when there is none.
  const accountTarget = useCallback((serverKey?: string) => {
    const key = serverKey ?? activeKeyRef.current;
    const rt = key ? runtimesRef.current.get(key) : undefined;
    if (!key || !rt) throw new Error("Not connected.");
    return { key, rt };
  }, []);

  const changeEmailRequest = useCallback(
    async (email: string, serverKey?: string) => {
      const { key, rt } = accountTarget(serverKey);
      const { promise, cleanup } = waitForAccountDelta(
        rt.accountDeltaWaiters,
        "changeEmailCodeSent",
        "changeEmailDenied",
      );
      try {
        await mpChangeEmailRequest({ serverKey: key, email });
      } catch (e) {
        cleanup();
        throw e;
      }
      await promise;
    },
    [accountTarget],
  );

  const changeEmail = useCallback(
    async (email: string, code: string, serverKey?: string) => {
      const { key, rt } = accountTarget(serverKey);
      const { promise, cleanup } = waitForAccountDelta(
        rt.accountDeltaWaiters,
        "changeEmailAccepted",
        "changeEmailDenied",
      );
      try {
        await mpChangeEmail({ serverKey: key, email, code });
      } catch (e) {
        cleanup();
        throw e;
      }
      await promise;
    },
    [accountTarget],
  );

  const resendVerification = useCallback(
    async (email: string, serverKey?: string) => {
      const { key, rt } = accountTarget(serverKey);
      const { promise, cleanup } = waitForAccountDelta(
        rt.accountDeltaWaiters,
        "resendVerificationAccepted",
        "resendVerificationDenied",
      );
      try {
        await mpResendVerification({ serverKey: key, email });
      } catch (e) {
        cleanup();
        throw e;
      }
      await promise;
    },
    [accountTarget],
  );

  const getUserInfo = useCallback((serverKey?: string) => {
    const key = serverKey ?? activeKeyRef.current;
    if (!key) throw new Error("Not connected.");
    mpGetUserInfo({ serverKey: key }).catch(() => {});
  }, []);

  // The connection parked on an agreement, preferring the focused one. Two
  // connections parking at once queue: the one not picked stays parked and
  // is picked up next once the first clears its `agreement` (issue #2847).
  const pendingAgreement = useMemo(
    () => pickPendingAgreement(connections, focusKey),
    [connections, focusKey],
  );

  // The connection whose debriefing drawer should be open, preferring the
  // focused one, queuing the same way `pendingAgreement` does (issue #2847).
  const activeDebriefing = useMemo(
    () => pickPendingDebriefing(connections, focusKey),
    [connections, focusKey],
  );

  const submitAgreementCode = useCallback(
    async (code: string) => {
      if (!pendingAgreement) return;
      const { serverKey } = pendingAgreement;
      // No code at all rather than an empty one, which would go out as
      // `CONFIRMAGREEMENT ` with a trailing space.
      await mpConfirmAgreement({ serverKey, code: code || null });
      updateConnection(serverKey, (c) => ({ ...c, agreement: null }));
    },
    [pendingAgreement, updateConnection],
  );

  const cancelAgreement = useCallback(async () => {
    if (!pendingAgreement) return;
    const serverKey = pendingAgreement.serverKey;
    // User-abandoned login: its `disconnected` is intentional, not a drop.
    markIntentional(serverKey);
    updateConnection(serverKey, (c) => ({ ...c, agreement: null }));
    await mpDisconnect({ serverKey }).catch(() => {});
  }, [markIntentional, pendingAgreement, updateConnection]);

  // Abort a connect that is still mid-handshake (the "Connecting…" state). Marks
  // the abort intentional and stops any reconnect loop before firing the backend
  // cancel, so the resulting `mpConnect` rejection unwinds cleanly to disconnected
  // without an error toast or an auto-reconnect. Safe to call with nothing pending.
  const cancelConnect = useCallback(
    async (serverKey?: string) => {
      // With no key, the most recent connect still opening, if there is one.
      const key = serverKey ?? [...connectingKeysRef.current].pop();
      markIntentional(key);
      stopReconnect(key);
      if (key) await mpCancelConnect({ serverKey: key }).catch(() => {});
    },
    [markIntentional, stopReconnect],
  );

  const disconnect = useCallback(
    async (serverKey?: string) => {
      // Mark intentional and kill any reconnect loop before the guard, so a manual
      // "log out" can't be mistaken for a drop even mid-reconnect (no active key).
      const key = serverKey ?? activeKeyRef.current ?? undefined;
      markIntentional(key);
      stopReconnect(key);
      if (!key) return;
      // A room is not a remembered login, so there is no flag to clear, and a
      // lobby server on this machine could share its address.
      if (!isRoomKey(key)) clearOpenAtQuitRef.current(key);
      beginBusy(key);
      try {
        await mpDisconnect({ serverKey: key });
      } finally {
        closeConnection(key);
        markGone(key);
        endBusy(key);
      }
    },
    [
      beginBusy,
      closeConnection,
      endBusy,
      isRoomKey,
      markGone,
      markIntentional,
      stopReconnect,
    ],
  );

  const clearJoinError = useCallback(
    (serverKey?: string) => {
      const key = serverKey ?? focusKey;
      if (key) dispatchMirror(key, { type: "clearJoinError" });
    },
    [dispatchMirror, focusKey],
  );

  // One person is in a game, or away, on every connection at once, so both
  // choices are held here and handed to every session (issue #2848).
  const [ingame, setIngame] = useState(false);
  const [manualAwayWanted, setManualAway] = useState(false);
  // Manual away is session state: logging out of the last connection clears
  // it, as closing the one connection did before.
  useEffect(() => {
    if (activeKey == null) setManualAway(false);
  }, [activeKey]);

  const closeDebriefing = useCallback(() => {
    // Closes whichever connection's debriefing is actually shown, not the
    // focused one (issue #2847): with two open at once the shown one may
    // belong to the other connection, and closing the wrong one would leave
    // the drawer open on a report nobody asked to dismiss.
    if (activeDebriefing) {
      updateConnection(activeDebriefing.serverKey, (c) => ({
        ...c,
        debriefingShown: null,
      }));
    }
  }, [activeDebriefing, updateConnection]);

  // After a webview reload the React state resets but the Rust connection
  // tasks keep running, so re-adopt every live connection on mount (via
  // `mp_reattach`), not only the first (issue #2842). Without this a Vite
  // hot-reload or refresh strands the UI as "disconnected" while the backend
  // is still logged in, and a fresh connect would be rejected as a duplicate
  // login. A second open connection left behind this way used to be reachable
  // from nowhere on screen. Runs once.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    (async () => {
      const reattached: string[] = [];
      try {
        const { keys } = await mpActiveKeys({});
        for (const serverKey of keys) {
          try {
            const rt = runtimeFor(serverKey);
            const onEvent = openChannel(serverKey);
            dispatchConn({
              type: "open",
              serverKey,
              direct: serverKey === roomKeyRef.current,
            });
            await mpReattach({ serverKey, onEvent });
            const snap = await mpSnapshot({ serverKey });
            rt.state = snap.state;
            dispatchMirror(serverKey, { type: "snapshot", state: snap.state });
            liveKeysRef.current.add(serverKey);
            updateConnection(serverKey, (c) =>
              c.live ? c : { ...c, live: true },
            );
            reattached.push(serverKey);
          } catch {
            // This one key failed to reattach (e.g. Rust evicted it between the
            // list and the attempt). Its entry stays behind, not live, so its
            // error is still reachable from the interface. Move on to the rest.
          }
        }
      } catch {
        // Couldn't ask Rust for the live keys at all: nothing to reattach, so
        // fall through to opt-in auto-connect below.
      }
      if (reattached.length > 0) {
        // The last login stays focused across the reload if it's one of the
        // connections just reattached. Otherwise the first lobby login is,
        // since a room does not take focus from one (issue #2850), and the
        // first key when there is nothing else to go on.
        const b = bootRef.current;
        const resolved = resolveLastLogin(
          b.lastLogin,
          b.accounts,
          allServers(b.custom),
        );
        const lastLoginKey = resolved
          ? serverKeyFor(resolved.server, resolved.account.username)
          : null;
        const focused =
          (lastLoginKey && reattached.includes(lastLoginKey)
            ? lastLoginKey
            : null) ??
          reattached.find((key) => key !== roomKeyRef.current) ??
          reattached[0];
        focusOn(focused);
        return;
      }
      // Fresh launch with nothing to reattach: if the user opted in, connect
      // every remembered login (every account flagged open at quit, or, for
      // someone upgrading from a version that tracked only one, that single
      // login) one after another via `connectRemembered` (issue #2849), so a
      // player logged in to two servers can tell which login needs attention
      // from its own notification.
      const b = bootRef.current;
      const targets = autoConnectTargets(
        b.autoConnect,
        b.lastLogin,
        b.accounts,
        allServers(b.custom),
      );
      await connectRemembered(targets);
    })();
  }, [
    dispatchMirror,
    focusOn,
    openChannel,
    connectRemembered,
    runtimeFor,
    updateConnection,
  ]);

  // Whether more than one connection exists at all (not only live ones, so
  // two connections both still parked on an agreement still count). Gates
  // naming the server on the boxed-message dialog and the debriefing drawer,
  // the same "only once there's something to tell apart" rule
  // `VerificationCodeDialog` applies to the agreement dialog and
  // `ConversationSidebar` applies to its per-connection headings (issue
  // #2847). With one connection every one of these looks exactly as it did
  // before servers were told apart.
  const multipleConnections = Object.keys(connections).length > 1;

  return (
    <MultiplayerContext.Provider
      value={{
        mirror,
        connections,
        activeKey,
        connected: hasLiveLogin(connections),
        protocol,
        revealed,
        busy,
        busyKeys,
        connect,
        reconnectAll: connectRemembered,
        connectDirect,
        signIn,
        register,
        recoverPassword,
        submitRecoveryCode,
        cancelRecovery,
        changePassword,
        changeEmailRequest,
        changeEmail,
        resendVerification,
        getUserInfo,
        accountInfo: focus?.accountInfo ?? null,
        disconnect,
        cancelConnect,
        pendingAgreement,
        submitAgreementCode,
        cancelAgreement,
        unreadFor,
        markSeen,
        rememberChannel,
        forgetChannel,
        requestJoinChannel,
        lastJoinError: mirror.lastJoinError,
        clearJoinError,
        loginPopoverOpen,
        openLoginPopover,
        closeLoginPopover,
        justWentIngame: focus?.justWentIngame ?? NO_NAMES,
        channelJoinFailures: focus?.channelJoinFailures ?? NO_FAILURES,
        status: focus?.status ?? NOT_AWAY,
        setIngame,
        manualAway: focus?.manualAway ?? false,
        setManualAway,
      }}
    >
      {children}
      {Object.values(connections).map((entry) => (
        <ConnectionSession
          key={entry.serverKey}
          entry={entry}
          runtime={runtimeFor(entry.serverKey)}
          servers={protocolServers}
          joinedChannels={joinedChannels}
          setJoinedChannels={setJoinedChannels}
          ignored={ignored}
          setIgnored={setIgnored}
          favourites={favourites}
          requestJoinChannel={requestJoinChannel}
          update={updateConnection}
          onSeenChange={forceSeenTick}
          ingame={ingame}
          manualAway={manualAwayWanted}
        />
      ))}
      <VerificationCodeDialog />
      <MatchFoundPanel />
      <ServerMessageBoxDialog
        text={serverMsgBoxes[0]?.text ?? null}
        serverName={
          serverMsgBoxes[0] && multipleConnections
            ? serverNameFor(serverMsgBoxes[0].serverKey, protocolServers)
            : null
        }
        onDismiss={() => setServerMsgBoxes((q) => q.slice(1))}
      />
      <DebriefingDrawer
        open={activeDebriefing != null}
        report={activeDebriefing?.report ?? null}
        myUsername={activeDebriefing?.myUsername ?? null}
        serverKey={activeDebriefing?.serverKey}
        serverName={
          activeDebriefing && multipleConnections
            ? serverNameFor(activeDebriefing.serverKey, protocolServers)
            : null
        }
        onClose={closeDebriefing}
      />
    </MultiplayerContext.Provider>
  );
}

// Stable empty values for the context when no connection is in focus, so a
// consumer's effect keyed on one does not re-run every render.
const NO_NAMES: ReadonlySet<string> = new Set();
const NO_FAILURES: Record<string, string> = {};
const NOT_AWAY: ClientFlags = { ingame: false, away: false };

/** Access the app-level lobby connection. Must be used within the provider. */
export function useMultiplayer(): MultiplayerContextValue {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) {
    throw new Error("useMultiplayer must be used within MultiplayerProvider");
  }
  return ctx;
}

/**
 * One connection's state by server key, or null when there is no such
 * connection (issue #2841). Actions that take an optional `serverKey` act on
 * the same connection when given this key.
 */
export function useConnection(
  serverKey: string | null | undefined,
): ConnectionState | null {
  const { connections } = useMultiplayer();
  return serverKey != null ? (connections[serverKey] ?? null) : null;
}

/**
 * The server catalog {@link protocolForKey} and {@link serverNameFor} match
 * against, for a caller reading a connection's protocol or display name by a
 * `serverKey` that is not necessarily the active one (issue #2843). Built-ins
 * plus the user's own servers, deliberately not profile-filtered, matching
 * the reasoning behind the provider's own `protocol` field.
 */
export function useProtocolServers(): LobbyServer[] {
  const [customCfg] = useCustomServers();
  return useMemo(
    () => [...BUILTIN_SERVERS, ...customCfg.servers],
    [customCfg.servers],
  );
}
