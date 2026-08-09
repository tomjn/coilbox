/**
 * The read half of the Coilbox Hub API (issue #1347), as the browse screen uses
 * it. Two routes, both anonymous: `/api/v1/items` lists and searches, and
 * `/api/v1/items/{id}` adds the `container_url` an import needs. The base
 * address always comes from `useHubUrl()` (see `./config`), never from a
 * literal here.
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

/** Response envelopes, from `lib/api/items.ts` in tomjn/coilbox-hub. */
const ITEMS_FORMAT = "coilbox-hub-items";
const ITEM_FORMAT = "coilbox-hub-item";

/** The API version this build was written against. A higher one is refused. */
export const HUB_API_VERSION = 1;

/**
 * Kinds the gallery carries, from `GALLERY_KINDS` in tomjn/coilbox-hub.
 * Campaigns are absent on purpose: they inline images and audio as data URIs and
 * blow past the import size ceiling.
 */
export const HUB_KINDS = [
  "preset",
  "challenge",
  "setup-pack",
  "scenario",
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

/**
 * Everything the API will accept. Anything else is a 400, so this list is the
 * whole of it: there is no room for a client-side filter the server has not been
 * told about.
 */
export interface HubFilters {
  /** One of {@link HUB_KINDS}, or blank for all of them. Typed loosely because
   * an unknown kind is the server's 400 to give, not something to model here. */
  kind?: string;
  game?: string;
  map?: string;
  tag?: string;
  author?: string;
  q?: string;
  page?: number;
}

/** Either a value or a sentence meant to be shown to the reader as-is. */
export type HubResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** The filters that are plain strings, in the order they go on the query string. */
const TEXT_FILTERS = ["kind", "game", "map", "tag", "author", "q"] as const;

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
  if (filters.page && filters.page > 1) {
    url.searchParams.set("page", String(filters.page));
  }
  return url.toString();
}

/** Build the URL of a single item. */
export function hubItemUrl(base: string, id: string): string {
  return hubUrl(base, `/api/v1/items/${encodeURIComponent(id)}`).toString();
}

/** The `{"error": "..."}` an unhappy response carries, when it has one. */
function serverError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  return typeof error === "string" && error.trim() ? error.trim() : null;
}

/**
 * A hub that is up but cannot read its database. The service sits on a free tier
 * that pauses after a week without traffic, and waking it is the most likely
 * reason a read fails, so say so rather than leaving a bare 503 to be guessed at.
 */
const COLD_START =
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

/** Plural kind names, for the filter chips. */
const KIND_PLURAL: Record<HubKind, string> = {
  preset: "Presets",
  challenge: "Challenges",
  "setup-pack": "Setup packs",
  scenario: "Scenarios",
};

export function kindLabelPlural(kind: HubKind): string {
  return KIND_PLURAL[kind];
}

/** Singular kind names, for a card's badge. */
const KIND_SINGULAR: Record<HubKind, string> = {
  preset: "Preset",
  challenge: "Challenge",
  "setup-pack": "Setup pack",
  scenario: "Scenario",
};

/**
 * What a card calls an item. A challenge's `mode` says which of the two it is,
 * which is the difference between a galactic conquest and a warpath run and
 * worth more to a reader than the word "challenge" on its own.
 */
export function describeItem(kind: HubKind, mode: string | null): string {
  const label = KIND_SINGULAR[kind] ?? kind;
  if (kind === "challenge" && mode) {
    return `${mode.charAt(0).toUpperCase()}${mode.slice(1)} challenge`;
  }
  return label;
}
