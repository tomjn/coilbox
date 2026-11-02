import { type Inline, parseMessage } from "./parseMessage";

/** What a chat card shows for a link to a known site. */
export interface LinkCardInfo {
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

/** One entry per known site. Returns null for a URL that is not the site's. */
type Resolver = (url: URL, href: string) => LinkCardInfo | null;

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

/** The known sites. A new site is one more resolver here. */
const RESOLVERS: readonly Resolver[] = [youtube];

/** The most cards one message gets, so a pasted list of links does not become
 * a wall of pictures, each one a request to a third party. */
const MAX_CARDS_PER_MESSAGE = 1;

/** The card for one link, or null when it is not a known site's. */
export function linkCardFor(href: string): LinkCardInfo | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const resolve of RESOLVERS) {
    const card = resolve(url, href);
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
 * The cards to show under a message, in the order their links appear. Reads the
 * same `url` tokens the message body links from, so a link inside a code span
 * or a code block, which the parser leaves as literal text, gets no card.
 */
export function linkCardsIn(text: string): LinkCardInfo[] {
  const urls: string[] = [];
  collectUrls(parseMessage(text), urls);
  const cards: LinkCardInfo[] = [];
  const seen = new Set<string>();
  for (const href of urls) {
    if (seen.has(href)) continue;
    seen.add(href);
    const card = linkCardFor(href);
    if (card) cards.push(card);
    if (cards.length >= MAX_CARDS_PER_MESSAGE) break;
  }
  return cards;
}
