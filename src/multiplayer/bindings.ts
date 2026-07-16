import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";
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
  host: string;
  ip: string;
  port: string;
  map: string;
  maphash: string;
  modname: string;
  engine: string;
  version: string;
  maxPlayers: number;
  passworded: boolean;
  locked: boolean;
  spectatorCount: number;
  title: string;
  channel: string | null;
  members: Record<string, MemberStatus>;
  bots: Record<string, Bot>;
  scriptTags: Record<string, string>;
  startRects: Record<string, StartRect>;
}

/**
 * A live SPADS autohost vote in the current battle (mirrors `Vote`). Present only
 * while a vote is open; drives the one-click vote panel.
 */
export interface Vote {
  subject: string;
  caller: string;
  yes: number;
  no: number;
  yesNeeded: number;
  noNeeded: number;
  allowAbstain: boolean;
  /** Unix-millis deadline from the progress line's "Ns remaining" (0 if unknown). */
  endsAt: number;
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
  /** A live SPADS autohost vote in the current battle, or null when none is open. */
  currentVote: Vote | null;
  /** Server-confirmed ignores (from `IGNORELIST` and IGNORE/UNIGNORE acks). The
   * local ignore list drives client-side hiding; this mirrors the server's set. */
  serverIgnores: string[];
  /** Mutual server-side friends, synced from `FRIENDLIST` (empty on unsupported servers). */
  friends: string[];
  /** Incoming pending friend requests awaiting accept/decline. */
  friendRequests: string[];
}

/** The phases of the login handshake (mirrors `LoginPhase`). */
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
  | "denied";

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
  | { kind: "friendRequestsChanged" };

/** An event streamed over the connect `Channel` (mirrors `LobbyEvent`). */
export type LobbyEvent =
  | { kind: "connected" }
  | { kind: "phase"; phase: LoginPhase; agreement: string | null }
  | { kind: "delta"; delta: Delta }
  | { kind: "console"; direction: "in" | "out"; line: string }
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
    tls: boolean;
    allowSelfSigned: boolean;
    username: string;
    password: string;
    compatFlags: string[];
    onEvent: Channel<LobbyEvent>;
  },
  { connected: boolean }
>("coilbox-multiplayer", "mp_connect");

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
    tls: boolean;
    allowSelfSigned: boolean;
    username: string;
    password: string;
    email: string | null;
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

/** Map the current battle to a `play` `BattleConfig` ready to pass to `playLaunch`. */
export const mpBuildBattleConfig = defineCommand<
  { serverKey: string },
  { config: BattleConfig }
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
