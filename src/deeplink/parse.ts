/**
 * Pure parser for `coilbox://` deep links (issue #388). Turns an inbound URL
 * string into a strictly-typed action, or a typed rejection. No side effects and
 * no app state, so every branch is unit-testable directly.
 *
 * A deep link arrives from outside the app (a link in Discord or lobby chat), so
 * it is an untrusted input. This parser is the first gate: it validates the
 * shape and rejects anything malformed, unknown, or oversized before any handler
 * decides whether to act. The second gate, for import payloads, is `identify()`
 * in `../container/container.ts` (see `actions.ts`).
 *
 * Grammar (the action is the URL's authority, params are the query string):
 *
 *   coilbox://join?server=<host:port>&battle=<id>[&password=<pw>]
 *   coilbox://room?address=<host>&port=<port>
 *   coilbox://import?code=<container code>
 *   coilbox://import?url=<https url>
 *   coilbox://open?screen=<name>[&id=<id>]
 *
 * `open` screens are allow-listed. `map`, `game` and `replay` require an `id`.
 *
 * `join` and `room` are not the same thing. A `join` names a battle on a lobby
 * server, by the server's address, and the player is offered the way onto that
 * server if they are not on it (issue #3382). A `room` names a machine hosting a
 * room of its own with no server behind it (issue #1612), which has one battle in
 * it and no id worth putting in a link, so it carries the address and the port a
 * joiner would otherwise be reading out over voice chat.
 */

import {
  normaliseHostPort,
  normaliseServerAddress,
} from "../lobby-servers/address";
import type { LobbyProtocol } from "../lobby-servers/config";

/** The scheme every coilbox deep link must use. */
export const DEEP_LINK_SCHEME = "coilbox";

/**
 * Screens an `open` link may target, mapped to their in-app route. `:id` is
 * filled from the link's `id` param for the screens that need one.
 */
export const OPEN_SCREENS = {
  map: { route: "/library/maps/:id", needsId: true },
  game: { route: "/library/games/:id", needsId: true },
  replay: { route: "/play/replays/:id", needsId: true },
  conquest: { route: "/conquest", needsId: false },
  warpath: { route: "/warpath", needsId: false },
  battles: { route: "/battles", needsId: false },
  chat: { route: "/chat", needsId: false },
} as const;

export type OpenScreen = keyof typeof OPEN_SCREENS;

/** An oversized value is rejected rather than acted on. Deep-link URLs are short
 * by nature, so a very long one is a red flag, not a legitimate payload. */
export const MAX_CODE_LENGTH = 128 * 1024;
export const MAX_URL_LENGTH = 2048;
export const MAX_FIELD_LENGTH = 512;

export type DeepLinkAction =
  | { kind: "join"; server: string; battle: string; password?: string }
  | { kind: "room"; address: string; port: number }
  | { kind: "import"; source: ImportSource }
  | { kind: "open"; screen: OpenScreen; id?: string };

export type ImportSource =
  | { type: "code"; code: string }
  | { type: "url"; url: string };

export type DeepLinkParseError = { kind: "invalid"; reason: string };

export type DeepLinkParseResult = DeepLinkAction | DeepLinkParseError;

const invalid = (reason: string): DeepLinkParseError => ({
  kind: "invalid",
  reason,
});

/**
 * Parse a single `coilbox://` URL into a typed action. Never throws: any
 * malformed, unknown, or oversized input resolves to `{ kind: "invalid" }` with
 * a human-readable reason.
 */
export function parseDeepLink(raw: string): DeepLinkParseResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return invalid("Empty link.");
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return invalid("That is not a valid link.");
  }

  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return invalid("That is not a coilbox link.");
  }

  // The action is the URL's authority (host). `new URL` lowercases it, which
  // suits our lowercase action names.
  const action = url.hostname;
  const params = url.searchParams;

  switch (action) {
    case "join":
      return parseJoin(params);
    case "room":
      return parseRoom(params);
    case "import":
      return parseImport(params);
    case "open":
      return parseOpen(params);
    default:
      return invalid(`Unknown action "${action || "(none)"}".`);
  }
}

function field(params: URLSearchParams, name: string): string | null {
  const v = params.get(name);
  if (v === null) return null;
  const trimmed = v.trim();
  if (trimmed === "" || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

/** The largest battle id the join command holds, which is a `u32` in
 * `mp_join_battle`. */
const MAX_BATTLE_ID = 4294967295;

/**
 * A battle id as the one number it is, without leading zeros, or null when it
 * is anything but digits. Pure.
 */
export function battleIdFrom(raw: string): string | null {
  if (!/^[0-9]{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_BATTLE_ID ? String(id) : null;
}

/**
 * Whether a battle password can go in a link. Pure. A link does not know which
 * protocol its server speaks, and it must not be the one to say, so this only
 * checks size. The rule for the server's protocol is applied by
 * {@link battleKeyFor} when the join is made, against the saved server entry.
 */
export function validLinkBattlePassword(raw: string): boolean {
  return raw.length > 0 && raw.length <= MAX_FIELD_LENGTH;
}

/**
 * Whether a battle password can go in a TASServer join line. Pure. It is sent
 * as one word of `JOINBATTLE <id> <password> <scriptPassword>`, so a space would
 * make it two and a line break would make it a second command. Printable ASCII
 * is all it may hold.
 */
export function validBattlePassword(raw: string): boolean {
  return raw.length <= MAX_FIELD_LENGTH && /^[\x21-\x7e]+$/.test(raw);
}

/** What a form says when it refuses a password `validBattlePassword` rejects. */
export const BATTLE_PASSWORD_REFUSAL =
  "Coilbox cannot send this password. A battle password cannot contain a space, and only letters, numbers and punctuation from the basic keyboard are allowed.";

/**
 * Why a typed battle or room password cannot be sent, or null when it can.
 * Pure. A form trims the password before it sends it, so the edges are not
 * checked, and no password at all is an open battle. A Zero-K password is a
 * JSON string, so it has no character to refuse (issue #3524).
 */
export function battlePasswordProblem(
  typed: string,
  protocol: LobbyProtocol = "tasserver",
): string | null {
  if (protocol === "zerok") return null;
  const password = typed.trim();
  if (password === "" || validBattlePassword(password)) return null;
  return BATTLE_PASSWORD_REFUSAL;
}

/**
 * The password to send when joining a battle on a server speaking `protocol`,
 * or null when that protocol cannot carry it. Pure. An empty string is no
 * password.
 *
 * Zero-K takes any string and its host form trims the outer spaces, so a join
 * trims them too and both sides agree (issue #3524). Every other protocol keeps
 * the TASServer rule, untrimmed, as it always has been. The protocol has to come
 * from the saved server entry, never from a link.
 */
export function battleKeyFor(
  protocol: LobbyProtocol,
  raw: string,
): string | null {
  if (protocol === "zerok") return raw.trim();
  if (raw === "") return "";
  return validBattlePassword(raw) ? raw : null;
}

/**
 * A battle on a lobby server (issue #3382). Every field is checked for what it
 * has to be, not only for being there, because the server decides whether a
 * saved login is offered and the other two end up in a lobby command. The
 * server comes back in the form it is compared and shown in.
 */
function parseJoin(params: URLSearchParams): DeepLinkParseResult {
  const server = field(params, "server");
  const battle = field(params, "battle");
  if (!server) return invalid("This join link has no server.");
  if (!battle) return invalid("This join link has no battle.");
  const address = normaliseServerAddress(server);
  if (!address) {
    return invalid("This join link's server is not an address and a port.");
  }
  const id = battleIdFrom(battle);
  if (!id) return invalid("This join link's battle is not a battle number.");
  // Not trimmed, unlike the others. Whether a space is allowed depends on the
  // protocol of the server it is sent to, which is judged when the join is made.
  const password = params.get("password") ?? "";
  if (password !== "" && !validLinkBattlePassword(password)) {
    return invalid("This join link's password is not a battle password.");
  }
  return {
    kind: "join",
    server: address.address,
    battle: id,
    ...(password ? { password } : {}),
  };
}

/**
 * A room on somebody's machine, as an address and a port (issue #1612).
 *
 * The address goes through the same normaliser a `join` link's server does
 * (issue #3409), so what the dialog shows and what is dialled is one form, and
 * anything that could read as one host and dial another is refused: userinfo,
 * a path, an escape and every non-ASCII character. Whether a machine is
 * actually there is still the connection's answer. The port is its own field, so
 * an IPv6 address needs no brackets here, and comes back in them.
 */
function parseRoom(params: URLSearchParams): DeepLinkParseResult {
  const address = field(params, "address");
  const port = field(params, "port");
  if (!address) return invalid("This room link has no address.");
  if (!port) return invalid("This room link has no port.");
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return invalid("This room link's port is not a port.");
  }
  const normal = normaliseHostPort(address, Number(port));
  if (!normal) return invalid("This room link's address is not an address.");
  return { kind: "room", address: normal.host, port: normal.port };
}

function parseImport(params: URLSearchParams): DeepLinkParseResult {
  const code = params.get("code")?.trim() || null;
  const rawUrl = params.get("url")?.trim() || null;

  if (code && rawUrl) {
    return invalid("This import link has both a code and a URL.");
  }
  if (code) {
    if (code.length > MAX_CODE_LENGTH) {
      return invalid("This import link is too large.");
    }
    return { kind: "import", source: { type: "code", code } };
  }
  if (rawUrl) {
    if (rawUrl.length > MAX_URL_LENGTH) {
      return invalid("This import link is too large.");
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return invalid("This import link has an invalid URL.");
    }
    if (parsed.protocol !== "https:") {
      return invalid("Import URLs must be https.");
    }
    return { kind: "import", source: { type: "url", url: parsed.toString() } };
  }
  return invalid("This import link has no payload.");
}

/**
 * Whether an `open` link's id can be a name that is shown and looked up. Pure.
 * Maps, games and replays are named in every script, so only what cannot be a
 * name is refused: `.` and `..`, which are a way up a path, and control and
 * format characters, which are not shown or reorder the text around them.
 */
export function validOpenId(id: string): boolean {
  return id !== "." && id !== ".." && !/[\p{Cc}\p{Cf}]/u.test(id);
}

function parseOpen(params: URLSearchParams): DeepLinkParseResult {
  const screen = field(params, "screen");
  if (!screen) return invalid("This open link has no screen.");
  // An own name only: `in` also finds `constructor` and `toString`.
  if (!Object.hasOwn(OPEN_SCREENS, screen)) {
    return invalid(`Unknown screen "${screen}".`);
  }
  const key = screen as OpenScreen;
  if (!OPEN_SCREENS[key].needsId) return { kind: "open", screen: key };
  const id = field(params, "id");
  if (!id) return invalid(`Opening "${screen}" needs an id.`);
  if (!validOpenId(id)) return invalid(`This open link's id is not a name.`);
  return { kind: "open", screen: key, id };
}

/** Resolve an `open` action to its concrete in-app route, filling `:id`. */
export function openScreenRoute(action: {
  screen: OpenScreen;
  id?: string;
}): string {
  const { route } = OPEN_SCREENS[action.screen];
  if (action.id) return route.replace(":id", encodeURIComponent(action.id));
  return route;
}
