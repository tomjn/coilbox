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

import { normaliseServerAddress } from "../lobby-servers/address";

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
 * Whether a battle password can go in a link. Pure. It is sent as one word of
 * `JOINBATTLE <id> <password> <scriptPassword>`, so a space would make it two
 * and a line break would make it a second command. Printable ASCII is all it
 * may hold.
 */
export function validBattlePassword(raw: string): boolean {
  return raw.length <= MAX_FIELD_LENGTH && /^[\x21-\x7e]+$/.test(raw);
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
  // Not trimmed, unlike the others. A password with a space in it is refused
  // rather than turned into a different password.
  const password = params.get("password") ?? "";
  if (password !== "" && !validBattlePassword(password)) {
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
 * The address is only checked for the shapes that could not possibly be one, the
 * same test a typed address gets in `direct/lan.ts`: whether a machine is
 * actually there is the connection's answer, and refusing here would refuse
 * hostnames that resolve perfectly well. The port is checked properly, because a
 * link with a port outside the range is a link that could never have worked.
 */
function parseRoom(params: URLSearchParams): DeepLinkParseResult {
  const address = field(params, "address");
  const port = field(params, "port");
  if (!address) return invalid("This room link has no address.");
  if (!port) return invalid("This room link has no port.");
  if (/\s/.test(address) || address.includes("/")) {
    return invalid("This room link's address is not an address.");
  }
  if (!/^\d+$/.test(port))
    return invalid("This room link's port is not a port.");
  const number = Number(port);
  if (number < 1 || number > 65535) {
    return invalid("This room link's port is not a port.");
  }
  return { kind: "room", address, port: number };
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

function parseOpen(params: URLSearchParams): DeepLinkParseResult {
  const screen = field(params, "screen");
  if (!screen) return invalid("This open link has no screen.");
  if (!(screen in OPEN_SCREENS)) {
    return invalid(`Unknown screen "${screen}".`);
  }
  const key = screen as OpenScreen;
  const id = field(params, "id");
  if (OPEN_SCREENS[key].needsId && !id) {
    return invalid(`Opening "${screen}" needs an id.`);
  }
  return { kind: "open", screen: key, ...(id ? { id } : {}) };
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
