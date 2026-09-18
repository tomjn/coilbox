/**
 * The read half of the Coilbox Hub API (issue #1347), as the browse screen uses
 * it. Three routes, all anonymous: `/api/v1/items` lists and searches,
 * `/api/v1/items/{id}` adds the `container_url` an import needs, and
 * `/api/v1/games` lists every game the hub holds, with its ordered download
 * sources (issue #2951). The base address always comes from `useHubUrl()`
 * (see `./config`), never from a literal here.
 *
 * Two things the hub does deliberately, which this module has to honour:
 *
 * - An unrecognised query parameter, or a `kind` the gallery does not carry, is
 *   a 400 rather than a filter quietly not applying. So only the names in
 *   {@link HubFilters} are ever sent, and a filter is dropped from the query
 *   string when it is blank rather than sent empty.
 * - Every response carries `format` and `version`. A shipped desktop build sits
 *   on disk for months, so those are checked before anything else is read and a
 *   newer service is named as such instead of being rendered as nonsense.
 *
 * The fetch runs in the webview rather than through the Rust `dl_fetch_text`
 * command: the hub sends `access-control-allow-origin: *`, so CORS is not in the
 * way, and this is a plain read of a JSON API rather than the trust boundary
 * that route exists for. Importing an item still goes through the deep-link
 * handler and its two confirmations.
 */

import { containerKindName, containerKindPlural } from "@/container/names";

/** Response envelopes, from `lib/api/items.ts` in tomjn/coilbox-hub. */
const ITEMS_FORMAT = "coilbox-hub-items";
const ITEM_FORMAT = "coilbox-hub-item";
/** From `lib/api/gameList.ts` in tomjn/coilbox-hub. */
const GAMES_FORMAT = "coilbox-hub-games";

/** The API version this build was written against. A higher one is refused. */
export const HUB_API_VERSION = 1;

/**
 * Kinds the gallery carries, from `GALLERY_KINDS` in tomjn/coilbox-hub.
 * Campaigns are absent on purpose: they inline images and audio as data URIs and
 * blow past the import size ceiling.
 *
 * `blueprint` was here before the hub had it, and it had to be: the hub vendors
 * coilbox's container code pinned by blob hash, so the kind exists on this side
 * first and the hub builds on it afterwards (issue #1417, and
 * tomjn/coilbox-hub#84). Until that shipped, filtering by Blueprints asked the
 * hub for a kind it did not carry and got its 400 back, worded as the hub words
 * it. `mod-project` followed the same order: the kind waited here unlisted
 * until tomjn/coilbox-hub#323 taught the hub to accept it (issue #2727).
 */
export const HUB_KINDS = [
  "preset",
  "challenge",
  "setup-pack",
  "scenario",
  "blueprint",
  "mod-project",
] as const;

export type HubKind = (typeof HUB_KINDS)[number];

/** A row as the listing hands it out. The container itself is not on it. */
export interface HubItem {
  id: string;
  kind: HubKind;
  /** Only challenges have one: "conquest" or "warpath". */
  mode: string | null;
  title: string;
  description: string;
  game_name: string | null;
  /** The version-independent key the hub filters `game` by, e.g. "BA" or "SF".
   * Null when the hub could not derive one, which means no game filter can
   * ever reach this item (issue #2587). Never send `game_name` as a filter
   * value: it is a display string and the server matches nothing against it. */
  game_key: string | null;
  map_name: string | null;
  tags: string[];
  author_name: string;
  created_at: string;
}

/** An item fetched on its own, which adds where its container lives. */
export interface HubItemDetail extends HubItem {
  container_url: string;
}

/** One page of results, plus what the server says the whole set looks like. */
export interface HubItemsPage {
  page: number;
  pageSize: number;
  total: number;
  items: HubItem[];
}

/** How the hub orders a listing. `newest` is the default and what the hub has
 * always done, so it is left off the query string rather than sent explicitly
 * - the same "blank means don't send it" rule the other filters follow. */
export type HubSort = "newest" | "title";

/**
 * Everything the API will accept. Anything else is a 400, so this list is the
 * whole of it: there is no room for a client-side filter the server has not been
 * told about.
 *
 * `kind`, `author` and `tag` take several values, sent as a repeated query
 * parameter and OR'd together by the hub (e.g. `kind=preset&kind=blueprint`).
 * `game`, `map`, `q` and `sort` take exactly one: the hub 400s on a second
 * `game` or `sort`, worded as "game takes one value, not several", so these
 * stay plain strings rather than arrays and there is no way to construct a
 * request that repeats one.
 */
export interface HubFilters {
  /** Zero or more of {@link HUB_KINDS}. Typed as `string[]` rather than
   * `HubKind[]` because an unknown kind is the server's 400 to give, not
   * something to model here. */
  kind?: string[];
  game?: string;
  map?: string;
  tag?: string[];
  author?: string[];
  q?: string;
  sort?: HubSort;
  page?: number;
}

/** Either a value or a sentence meant to be shown to the reader as-is. */
export type HubResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** The filters that take exactly one value, in the order they go on the query
 * string. */
const TEXT_FILTERS = ["game", "map", "q"] as const;

/** The filters that take several values, sent as a repeated parameter. */
const MULTI_FILTERS = ["kind", "author", "tag"] as const;

/**
 * Join a path onto the configured base. Concatenated rather than resolved
 * against the origin, so a hub served under a path prefix works - the same thing
 * `ChallengeCodeView` does with `/publish`.
 */
function hubUrl(base: string, path: string): URL {
  return new URL(`${base.replace(/\/+$/, "")}${path}`);
}

/** Build a listing URL. Blank filters are left off entirely. */
export function hubItemsUrl(base: string, filters: HubFilters = {}): string {
  const url = hubUrl(base, "/api/v1/items");
  for (const key of TEXT_FILTERS) {
    const value = filters[key]?.trim();
    if (value) url.searchParams.set(key, value);
  }
  for (const key of MULTI_FILTERS) {
    for (const value of filters[key] ?? []) {
      const trimmed = value.trim();
      if (trimmed) url.searchParams.append(key, trimmed);
    }
  }
  if (filters.sort) url.searchParams.set("sort", filters.sort);
  if (filters.page && filters.page > 1) {
    url.searchParams.set("page", String(filters.page));
  }
  return url.toString();
}

/** Build the URL of a single item. */
export function hubItemUrl(base: string, id: string): string {
  return hubUrl(base, `/api/v1/items/${encodeURIComponent(id)}`).toString();
}

/** The `{"error": "..."}` an unhappy response carries, when it has one.
 * Exported for `./publish`, which reads the same errors off the write route. */
export function serverError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

/**
 * A hub that is up but cannot read its database. The service sits on a free tier
 * that pauses after a week without traffic, and waking it is the most likely
 * reason a read fails, so say so rather than leaving a bare 503 to be guessed at.
 */
export const COLD_START =
  "The hub may be waking up after a quiet spell, which takes a few seconds. Try again in a moment.";

/** Turn a non-2xx response into a sentence. */
function statusMessage(status: number, body: unknown): string {
  const said = serverError(body);
  if (status >= 500)
    return `${said ?? "The hub could not answer."} ${COLD_START}`;
  if (status === 404)
    return "The hub has no such item. It may have been taken down.";
  return said ?? `The hub refused that request (HTTP ${status}).`;
}

/** Check the envelope both routes share, before any field is read. */
function readEnvelope(
  body: unknown,
  format: string,
): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      reason: "The hub sent something coilbox could not read.",
    };
  }
  const shape = body as Record<string, unknown>;
  if (shape.format !== format) {
    return {
      ok: false,
      reason:
        "That address answered, but it is not a coilbox hub. Check the hub address in Settings.",
    };
  }
  if (typeof shape.version !== "number" || shape.version > HUB_API_VERSION) {
    return {
      ok: false,
      reason:
        "This hub is newer than this copy of coilbox understands. Update coilbox to browse it.",
    };
  }
  return { ok: true, body: shape };
}

/** Read a listing response that already came back 2xx. */
export function readItemsBody(body: unknown): HubResult<HubItemsPage> {
  const envelope = readEnvelope(body, ITEMS_FORMAT);
  if (!envelope.ok) return { ok: false, reason: envelope.reason };
  const { items, page, page_size, total } = envelope.body;
  if (!Array.isArray(items)) {
    return { ok: false, reason: "The hub sent a listing with no items in it." };
  }
  return {
    ok: true,
    value: {
      page: typeof page === "number" ? page : 1,
      pageSize: typeof page_size === "number" ? page_size : items.length,
      total: typeof total === "number" ? total : items.length,
      items: items as HubItem[],
    },
  };
}

/** Read a single-item response that already came back 2xx. */
export function readItemBody(body: unknown): HubResult<HubItemDetail> {
  const envelope = readEnvelope(body, ITEM_FORMAT);
  if (!envelope.ok) return { ok: false, reason: envelope.reason };
  const item = envelope.body.item as HubItemDetail | undefined;
  if (!item || typeof item.container_url !== "string") {
    return {
      ok: false,
      reason: "The hub gave no address for that item's contents.",
    };
  }
  return { ok: true, value: item };
}

/** GET a URL and hand its JSON to `read`, turning every failure into a sentence. */
async function getJson<T>(
  url: string,
  read: (body: unknown) => HubResult<T>,
  signal?: AbortSignal,
): Promise<HubResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    // A DNS failure, no route, or a refused connection. The host is worth naming
    // because it can be overridden, and it is often not the default one.
    return {
      ok: false,
      reason: `Could not reach the hub at ${hostOf(url)}. Check your connection. ${COLD_START}`,
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) {
      return {
        ok: false,
        reason: "The hub sent something coilbox could not read.",
      };
    }
  }

  if (!response.ok) {
    return { ok: false, reason: statusMessage(response.status, body) };
  }
  return read(body);
}

/** The host of a URL, for a message, or the URL itself if it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Fetch one page of the gallery. Never throws. */
export function fetchHubItems(
  base: string,
  filters: HubFilters,
  signal?: AbortSignal,
): Promise<HubResult<HubItemsPage>> {
  return getJson(hubItemsUrl(base, filters), readItemsBody, signal);
}

/** Fetch one item, for its `container_url`. Never throws. */
export function fetchHubItem(
  base: string,
  id: string,
  signal?: AbortSignal,
): Promise<HubResult<HubItemDetail>> {
  return getJson(hubItemUrl(base, id), readItemBody, signal);
}

/**
 * One way to fetch a game, as the hub's `GameDownload` holds it. `value` is a
 * rapid tag, a direct address, or an `owner/repo` GitHub path depending on
 * `kind`. `asset` (github only) is a fragment of the release archive's
 * filename to pick. `filename` (url only) is what to save the download as.
 * See `hubGameDownloadRequest` in `./games/download` for how these turn into
 * an actual download.
 */
export interface HubGameDownload {
  kind: "rapid" | "url" | "github";
  value: string;
  asset?: string;
  filename?: string;
}

/**
 * A game as `GET /api/v1/games` lists it (issue #2951). `downloads` is best
 * source first - the caller is expected to try the next one when a source
 * comes up empty, never to stop at the first entry.
 *
 * `logo`/`card` can be a root-relative path (e.g. `/assets/games/...`) rather
 * than a full address, since the hub does not know its own public origin for a
 * picture still waiting for promotion. A caller that wants to show one has to
 * resolve it against the hub host it just called.
 */
export interface HubGame {
  shortname: string;
  title: string;
  description: string | null;
  featured: boolean;
  downloads: HubGameDownload[];
  logo: string | null;
  card: string | null;
  faction_count: number;
  unit_count: number;
  item_count: number;
}

/** Build the games listing URL. */
export function hubGamesUrl(base: string): string {
  return hubUrl(base, "/api/v1/games").toString();
}

/** Read a games-listing response that already came back 2xx. */
export function readGamesBody(body: unknown): HubResult<HubGame[]> {
  const envelope = readEnvelope(body, GAMES_FORMAT);
  if (!envelope.ok) return { ok: false, reason: envelope.reason };
  const { games } = envelope.body;
  if (!Array.isArray(games)) {
    return {
      ok: false,
      reason: "The hub sent a games list with no games in it.",
    };
  }
  return { ok: true, value: games as HubGame[] };
}

/**
 * Fetch every game the hub holds. Never throws.
 *
 * The hub deliberately answers 503 rather than an empty list when its own
 * catalog read fails, because an empty list is a claim ("the hub holds no
 * games") the hub could not actually make. `getJson` already turns a 5xx into
 * the same cold-start sentence `fetchHubItems` gives, so that distinction
 * reaches the caller unchanged. A 503 becomes a reason to show, never an
 * empty `HubGame[]`.
 */
export function fetchHubGames(
  base: string,
  signal?: AbortSignal,
): Promise<HubResult<HubGame[]>> {
  return getJson(hubGamesUrl(base), readGamesBody, signal);
}

/**
 * What a filter chip calls a kind, in the plural.
 *
 * The words come from {@link containerKindPlural} (issue #1795), so a chip
 * offers a thing under the name the rest of coilbox gives it. The hub used to
 * keep its own shorter set here, saying Presets and Blueprints where a card's
 * badge beside it said Singleplayer preset and Base blueprint. That was not a
 * choice about wording: the chips shared a row with the search box and the two
 * comboboxes, and the row could not afford the longer words at any width it was
 * given. The chips have a row of their own now, so it can.
 */
export function kindLabelPlural(kind: HubKind): string {
  return opened(containerKindPlural(kind));
}

/**
 * What the hub carries, to open a sentence with: "Singleplayer presets,
 * challenges, setup packs, scenarios and base blueprints".
 *
 * Built from {@link HUB_KINDS} rather than written out (issue #1502). The hand
 * written version of this sentence sat directly above a row of filter chips
 * that had grown a fifth kind, saying the hub carried four, for as long as it
 * took somebody to notice.
 *
 * The labels are written to start a sentence, so every one after the first is
 * lowered.
 */
export function kindsPlural(): string {
  const [first, ...rest] = HUB_KINDS.map(kindLabelPlural);
  const said = rest.map((l) => l.charAt(0).toLowerCase() + l.slice(1));
  const last = said.pop();
  return last === undefined
    ? first
    : `${[first, ...said].join(", ")} and ${last}`;
}

/** A label to start with a capital, since a badge is not part of a sentence. */
function opened(label: string): string {
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/**
 * What a card calls an item. A challenge's `mode` says which of the two it is,
 * which is the difference between a galactic conquest and a warpath run and
 * worth more to a reader than the word "challenge" on its own.
 *
 * The words come from {@link containerKindName} (issue #1520), so a badge calls
 * a thing what the rest of coilbox calls it: a Singleplayer preset rather than a
 * Preset, a Base blueprint rather than a Blueprint. The hub's own copy of these
 * names said neither, and was the only place in the app that did.
 *
 * A listing is read without checking each row's kind, so a hub carrying a kind
 * this build has never heard of reaches here as a string with no name. Fall back
 * to the kind itself: an ugly badge beats a card that throws.
 */
export function describeItem(kind: HubKind, mode: string | null): string {
  if (kind === "challenge" && mode) {
    return `${opened(mode)} challenge`;
  }
  const name: string | undefined = containerKindName(kind);
  return opened(name ?? kind);
}
