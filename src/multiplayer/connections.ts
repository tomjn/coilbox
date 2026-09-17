import type { LobbyServer } from "../lobby-servers/config";
import type { ClientFlags } from "./awayStatus";
import type { Debriefing, Delta, LobbyState } from "./bindings";
import {
  initialMirror,
  type LobbyMirror,
  type MirrorAction,
  mirrorReducer,
} from "./mirror";

/**
 * The account's details as `mpGetUserInfo` answers them, merged from the three
 * `accountInfo` deltas the server sends separately. A field stays at its last
 * known value until its own line arrives, so a caller reading before the first
 * answer sees every field null.
 */
export interface AccountInfo {
  registrationDate: string | null;
  email: string | null;
  ingameHours: string | null;
}

/**
 * What the interface can read about one lobby connection (issue #2841).
 *
 * The Rust plugin already holds a connection per server key, and this is the
 * frontend half of that: everything that used to be one-of in the provider and
 * belongs to a connection rather than to the app. An entry is made when a
 * connect starts, or when a reload adopts a connection, and removed when that
 * connection is logged out or cancelled. A connection that drops keeps its
 * entry, not live, so the reason it dropped can still be shown.
 */
export interface ConnectionState {
  serverKey: string;
  /**
   * Whether the connection finished opening and has not dropped since. While
   * `connectBlockedReason` allows one connection, the live entry is always the
   * provider's `activeKey`.
   */
  live: boolean;
  mirror: LobbyMirror;
  /**
   * The agreement text the connection is parked on, which may be empty, or
   * null when it is not waiting for one.
   */
  agreement: string | null;
  /** The account's details, or null before any have arrived. */
  accountInfo: AccountInfo | null;
  /** The game whose debriefing is open, or null when the drawer is shut. */
  debriefingShown: number | null;
  /** Channels whose join the server refused this session (name -> reason). */
  channelJoinFailures: Record<string, string>;
  /** Players who have just gone in-game, held briefly for a row flash. */
  justWentIngame: ReadonlySet<string>;
  /** Our own client status on this connection, as last resolved. */
  status: ClientFlags;
  /** Whether the user set themselves away by hand on this connection. */
  manualAway: boolean;
}

/** Every connection the provider holds, by server key. */
export type Connections = Readonly<Record<string, ConnectionState>>;

/**
 * The key of another live connection, once `excludeKey` is done with, or null
 * when none of the survivors are live. Used to refocus the provider's single-
 * connection fields onto a connection that is still usable, rather than onto
 * nothing, when the one in focus is disconnected or drops (issue #2894).
 */
export function anotherLiveKey(
  connections: Connections,
  excludeKey: string | null,
): string | null {
  for (const entry of Object.values(connections)) {
    if (entry.serverKey !== excludeKey && entry.live) return entry.serverKey;
  }
  return null;
}

/**
 * Every live connection's key, the focused one first when it is among them.
 * Pure. Settings pages that act on one connected account use this to build an
 * account picker once more than one is connected (issue #2846), the same
 * "focused first" ordering {@link liveTachyonKeys} in `protocol.ts` uses.
 */
export function liveConnectionKeys(
  connections: Connections,
  focusKey: string | null,
): string[] {
  const keys = Object.keys(connections).filter((key) => connections[key].live);
  if (focusKey == null || !keys.includes(focusKey)) return keys;
  return [focusKey, ...keys.filter((key) => key !== focusKey)];
}

/**
 * The connection parked on the agreement / verification-code handshake to
 * show, preferring the focused one, or null when none are parked (issue
 * #2847). Two connections parking at once queue rather than race: whichever
 * is not picked stays parked in `connections`, so this returns it next once
 * the first clears its `agreement` (accepted, coded, or disconnected).
 */
export function pendingAgreement(
  connections: Connections,
  focusKey: string | null,
): { serverKey: string; text: string } | null {
  const parked = Object.values(connections).filter((c) => c.agreement != null);
  const pick =
    parked.find((c) => c.serverKey === focusKey) ?? parked[0] ?? null;
  return pick ? { serverKey: pick.serverKey, text: pick.agreement ?? "" } : null;
}

/**
 * The connection whose debriefing drawer should be open, preferring the
 * focused one, or null when none has one waiting (issue #2847). A
 * connection only counts once its mirror has caught up with the `battleId`
 * `debriefingShown` recorded, since the drawer opens off the result rather
 * than off the bare notice that one exists. Queues the same way
 * {@link pendingAgreement} does: the connection not picked stays recorded
 * and surfaces next once the shown one is closed.
 */
export function pendingDebriefing(
  connections: Connections,
  focusKey: string | null,
): { serverKey: string; report: Debriefing; myUsername: string | null } | null {
  const parked = Object.values(connections).filter(
    (c) =>
      c.debriefingShown != null &&
      c.mirror.state?.debriefing?.battleId === c.debriefingShown,
  );
  const pick =
    parked.find((c) => c.serverKey === focusKey) ?? parked[0] ?? null;
  const report = pick?.mirror.state?.debriefing ?? null;
  if (!pick || !report) return null;
  return {
    serverKey: pick.serverKey,
    report,
    myUsername: pick.mirror.state?.myUsername ?? null,
  };
}

export type ConnectionAction =
  /** Make an entry for a connection, keeping one that already exists. */
  | { type: "open"; serverKey: string }
  | { type: "close"; serverKey: string }
  | { type: "mirror"; serverKey: string; action: MirrorAction }
  /** Apply a pure updater to one entry. Returning the entry unchanged is a no-op. */
  | {
      type: "update";
      serverKey: string;
      update: (c: ConnectionState) => ConnectionState;
    };

export function newConnection(serverKey: string): ConnectionState {
  return {
    serverKey,
    live: false,
    mirror: initialMirror,
    agreement: null,
    accountInfo: null,
    debriefingShown: null,
    channelJoinFailures: {},
    justWentIngame: new Set(),
    status: { ingame: false, away: false },
    manualAway: false,
  };
}

/**
 * Fold one action into the connection map. An action for a key with no entry
 * is dropped, because an event from a connection that has been closed must
 * not bring it back or reach anything else.
 */
export function connectionsReducer(
  all: Connections,
  action: ConnectionAction,
): Connections {
  const { serverKey } = action;
  const current = all[serverKey];
  switch (action.type) {
    case "open":
      return current ? all : { ...all, [serverKey]: newConnection(serverKey) };
    case "close": {
      if (!current) return all;
      const { [serverKey]: _closed, ...rest } = all;
      return rest;
    }
    case "mirror": {
      if (!current) return all;
      const mirror = mirrorReducer(current.mirror, action.action);
      return mirror === current.mirror
        ? all
        : { ...all, [serverKey]: { ...current, mirror } };
    }
    case "update": {
      if (!current) return all;
      const next = action.update(current);
      return next === current ? all : { ...all, [serverKey]: next };
    }
    default:
      return all;
  }
}

/**
 * The per-connection values the provider reads and writes outside a render:
 * from the frozen event handler, the reconnect loop and the account commands.
 * Held in a ref keyed by server key rather than in state, for the same reason
 * the single refs they replace were refs.
 *
 * A runtime is made when a connect starts and removed when its connection is
 * closed, so an event arriving on a closed connection's channel finds none and
 * is ignored (issue #2149).
 */
export interface ConnectionRuntime {
  /** A user-initiated disconnect or cancel is in flight, so its drop is expected. */
  intentional: boolean;
  /** The session reached `ready`, so a drop is worth reconnecting. */
  loggedIn: boolean;
  /** The server refused this attempt's credentials, so do not retry them. */
  denied: boolean;
  /** Enough to connect again, captured on each connect attempt. */
  reconnectCtx: {
    server: LobbyServer;
    username: string;
    /** A room this client hosts, which has no stored credential to re-read. */
    direct?: boolean;
  } | null;
  /** The battle to rejoin once a reconnect reaches `ready`. */
  rejoinBattle: { id: number; scriptPassword: string | null } | null;
  /** Bumped to invalidate a running reconnect loop. */
  reconnectGen: number;
  reconnectAttempt: number;
  reconnectTimer: number | null;
  /** The latest snapshot, for the event handler and the drop path. */
  state: LobbyState | null;
  /** Channels we asked to join, awaiting the server's confirm. */
  pendingJoins: Set<string>;
  /** Channels whose refusal has been toasted this session. */
  notifiedJoinFailures: Set<string>;
  /** Per-conversation "seen up to N messages" marks. */
  seen: Record<string, number>;
  baselineDone: boolean;
  /** Callbacks waiting on the next `SERVERMSG` (see `changePassword`). */
  serverMessageWaiters: Set<(text: string) => void>;
  /** Callbacks waiting on an account command's accept or deny delta. */
  accountDeltaWaiters: Set<(d: Delta) => void>;
  /** The away-status setters of this connection's session, once mounted. */
  away: {
    setIngame: (ingame: boolean) => void;
    setManualAway: (away: boolean) => void;
  } | null;
}

export function newRuntime(): ConnectionRuntime {
  return {
    intentional: false,
    loggedIn: false,
    denied: false,
    reconnectCtx: null,
    rejoinBattle: null,
    reconnectGen: 0,
    reconnectAttempt: 0,
    reconnectTimer: null,
    state: null,
    pendingJoins: new Set(),
    notifiedJoinFailures: new Set(),
    seen: {},
    baselineDone: false,
    serverMessageWaiters: new Set(),
    accountDeltaWaiters: new Set(),
    away: null,
  };
}
