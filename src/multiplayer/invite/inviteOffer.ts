import { battleIdFrom, validLinkBattlePassword } from "../../deeplink/parse";
import {
  normaliseHostPort,
  normaliseServerAddress,
} from "../../lobby-servers/address";
import {
  type LastLogin,
  type LobbyAccount,
  type LobbyServer,
  serverProtocol,
  sortAccountsByRecency,
} from "../../lobby-servers/config";
import { addressOfKey } from "../../lobby-servers/hostForms";

/** A `coilbox://join` link, checked and in the form the rest of this reads. */
export interface InviteLink {
  host: string;
  port: number;
  /** `host:port` in the form it is compared and shown in. */
  address: string;
  battle: number;
  password?: string;
}

/** What this needs to know about one connection. */
export interface InviteConnection {
  serverKey: string;
  /** A room rather than a lobby server, which no invite link names. */
  direct: boolean;
  live: boolean;
  /** A connect is in flight. */
  opening: boolean;
  /** Logged in, with the battle list in hand. */
  ready: boolean;
  inBattle: boolean;
}

/**
 * `join`: already on the server, so the press only joins. `connect`: a saved
 * login for exactly this server, so the press connects with it and then joins.
 * `login`: a known server with no login that can connect in one press, so the
 * press opens the login screen for it. `unknown`: a server coilbox has no
 * entry for, which carries an address to show and nothing to connect with.
 *
 * `leavesKey` is the connection whose battle joining would leave.
 */
export type InviteOffer =
  | {
      kind: "join";
      address: string;
      serverName: string | null;
      serverKey: string;
      ready: boolean;
      leavesKey: string | null;
    }
  | {
      kind: "connect";
      address: string;
      server: LobbyServer;
      account: LobbyAccount;
      leavesKey: string | null;
    }
  | {
      kind: "login";
      address: string;
      server: LobbyServer;
      account: LobbyAccount | null;
    }
  | { kind: "unknown"; address: string; host: string; port: number };

export interface InviteIntent {
  link: InviteLink;
  liveAtStart: readonly string[];
  leavesKey: string | null;
}

export type IntentStep =
  | { kind: "wait" }
  | { kind: "ready"; serverKey: string }
  | { kind: "elsewhere"; serverKey: string };

/**
 * A parsed `join` link in the form the rest of this reads, or null when a
 * field is not what it has to be. Pure.
 *
 * `parseDeepLink` has made the same checks already. They are made again here
 * because this is the last stop before the fields are acted on, and a link
 * that reached it by some route other than the parser should be no better off.
 */
export function inviteLinkFrom(action: {
  server: string;
  battle: string;
  password?: string;
}): InviteLink | null {
  const address = normaliseServerAddress(action.server);
  const battle = battleIdFrom(action.battle);
  if (!address || !battle) return null;
  if (
    action.password !== undefined &&
    !validLinkBattlePassword(action.password)
  ) {
    return null;
  }
  return {
    ...address,
    battle: Number(battle),
    ...(action.password ? { password: action.password } : {}),
  };
}

/** Whether a connection is a lobby login at exactly the link's address. */
function isAt(connection: InviteConnection, link: InviteLink): boolean {
  if (connection.direct) return false;
  // Read through `addressOfKey` so a key built from a bare IPv6 host, which has
  // no brackets to tell its port by, reads as the server it names (issue #3407).
  const address = addressOfKey(connection.serverKey);
  return normaliseServerAddress(address)?.address === link.address;
}

/**
 * What coilbox offers somebody who followed an invite link (issue #3382). Pure.
 *
 * The link is written by whoever sent it, so nothing here is an action. Every
 * answer is something to put in front of the player with a button on it.
 *
 * A link names its server by address and by nothing else. It has no server
 * name and no server id, so the only way to be a known server is to have the
 * address of one, compared in the one form `address.ts` writes. A known
 * server is offered as the saved entry itself, and the connection is made from
 * that entry. Nothing in a link can change how a known server is dialled, TLS
 * included, because the link supplies none of it.
 *
 * A saved login is offered only for the entry it was saved against. Two
 * entries can share an address, say a copy of a TLS server with TLS turned
 * off, and a login stays with its own.
 */
export function inviteOffer(
  link: InviteLink,
  servers: LobbyServer[],
  accounts: LobbyAccount[],
  lastLogin: LastLogin | null,
  connections: InviteConnection[],
): InviteOffer {
  const { address } = link;
  const known = servers.filter(
    (s) => normaliseHostPort(s.host, s.port)?.address === address,
  );
  const open = connections.find((c) => isAt(c, link) && (c.live || c.opening));
  const leavesKey =
    connections.find(
      (c) => c.live && c.inBattle && c.serverKey !== open?.serverKey,
    )?.serverKey ?? null;

  if (open) {
    return {
      kind: "join",
      address,
      serverName: known[0]?.name ?? null,
      serverKey: open.serverKey,
      ready: open.live && open.ready,
      leavesKey,
    };
  }
  if (known.length === 0) {
    return { kind: "unknown", address, host: link.host, port: link.port };
  }

  const serverOf = (a: LobbyAccount) => known.find((s) => s.id === a.serverId);
  const mine = sortAccountsByRecency(accounts, lastLogin).filter(serverOf);
  // A login that can be connected with one press: a password is saved, or may
  // be, and no browser has to open. A Tachyon sign-in is left to the login
  // screen, which is the only place that opens a browser.
  const ready = mine.find((a) => {
    const server = serverOf(a);
    return (
      server != null &&
      serverProtocol(server) !== "tachyon" &&
      a.hasSecret !== false
    );
  });
  const readyServer = ready ? serverOf(ready) : undefined;
  if (ready && readyServer) {
    return {
      kind: "connect",
      address,
      server: readyServer,
      account: ready,
      leavesKey,
    };
  }
  const account = mine[0] ?? null;
  return {
    kind: "login",
    address,
    server: (account && serverOf(account)) ?? known[0],
    account,
  };
}

/**
 * The join an invite is waiting to make, held from the player's press until
 * the server is logged in to (issue #3382). `liveAtStart` is every lobby login
 * that was open at the press, so one opened since can be told apart.
 */
export function newIntent(
  link: InviteLink,
  connections: InviteConnection[],
  leavesKey: string | null,
): InviteIntent {
  return {
    link,
    liveAtStart: connections
      .filter((c) => c.live && !c.direct)
      .map((c) => c.serverKey),
    leavesKey,
  };
}

/**
 * What a waiting join should do now. Pure.
 *
 * It is bound to the address it was made for, so only a lobby login at exactly
 * that address finishes it. It is dropped when the player logs in to some
 * other server instead, because a join that fired later on a server they had
 * moved on from would be a surprise. A refused login leaves it waiting, where
 * the player can see it and try again or cancel.
 */
export function intentStep(
  intent: InviteIntent,
  connections: InviteConnection[],
): IntentStep {
  const here = connections.filter((c) => isAt(c, intent.link));
  const ready = here.find((c) => c.live && c.ready);
  if (ready) return { kind: "ready", serverKey: ready.serverKey };
  const elsewhere = connections.find(
    (c) =>
      c.live &&
      !c.direct &&
      !isAt(c, intent.link) &&
      !intent.liveAtStart.includes(c.serverKey),
  );
  if (elsewhere) return { kind: "elsewhere", serverKey: elsewhere.serverKey };
  return { kind: "wait" };
}
