import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";
import type { TlsMode } from "../lobby-servers/config";
import type { BattleConfig } from "../play/bindings";

/**
 * Typed bindings to the `coilbox-multiplayer` plugin. The connection is long-lived:
 * `mpConnect` opens the socket and streams `LobbyEvent`s over a `Channel` until
 * disconnect; the frontend keeps a mirror of the authoritative Rust state seeded by
 * `mpSnapshot`. Every shape here mirrors the Rust side (serde camelCase); the state
 * types mirror `coilbox_lobby_protocol::state`.
 */

// ---------------------------------------------------------------------------
// State mirror types (mirror `coilbox-lobby-protocol` `LobbyState`).
// ---------------------------------------------------------------------------

/** The 7-bit client status bitfield, decoded. */
export interface ClientStatus {
  ingame: boolean;
  away: boolean;
  rank: number;
  access: boolean;
  bot: boolean;
}

/** The 32-bit per-battle status bitfield, decoded. */
export interface BattleStatus {
  ready: boolean;
  teamId: number;
  ally: number;
  /** true = player, false = spectator. */
  mode: boolean;
  handicap: number;
  sync: number;
  side: number;
}

export interface User {
  name: string;
  country: string;
  userId: string;
  agent: string;
  status: ClientStatus;
}

export type ChatKind =
  | "said"
  | "saidEx"
  | "saidBattle"
  | "private"
  | "system"
  | "join"
  | "leave";

export interface ChatMsg {
  channel: string | null;
  from: string;
  text: string;
  kind: ChatKind;
  at: number;
  /**
   * The server's channel-history id, present only on messages replayed from a
   * channel's backlog; live chat carries none. So `id != null` means "this is
   * history, not news" — which is what keeps a backlog from being counted as
   * unread or firing the mention cue. On these, `at` is the original send time.
   */
  id: number | null;
}

export interface ChannelState {
  name: string;
  topic: string | null;
  users: string[];
  messages: ChatMsg[];
  /** Registered founder (from ChanServ `:info`), or null. */
  founder: string | null;
  /** Channel operators (from ChanServ `:info`); empty until queried. */
  operators: string[];
}

export interface DirChannel {
  name: string;
  userCount: number;
  topic: string | null;
}

export interface MemberStatus {
  battleStatus: BattleStatus;
  teamColor: number;
  scriptPassword: string | null;
}

export interface Bot {
  name: string;
  owner: string;
  aiDll: string;
  battleStatus: BattleStatus;
  teamColor: number;
}

/** Ally start rectangle; bounds are integers on a 0..200 grid (200 = full map). */
export interface StartRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Battle {
  id: number;
  /**
   * The Tachyon lobby id this battle came from, or `null` on a TASServer
   * connection. Tachyon names a lobby by a string uuid and `id` is a number, so
   * `id` is a handle derived from this and this is what a join has to name.
   */
  tachyonId: string | null;
  host: string;
  ip: string;
  port: string;
  /**
   * The host's declared NAT traversal mode: `"0"` direct, `"1"` hole punching,
   * `"2"` fixed source ports. Coilbox only does the direct case.
   */
  natType: string;
  map: string;
  maphash: string;
  modname: string;
  engine: string;
  version: string;
  maxPlayers: number;
  /**
   * How many players the server says are in the battle, where the server counts
   * them for us. TASServer does not, so it is `null` there and the count comes
   * from `members` and `host` instead.
   */
  playerCount: number | null;
  passworded: boolean;
  locked: boolean;
  spectatorCount: number;
  title: string;
  channel: string | null;
  members: Record<string, MemberStatus>;
  bots: Record<string, Bot>;
  scriptTags: Record<string, string>;
  startRects: Record<string, StartRect>;
  /**
   * The members who may change the lobby, by the name the roster shows. Tachyon's
   * answer to a host: a lobby has no founder, and a boss is appointed by a vote
   * rather than by opening the battle. Always empty on a TASServer connection.
   */
  bosses: string[];
  /** Whether this lobby allows bosses at all. A lobby with them off refuses to
   *  appoint one, so the room offers it only when this is set. */
  bossesEnabled: boolean;
  /**
   * Whether a battle is running in this lobby, so the row offers Watch live
   * rather than Join. Tachyon says so on the lobby itself. Always false on a
   * TASServer connection, where the list reads the host's ingame bit instead.
   */
  inProgress: boolean;
  /**
   * The room's mode where the protocol has one: `custom`, `teams`, `1v1`,
   * `ffa`, `coop` or `planetwars`. Zero-K only, and null everywhere else.
   *
   * What it decides is whether the room takes AIs at all: Zero-K's server
   * refuses a bot outside a custom or cooperative room. See `roomTakesBots`.
   */
  mode: string | null;
}

/**
 * A live vote in the current battle (mirrors `Vote`). Present only while a vote
 * is open, and drives the one-click vote panel. Scraped out of chat on a
 * TASServer connection and read off the lobby on a Tachyon one.
 */
export interface Vote {
  subject: string;
  caller: string;
  yes: number;
  no: number;
  /** Yes votes needed to pass, 0 when the server has not said. */
  yesNeeded: number;
  /** No votes needed to fail, 0 when the server has not said. */
  noNeeded: number;
  allowAbstain: boolean;
  /** Unix-millis deadline (0 if unknown). */
  endsAt: number;
}

/**
 * A party: a small group that stays together across battles (mirrors `Party`).
 * Tachyon only, so a TASServer connection never has one.
 *
 * People are named the way the rest of the app names them. Somebody the server
 * has not named yet appears under their user id, as they do in a battle roster.
 */
export interface Party {
  /** The server's id, which is what an answer to an invitation names. */
  id: string;
  members: string[];
  /** The people invited and yet to answer. */
  invited: string[];
  maxMembers: number;
}

/** One queue a player can search in (mirrors `MatchQueue`). */
export interface MatchQueue {
  /** The server's id, which is what a search names. */
  id: string;
  /** What to call it on screen, such as "Duel". */
  name: string;
  /** How many teams play, and how many players are on each. */
  teams: number;
  teamSize: number;
  /** Whether a result here counts towards a rating. */
  ranked: boolean;
  /** What a match out of this queue can be played on, by the names the content
   * scan knows them under. */
  maps: string[];
  games: string[];
  engines: string[];
}

/** A match the server has put together and is waiting on (mirrors `MatchFound`). */
export interface MatchFound {
  queueId: string;
  /** Unix millis by which every player has to have accepted. */
  readyBy: number;
  /** How many have accepted so far, from `matchmaking/foundUpdate`. */
  readyCount: number;
  /** Whether we have accepted. */
  readied: boolean;
}

/**
 * Where this connection is in matchmaking (mirrors `Matchmaking`). Tachyon only,
 * so a TASServer connection leaves it at its default.
 */
export interface Matchmaking {
  /** False once the server has answered `command_unimplemented`, which is how one
   * that has not built matchmaking says so. */
  supported: boolean;
  queues: MatchQueue[];
  /** The ids of the queues we are searching in. A party member's search puts us
   * in queues we never asked about. */
  searching: string[];
  found: MatchFound | null;
}

export interface LobbyState {
  myUsername: string | null;
  compflags: string[];
  users: Record<string, User>;
  channels: Record<string, ChannelState>;
  dms: Record<string, ChatMsg[]>;
  battles: Record<string, Battle>;
  currentBattle: number | null;
  lastBattle: number | null;
  /** The UDP port the server assigned for a battle we host (`HOSTPORT`). */
  hostPort: number | null;
  channelDirectory: DirChannel[];
  /** A live vote in the current battle, or null when none is open. */
  currentVote: Vote | null;
  /** Server-confirmed ignores (from `IGNORELIST` and IGNORE/UNIGNORE acks). The
   * local ignore list drives client-side hiding; this mirrors the server's set. */
  serverIgnores: string[];
  /** Mutual server-side friends, synced from `FRIENDLIST` (empty on unsupported servers). */
  friends: string[];
  /** Incoming pending friend requests awaiting accept/decline. */
  friendRequests: string[];
  /** The party we are in, or null when we are in none. Always null on TASServer. */
  party: Party | null;
  /** The parties we have been invited to and not yet answered. */
  partyInvites: Party[];
  /** Where we are in matchmaking. At its default on TASServer, which has none. */
  matchmaking: Matchmaking;
}

/**
 * The phases of the login handshake (mirrors `LoginPhase`). The first ten are the
 * TASServer exchange. Tachyon has no login exchange at all, because it presents
 * its token on the HTTP upgrade, so it has only the two steps that happen before
 * its socket exists and then goes straight to `ready`, which is what the rest of
 * the app gates on.
 */
export type LoginPhase =
  | "awaitGreeting"
  | "tlsUpgrade"
  | "awaitCompFlags"
  | "awaitAccepted"
  | "awaitRegistration"
  | "awaitAgreement"
  | "streamingState"
  | "ready"
  | "registered"
  | "denied"
  | "tachyonAuthorizing"
  | "tachyonOpening";

// ---------------------------------------------------------------------------
// Deltas and events (tagged unions on `kind`).
// ---------------------------------------------------------------------------

/** A state change produced by the reducer (mirrors `Delta`). */
export type Delta =
  | { kind: "userAdded"; name: string }
  | { kind: "userRemoved"; name: string }
  | { kind: "userStatusChanged"; name: string }
  | { kind: "battleOpened"; id: number }
  | { kind: "battleClosed"; id: number }
  | { kind: "battleInfoChanged"; id: number }
  | { kind: "enteredBattle"; id: number; own: boolean }
  | { kind: "memberJoined"; battleId: number; name: string }
  | { kind: "memberLeft"; battleId: number; name: string }
  | { kind: "memberStatusChanged"; battleId: number; name: string }
  | { kind: "botChanged"; battleId: number; name: string }
  | { kind: "botRemoved"; battleId: number; name: string }
  | { kind: "chatMessage"; channel: string | null; index: number }
  | { kind: "privateMessage"; from: string }
  | { kind: "channelJoined"; channel: string }
  | { kind: "channelLeft"; channel: string }
  | { kind: "channelTopicChanged"; channel: string }
  | { kind: "channelOpsChanged"; channel: string }
  | { kind: "startRectChanged"; ally: number }
  | { kind: "scriptTagsChanged" }
  | { kind: "playerWentIngame"; name: string }
  | { kind: "hostPort"; port: number }
  | { kind: "loggedIn"; username: string }
  | { kind: "loginDenied"; reason: string }
  | { kind: "registrationDenied"; reason: string }
  | { kind: "serverMessage"; text: string; boxed: boolean }
  | { kind: "motd"; line: string }
  | { kind: "ring"; from: string }
  | { kind: "joinBattleFailed"; reason: string }
  | { kind: "openBattleFailed"; reason: string }
  | { kind: "joinChannelFailed"; channel: string; reason: string }
  | { kind: "commandFailed"; command: string; reason: string }
  | { kind: "channelListReceived" }
  | { kind: "ignored"; name: string }
  | { kind: "unignored"; name: string }
  | { kind: "serverIgnoreList"; ignores: string[] }
  | { kind: "friendsChanged" }
  | { kind: "friendRequestsChanged" }
  | { kind: "partyChanged" }
  | { kind: "matchmakingChanged" }
  | { kind: "voteChanged" };

/** An event streamed over the connect `Channel` (mirrors `LobbyEvent`). */
export type LobbyEvent =
  | { kind: "connected" }
  | { kind: "phase"; phase: LoginPhase; agreement: string | null }
  | { kind: "delta"; delta: Delta }
  | { kind: "console"; direction: "in" | "out"; line: string }
  /**
   * A Tachyon server has told us where the match is and the connection has said
   * we will be there. The room launches off this. The config comes from
   * `mpBuildBattleConfig`, so a relaunch after our engine exits reads the same one.
   */
  | { kind: "battleStarting" }
  | { kind: "disconnected"; reason: string | null };

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

/**
 * Open a lobby connection. Streams `LobbyEvent`s over `onEvent` until disconnect;
 * the password is hashed server-side and never sent in plaintext.
 */
export const mpConnect = defineCommand<
  {
    serverKey: string;
    host: string;
    port: number;
    tlsMode: TlsMode;
    allowSelfSigned: boolean;
    username: string;
    password: string;
    /** The per-install `LOGIN` userID (see `clientId.ts`). */
    clientId: string;
    compatFlags: string[];
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_connect");

/**
 * Open a lobby connection to a Tachyon server. Streams the same `LobbyEvent`s over
 * `onEvent` as `mpConnect` does, so everything above the connection is unchanged.
 *
 * There is no password. The credential is a bearer token the Rust side holds and
 * presents on the HTTP upgrade, refreshed from the sign-in `mpTachyonSignIn`
 * stored, so this never opens a browser. It fails if the user has not signed in.
 */
export const mpConnectTachyon = defineCommand<
  {
    serverKey: string;
    host: string;
    port: number;
    tls: boolean;
    /** The server entry's id, which is half the key the sign-in is stored under. */
    serverId: string;
    username: string;
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_connect_tachyon");

/**
 * Open a lobby connection to Zero-K's server. Streams the same `LobbyEvent`s over
 * `onEvent` as `mpConnect` does, so everything above the connection is unchanged.
 *
 * The server speaks first: a `Welcome` arrives unprompted and the Rust side
 * answers it with `Login`, so there is no handshake to drive from here. Success
 * is the `ready` phase, a refusal arrives as a `loginDenied` delta followed by
 * `disconnected`.
 *
 * A refusal must not be retried on a loop. Zero-K's server logs failed attempts
 * per IP address, so a retry walks into a ban on the address rather than on the
 * account.
 */
export const mpConnectZerok = defineCommand<
  {
    serverKey: string;
    host: string;
    port: number;
    username: string;
    password: string;
    /** The per-install `InstallID` (see `clientId.ts`). */
    installId: string;
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_connect_zerok");

/**
 * Create a new Zero-K account, then disconnect. Streams the same `LobbyEvent`s as
 * `mpRegister`: success is the `registered` phase, a refusal arrives as a
 * `registrationDenied` delta ahead of the `disconnected` that follows it.
 *
 * Runs on a connection of its own and does NOT log in, so the caller drops it and
 * connects normally afterwards. Unlike the TASServer servers, Zero-K stores the
 * email against the account without checking it, so there is no verification code
 * and the login that follows is an ordinary one.
 *
 * A refusal must not be retried on a loop, for the same reason a refused login
 * must not be: attempts are counted per IP address.
 */
export const mpRegisterZerok = defineCommand<
  {
    serverKey: string;
    host: string;
    port: number;
    username: string;
    password: string;
    email: string | null;
    /** The per-install `InstallID` (see `clientId.ts`). */
    installId: string;
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_register_zerok");

/**
 * Sign in to a Tachyon server through the system browser, and keep the result.
 * Resolves only once the user has finished there, which can take a minute, and
 * rejects if they never do.
 *
 * `baseUrl` is the server's own origin (see `tachyonBaseUrl`). No token comes back
 * over IPC: the refresh token goes to the OS keychain and the access token stays
 * in memory on the Rust side.
 */
export const mpTachyonSignIn = defineCommand<
  { baseUrl: string; serverId: string; username: string },
  Record<string, never>
>("coilbox-multiplayer", "mp_tachyon_sign_in");

/**
 * Forget a Tachyon sign-in on this machine, both the stored refresh token and any
 * access token.
 *
 * This machine is as far as it goes. Teiserver has no token revocation endpoint,
 * so the refresh token stays valid on the server whatever we do here.
 */
export const mpTachyonSignOut = defineCommand<
  { serverId: string; username: string },
  Record<string, never>
>("coilbox-multiplayer", "mp_tachyon_sign_out");

/**
 * Whether a connect for this account can get a token without opening a browser.
 * False once the server has refused the stored sign-in, which is what tells the
 * auto-reconnect loop to stop rather than retry.
 */
export const mpTachyonSignedIn = defineCommand<
  { serverId: string; username: string },
  { signedIn: boolean }
>("coilbox-multiplayer", "mp_tachyon_signed_in");

/**
 * Send one Tachyon request over a live connection and wait for its answer. Only
 * the protocol console drawer uses this: every other command sends what it needs
 * from the connection task, where it can act on the reply.
 *
 * The Rust side builds the envelope and the `messageId`, so a frame sent here goes
 * out the same way every other request does. Rejects when the key names no live
 * Tachyon connection, when the server refuses the command, and when the request
 * timed out or was never sent.
 */
export const mpTachyonRequest = defineCommand<
  { serverKey: string; commandId: string; data: unknown },
  { response: string }
>("coilbox-multiplayer", "mp_tachyon_request");

/**
 * Register a new account on a server, then disconnect. Streams `LobbyEvent`s over
 * `onEvent`; success is the `registered` phase, denial arrives as `disconnected`
 * with the server's reason. Does NOT log in — connect normally afterwards.
 */
export const mpRegister = defineCommand<
  {
    serverKey: string;
    host: string;
    port: number;
    tlsMode: TlsMode;
    allowSelfSigned: boolean;
    username: string;
    password: string;
    email: string | null;
    clientId: string;
    compatFlags: string[];
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_register");

/**
 * Resume a login parked awaiting the emailed verification code: sends
 * `CONFIRMAGREEMENT [code]` and re-logs-in on the live connection. Omit `code` for
 * agreements that need none.
 */
export const mpConfirmAgreement = defineCommand<
  { serverKey: string; code?: string | null },
  { sent: boolean }
>("coilbox-multiplayer", "mp_confirm_agreement");

/** Disconnect and tear down the connection task. */
export const mpDisconnect = defineCommand<
  { serverKey: string },
  { disconnected: boolean }
>("coilbox-multiplayer", "mp_disconnect");

/**
 * Abort a connect still mid-handshake (before it becomes a live connection).
 * Fires the pending cancel token so the in-flight `mpConnect` rejects promptly and
 * no socket lingers. A no-op if the connect already completed.
 */
export const mpCancelConnect = defineCommand<
  { serverKey: string },
  { cancelled: boolean }
>("coilbox-multiplayer", "mp_cancel_connect");

/**
 * Resolve once a connection has finished logging in.
 *
 * `mpConnect` resolves when the socket is up and the connection task is running,
 * which is not the same as being logged in. Anything sent in between is sent by a
 * client the server does not know yet, and is refused. For a caller that connects
 * and then acts in one breath, with no render in between to watch the phase for
 * it. Rejects on a login that is refused, dropped, or never finishes.
 */
export const mpWaitUntilReady = defineCommand<
  { serverKey: string },
  { ready: boolean }
>("coilbox-multiplayer", "mp_wait_until_ready");

/**
 * Re-adopt a still-live connection after a webview reload: swap in a fresh event
 * `Channel`. The backend replays `Connected` + the current phase over it, then the
 * caller pulls `mpSnapshot` to refill its mirror.
 */
export const mpReattach = defineCommand<
  { serverKey: string; onEvent: Channel<LobbyEvent> },
  { reattached: boolean }
>("coilbox-multiplayer", "mp_reattach");

/** The server keys of all live connections (to re-adopt one after a reload). */
export const mpActiveKeys = defineCommand<
  Record<string, never>,
  { keys: string[] }
>("coilbox-multiplayer", "mp_active_keys");

/** Clone the authoritative state for one connection (to seed/resync the mirror). */
export const mpSnapshot = defineCommand<
  { serverKey: string },
  { state: LobbyState }
>("coilbox-multiplayer", "mp_snapshot");

/** A DM peer or channel thread in a saved chat log. `name` is the peer/channel. */
export interface ChatLogThread {
  kind: "dm" | "channel";
  name: string;
  messageCount: number;
  /** Latest message time, epoch-millis. */
  lastAt: number;
}

/** One account's saved chat logs. `account` is the (sanitized) log-file key. */
export interface ChatLogAccount {
  account: string;
  threads: ChatLogThread[];
}

/** List every saved chat log (DM + channel threads) across accounts. Reads disk,
 * so it works with no active connection. */
export const mpChatLogs = defineCommand<
  Record<string, never>,
  { accounts: ChatLogAccount[] }
>("coilbox-multiplayer", "mp_chat_logs");

/** Load one saved thread's messages (a DM peer or a channel). */
export const mpChatLogOpen = defineCommand<
  { account: string; kind: "dm" | "channel"; name: string },
  { messages: ChatMsg[] }
>("coilbox-multiplayer", "mp_chat_log_open");

/** Raw escape hatch: send an arbitrary wire line. */
export const mpSend = defineCommand<
  { serverKey: string; line: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_send");

export const mpSay = defineCommand<
  { serverKey: string; channel: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say");

export const mpSayPrivate = defineCommand<
  { serverKey: string; username: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say_private");

export const mpSayBattle = defineCommand<
  { serverKey: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say_battle");

/** `/me` action to a channel (SAYEX). */
export const mpSayEx = defineCommand<
  { serverKey: string; channel: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say_ex");

/** `/me` action to the current battle (SAYBATTLEEX). */
export const mpSayBattleEx = defineCommand<
  { serverKey: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say_battle_ex");

/** `/me` action in a private message (SAYPRIVATEEX). */
export const mpSayPrivateEx = defineCommand<
  { serverKey: string; username: string; message: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_say_private_ex");

export const mpJoinChannel = defineCommand<
  { serverKey: string; channel: string; key?: string | null },
  { sent: boolean }
>("coilbox-multiplayer", "mp_join_channel");

export const mpLeaveChannel = defineCommand<
  { serverKey: string; channel: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_leave_channel");

export const mpListChannels = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_list_channels");

/**
 * Ask the server to ignore a user (`IGNORE`), so it stops relaying their chat and
 * rings. Best-effort — servers without ignore support drop it and the client's
 * local hiding still applies.
 */
export const mpIgnore = defineCommand<
  { serverKey: string; username: string; reason?: string | null },
  { sent: boolean }
>("coilbox-multiplayer", "mp_ignore");

/** Ask the server to stop ignoring a user (`UNIGNORE`). */
export const mpUnignore = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_unignore");

/** Request the server's stored ignore list (`IGNORELIST`); arrives as a
 * `serverIgnoreList` delta once it finishes streaming. */
export const mpIgnoreList = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_ignore_list");

/** Send a friend request to `username` (optional message). */
export const mpFriendRequest = defineCommand<
  { serverKey: string; username: string; message?: string | null },
  { sent: boolean }
>("coilbox-multiplayer", "mp_friend_request");

/** Accept an incoming friend request from `username`. */
export const mpAcceptFriendRequest = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_accept_friend_request");

/** Decline an incoming friend request from `username`. */
export const mpDeclineFriendRequest = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_decline_friend_request");

/** Remove an existing friendship with `username`. */
export const mpUnfriend = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_unfriend");

/** Request the mutual-friend list (syncs `state.friends`); no-ops if unsupported. */
export const mpFriendList = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_friend_list");

/** Request pending incoming friend requests (syncs `state.friendRequests`). */
export const mpFriendRequestList = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_friend_request_list");

/** Tachyon only: start a party of your own. */
export const mpPartyCreate = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_create");

/** Tachyon only: leave the party you are in. */
export const mpPartyLeave = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_leave");

/** Tachyon only: ask `username` into your party. */
export const mpPartyInvite = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_invite");

/** Tachyon only: withdraw the invitation you sent `username`. */
export const mpPartyCancelInvite = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_cancel_invite");

/** Tachyon only: put `username` out of your party. */
export const mpPartyKickMember = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_kick_member");

/** Tachyon only: take up an invitation. A party has no name, so it is named by
 * the id `state.partyInvites` carries. */
export const mpPartyAcceptInvite = defineCommand<
  { serverKey: string; partyId: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_accept_invite");

/** Tachyon only: turn an invitation down. */
export const mpPartyDeclineInvite = defineCommand<
  { serverKey: string; partyId: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_party_decline_invite");

/** Tachyon only: fetch the queues on offer. The connection asks once as it comes
 * up, so this is the screen asking again. */
export const mpMatchmakingList = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_matchmaking_list");

/** Tachyon only: start searching in one queue. A party searches as one, so this
 * puts every member of yours in it. */
export const mpMatchmakingQueue = defineCommand<
  { serverKey: string; queueId: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_matchmaking_queue");

/** Tachyon only: accept the match the server has found. */
export const mpMatchmakingReady = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_matchmaking_ready");

/** Tachyon only: stop searching, or turn down a match that has been found. */
export const mpMatchmakingCancel = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_matchmaking_cancel");

export const mpJoinBattle = defineCommand<
  {
    serverKey: string;
    id: number;
    key?: string | null;
    scriptPassword?: string | null;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_join_battle");

export const mpJoinBattleDeny = defineCommand<
  { serverKey: string; username: string; reason?: string | null },
  { sent: boolean }
>("coilbox-multiplayer", "mp_join_battle_deny");

export const mpLeaveBattle = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_leave_battle");

export const mpSetStatus = defineCommand<
  { serverKey: string; ingame: boolean; away: boolean },
  { sent: boolean }
>("coilbox-multiplayer", "mp_set_status");

export const mpSetBattleStatus = defineCommand<
  {
    serverKey: string;
    ready: boolean;
    teamId: number;
    ally: number;
    mode: boolean;
    handicap: number;
    sync: number;
    side: number;
    color: number;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_set_battle_status");

export const mpOpenBattle = defineCommand<
  {
    serverKey: string;
    battleType: number;
    natType: number;
    key: string;
    port: number;
    maxPlayers: number;
    modhash: number;
    rank: number;
    maphash: number;
    engine: string;
    version: string;
    map: string;
    title: string;
    modname: string;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_open_battle");

/** The battle modes a Zero-K room can be opened in, as `mp_zerok_open_battle`
 * names them. Planet Wars is not one: the server runs that campaign itself. */
export type ZerokBattleMode = "custom" | "teams" | "1v1" | "ffa" | "coop";

/**
 * Zero-K only: ask the server to open a room founded in our name.
 *
 * The server runs every Zero-K match on its own machine, so this is not hosting
 * either, and it carries no port, no NAT mode and no content hash. The map is a
 * request the server resolves against its own content, and the game is not asked
 * for at all. Being the founder means the room's commands run for us without
 * going to a vote.
 */
export const mpZerokOpenBattle = defineCommand<
  {
    serverKey: string;
    title: string;
    map: string | null;
    mode: ZerokBattleMode;
    maxPlayers: number;
    password: string | null;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_zerok_open_battle");

/**
 * Tachyon only: create a lobby, which is a room the server owns and puts us in
 * as its first player. It is not hosting. Nothing runs on this machine until a
 * member starts the match and the server hands out an autohost's address, so
 * there is no port, no NAT mode and no content hash to send.
 */
export const mpCreateLobby = defineCommand<
  {
    serverKey: string;
    name: string;
    mapName: string;
    allyTeams: number;
    playersPerTeam: number;
    bossesEnabled: boolean;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_create_lobby");

/**
 * Ask for the match to begin. On Tachyon that is `lobby/startBattle`, which any
 * member may send. SPADS has no command for it, so on the line protocol it is
 * `!start` in battle chat for the autohost bot in the room to read.
 */
export const mpStartBattle = defineCommand<
  { serverKey: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_start_battle");

/**
 * Host: change the open battle's map, lock flag and advertised spectator count
 * (`UPDATEBATTLEINFO`). The four fields travel together, so resend the current
 * values for whatever isn't changing. `maphash` is the signed 32-bit map CRC.
 */
export const mpUpdateBattleInfo = defineCommand<
  {
    serverKey: string;
    spectators: number;
    locked: boolean;
    maphash: number;
    map: string;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_update_battle_info");

export const mpAddBot = defineCommand<
  {
    serverKey: string;
    name: string;
    ready: boolean;
    teamId: number;
    ally: number;
    mode: boolean;
    handicap: number;
    sync: number;
    side: number;
    color: number;
    aiDll: string;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_add_bot");

export const mpUpdateBot = defineCommand<
  {
    serverKey: string;
    name: string;
    ready: boolean;
    teamId: number;
    ally: number;
    mode: boolean;
    handicap: number;
    sync: number;
    side: number;
    color: number;
    /**
     * Change which AI the bot runs, keeping its seat. Tachyon only: the
     * TASServer protocol carries the AI on the add alone, so there the caller
     * removes the bot and adds it back instead.
     */
    aiDll?: string;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_update_bot");

export const mpRemoveBot = defineCommand<
  { serverKey: string; name: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_remove_bot");

export const mpForceTeam = defineCommand<
  { serverKey: string; username: string; team: number },
  { sent: boolean }
>("coilbox-multiplayer", "mp_force_team");

export const mpForceAlly = defineCommand<
  { serverKey: string; username: string; ally: number },
  { sent: boolean }
>("coilbox-multiplayer", "mp_force_ally");

export const mpForceColor = defineCommand<
  { serverKey: string; username: string; color: number },
  { sent: boolean }
>("coilbox-multiplayer", "mp_force_color");

export const mpForceSpectator = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_force_spectator");

export const mpKick = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_kick");

/** How a member votes, in the words `lobby/voteSubmit` uses. */
export type VoteChoice = "yes" | "no" | "abstain";

/**
 * Vote in the battle's open vote. Tachyon holds the vote itself, so this is
 * `lobby/voteSubmit`. SPADS has no command for it, so there it is `!vote` in
 * battle chat, which is what the scraper reads back.
 */
export const mpCastVote = defineCommand<
  { serverKey: string; choice: VoteChoice },
  { sent: boolean }
>("coilbox-multiplayer", "mp_cast_vote");

/** Tachyon only: make a member a boss, so they may change the lobby. */
export const mpAppointBoss = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_appoint_boss");

/** Tachyon only: stand a boss down. */
export const mpUnboss = defineCommand<
  { serverKey: string; username: string },
  { sent: boolean }
>("coilbox-multiplayer", "mp_unboss");

export const mpSetStartRect = defineCommand<
  {
    serverKey: string;
    ally: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  },
  { sent: boolean }
>("coilbox-multiplayer", "mp_set_start_rect");

export const mpRemoveStartRect = defineCommand<
  { serverKey: string; ally: number },
  { sent: boolean }
>("coilbox-multiplayer", "mp_remove_start_rect");

export const mpSetScriptTags = defineCommand<
  { serverKey: string; tags: Record<string, string> },
  { sent: boolean }
>("coilbox-multiplayer", "mp_set_script_tags");

export const mpRemoveScriptTags = defineCommand<
  { serverKey: string; tags: string[] },
  { sent: boolean }
>("coilbox-multiplayer", "mp_remove_script_tags");

/**
 * Map the current battle to a `play` `BattleConfig` ready to pass to `playLaunch`,
 * plus the host's declared NAT mode, which the engine's script has no slot for but
 * the launcher needs in order to warn about a host we cannot reach.
 */
export const mpBuildBattleConfig = defineCommand<
  { serverKey: string },
  { config: BattleConfig; natType: string }
>("coilbox-multiplayer", "mp_build_battle_config");

/**
 * Map the battle WE host into a host-mode `BattleConfig` (`isHost:true`, bound to
 * our assigned `HOSTPORT`, teams/allies renumbered contiguously). Errors if we are
 * not the founder of the current battle.
 */
export const mpBuildHostConfig = defineCommand<
  { serverKey: string },
  { config: BattleConfig }
>("coilbox-multiplayer", "mp_build_host_config");

/** What a single UDP probe found out about a battle host's game port. */
export type HostProbeOutcome = "unresolved" | "refused" | "silent" | "replied";

/**
 * Probe a battle host's game port with one empty datagram. Only `"refused"` and
 * `"unresolved"` are evidence of a problem. `"silent"` is what a perfectly
 * healthy host returns, because the engine answers unrecognised datagrams with
 * nothing, so it must never be reported as a failure.
 */
export const mpProbeHost = defineCommand<
  { host: string; port: number },
  { outcome: HostProbeOutcome }
>("coilbox-multiplayer", "mp_probe_host");
