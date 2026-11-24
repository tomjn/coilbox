import { splitMapName } from "@/content/mapVersions";
import { parseDeepLink } from "@/deeplink/parse";
import { isHubOrigin } from "@/hub/config";
import { type Inline, parseMessage } from "./parseMessage";

/** What a chat card shows for a link to a known site. */
export interface SiteLinkCard {
  /** The site's name as it writes it. A brand, so it is not translated. */
  site: string;
  /** The link as the sender typed it. Opening it goes through the OS browser. */
  url: string;
  /**
   * A picture built from the link alone, or null when the site has none that
   * can be built without asking it. Loading it contacts the site, so a site goes
   * on the list only if that contact is one a player would accept.
   */
  thumbnail: string | null;
}

/**
 * Which map a link means. A coilbox link says the map's exact name. A web page
 * says only a slug, which has to be matched against the names this machine knows
 * (see {@link mapNameForSlug}).
 */
export type MapLinkTarget =
  | { kind: "name"; name: string }
  | {
      kind: "slug";
      slug: string;
      /** The site's slug leaves the version out, so any version of the map fits. */
      anyVersion: boolean;
    };

/**
 * A chat card for a link to a map. It has no fixed picture, because a map's
 * picture comes from the hub by name once the name is known (issue #286).
 */
export interface MapLinkCard {
  site: string;
  url: string;
  map: MapLinkTarget;
}

/** A chat card that is an animation the site serves, drawn in place. */
export interface AnimationLinkCard {
  site: string;
  url: string;
  /** The animation, built from the link alone. Loading it contacts the site. */
  animation: string;
}

export type LinkCardInfo = SiteLinkCard | MapLinkCard | AnimationLinkCard;

/** One entry per known site. Returns null for a URL that is not the site's. */
type Resolver = (
  url: URL,
  href: string,
  hubUrl: string | null,
) => LinkCardInfo | null;

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

/**
 * YouTube: `watch?v=`, `youtu.be/`, `/shorts/`, `/live/` and `/embed/`. The
 * thumbnail is `i.ytimg.com`'s fixed-path picture, which needs no API call.
 */
const youtube: Resolver = (url, href) => {
  let id: string | null = null;
  if (url.hostname === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const [, kind, rest] = url.pathname.split("/");
    if (kind === "watch") id = url.searchParams.get("v");
    else if (kind === "shorts" || kind === "live" || kind === "embed") {
      id = rest ?? null;
    }
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return {
    site: "YouTube",
    url: href,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
};

/** The one path segment after `prefix`, decoded, or null if the path is not that. */
function segmentAfter(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).replace(/\/$/, "");
  if (!segment || segment.includes("/")) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** A map page on the hub this session trusts: `<hub>/map/<slug>`. */
const hubMapPage: Resolver = (url, href, hubUrl) => {
  if (!hubUrl || !isHubOrigin(href, hubUrl)) return null;
  const base = new URL(hubUrl).pathname.replace(/\/+$/, "");
  const slug = segmentAfter(url.pathname, `${base}/map/`);
  if (!slug) return null;
  return {
    site: "Coilbox Hub",
    url: href,
    map: { kind: "slug", slug, anyVersion: false },
  };
};

const BAR_HOSTS = new Set(["beyondallreason.info", "www.beyondallreason.info"]);

/**
 * A map page on Beyond All Reason's site: `/map/supreme-isthmus`. It is only
 * recognised. Nothing is fetched from BAR, because coilbox stopped using
 * BAR-hosted content (#1728).
 */
const barMapPage: Resolver = (url, href) => {
  if (!BAR_HOSTS.has(url.hostname)) return null;
  const slug = segmentAfter(url.pathname, "/map/");
  if (!slug) return null;
  return {
    site: "Beyond All Reason",
    url: href,
    map: { kind: "slug", slug: slug.toLowerCase(), anyVersion: true },
  };
};

const GIPHY_ID = /^[A-Za-z0-9]+$/;
const GIPHY_PAGE_HOSTS = new Set(["giphy.com", "www.giphy.com"]);
const GIPHY_MEDIA_HOST = /^(media\d?|i)\.giphy\.com$/;

/** The GIF's id in a Giphy link, or null for a link that does not carry one. */
function giphyId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (GIPHY_PAGE_HOSTS.has(url.hostname)) {
    // `/gifs/<slug>-<id>`, `/gifs/<id>`, `/stickers/...` and `/embed/<id>`.
    const [kind, page] = parts;
    if (parts.length !== 2) return null;
    if (kind === "embed") return page;
    if (kind === "gifs" || kind === "stickers") {
      return page.slice(page.lastIndexOf("-") + 1);
    }
    return null;
  }
  if (GIPHY_MEDIA_HOST.test(url.hostname)) {
    // `/media/<id>/<file>`, or with a `v1.` segment before the id.
    if (parts[0] === "media" && parts.length >= 3) return parts.at(-2) ?? null;
    // `i.giphy.com/<id>.gif`.
    if (url.hostname === "i.giphy.com" && parts.length === 1) {
      return parts[0].replace(/\.(gif|webp)$/, "");
    }
  }
  return null;
}

/**
 * Giphy: every link to a GIF names it, and Giphy serves each one at a fixed
 * height of 200 pixels as `200.webp`, so the animation needs no lookup and
 * not the hub. Loading it contacts Giphy, as YouTube's thumbnail contacts
 * YouTube. A `gph.is` short link names nothing, so it is left to the hub.
 */
const giphy: Resolver = (url, href) => {
  const id = giphyId(url);
  if (!id || !GIPHY_ID.test(id)) return null;
  return {
    site: "GIPHY",
    url: href,
    animation: `https://media.giphy.com/media/${id}/200.webp`,
  };
};

/** The known sites. A new site is one more resolver here. */
const RESOLVERS: readonly Resolver[] = [youtube, giphy, hubMapPage, barMapPage];

/**
 * A map as the hub writes it in a URL. The same rule as `mapSlug` in
 * `lib/maps/slug.ts` in tomjn/coilbox-hub, which is what a hub link is matched
 * on. A map that had to take the hub's longer slug because another map held this
 * one does not match, and its card stays unresolved.
 */
const MAX_SLUG_BASE = 240;
export function mapSlug(mapName: string): string {
  const slug = mapName
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "map";
}

/**
 * The name a slug means among these names, or null when none fits. An exact match
 * wins. Failing that, where the slug has no version, the newest version of the
 * map named in `names`.
 */
export function mapNameForSlug(
  target: Extract<MapLinkTarget, { kind: "slug" }>,
  names: readonly string[],
): string | null {
  const exact = names.find((name) => mapSlug(name) === target.slug);
  if (exact !== undefined) return exact;
  if (!target.anyVersion) return null;
  const versions = names.filter(
    (name) => mapSlug(splitMapName(name).base) === target.slug,
  );
  const newestFirst = [...versions].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  return newestFirst[0] ?? null;
}

/** The most cards one message gets, so a pasted list of links does not become
 * a wall of pictures, each one a request to a third party. */
const MAX_CARDS_PER_MESSAGE = 1;

/** The card for one link, or null when it is not a known site's. */
export function linkCardFor(
  href: string,
  hubUrl: string | null = null,
): LinkCardInfo | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === "coilbox:") {
    const action = parseDeepLink(href);
    if (action.kind !== "open" || action.screen !== "map" || !action.id) {
      return null;
    }
    return {
      site: "Coilbox",
      url: href,
      map: { kind: "name", name: action.id },
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const resolve of RESOLVERS) {
    const card = resolve(url, href, hubUrl);
    if (card) return card;
  }
  return null;
}

function collectUrls(nodes: Inline[], out: string[]): void {
  for (const n of nodes) {
    if (n.type === "url") out.push(n.value);
    else if (n.type === "quote") collectUrls(n.children, out);
    else if (n.type === "list") {
      for (const item of n.items) collectUrls(item, out);
    }
  }
}

/**
 * The message's first `http` or `https` link, or null. A message with no card
 * from a known site asks the hub for this one's (issue #5436).
 */
export function firstWebLink(text: string): string | null {
  const urls: string[] = [];
  collectUrls(parseMessage(text), urls);
  return urls.find(isWebLink) ?? null;
}

function isWebLink(href: string): boolean {
  try {
    const { protocol } = new URL(href);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The cards to show under a message, in the order their links appear. Reads the
 * same `url` tokens the message body links from, so a link inside a code span
 * or a code block, which the parser leaves as literal text, gets no card.
 */
export function linkCardsIn(
  text: string,
  hubUrl: string | null = null,
): LinkCardInfo[] {
  const urls: string[] = [];
  collectUrls(parseMessage(text), urls);
  const cards: LinkCardInfo[] = [];
  const seen = new Set<string>();
  for (const href of urls) {
    if (seen.has(href)) continue;
    seen.add(href);
    const card = linkCardFor(href, hubUrl);
    if (card) cards.push(card);
    if (cards.length >= MAX_CARDS_PER_MESSAGE) break;
  }
  return cards;
}
