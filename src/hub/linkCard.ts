/**
 * A preview card for a link to any site, fetched by the hub (issue #5436).
 *
 * `GET <hub>/api/v1/links/card?url=...`, from tomjn/coilbox-hub#655. The hub
 * fetches the linked page and its picture, so the site sees the hub and never
 * the address of a player reading the message. The format is in a comment on
 * tomjn/coilbox-hub#654.
 *
 * A webview fetch rather than a plugin command for the reasons
 * `./maps/lookup.ts` gives: no token, and the hub sends
 * `access-control-allow-origin: *`.
 *
 * ## What is remembered
 *
 * An answer is kept for the session, "no card" included, so the same link in
 * two messages, or a conversation opened twice, asks once. A failed request is
 * not kept, because it says nothing about the link, and the next message to show
 * that link asks again.
 */

import { isHubOrigin } from "./config";

/** A card as the hub answers it, with the picture already checked. */
export interface HubLinkCard {
  title: string;
  siteName: string;
  description: string | null;
  /** A picture on the hub, or null. Never an address on the linked site. */
  image: string | null;
}

/** The card endpoint under the configured base, concatenated so a hub served
 *  under a path prefix keeps its prefix. */
export function hubLinkCardUrl(base: string, href: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/links/card?url=${encodeURIComponent(href)}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The card in a `200` body, or null for `{"card": null}` and for anything
 * unreadable. `undefined` when the body is not the card endpoint's shape at all,
 * which the caller treats as a failure rather than an answer.
 *
 * A picture that is not on the hub is dropped. The hub only ever sends its own
 * proxy address, and checking costs nothing, where loading a picture from the
 * linked site would tell that site who is reading.
 */
export function readLinkCardBody(
  body: unknown,
  hubUrl: string,
): HubLinkCard | null | undefined {
  if (typeof body !== "object" || body === null || !("card" in body)) {
    return undefined;
  }
  const card = (body as { card: unknown }).card;
  if (typeof card !== "object" || card === null) return null;
  const one = card as Record<string, unknown>;
  const title = text(one.title);
  if (!title) return null;
  const image = text(one.image);
  return {
    title,
    siteName: text(one.site_name) ?? "",
    description: text(one.description),
    image: image && isHubOrigin(image, hubUrl) ? image : null,
  };
}

/** Answers, keyed on hub address and link. Null is an answer. */
const answered = new Map<string, HubLinkCard | null>();
/** Asks in flight, so a second message with the same link waits on the first. */
const asking = new Map<string, Promise<HubLinkCard | null>>();

/** The hub drops a link's `#fragment`, so links that differ only by one share
 *  an answer here too. */
function cacheKey(base: string, href: string): string {
  return `${base}\n${href.split("#")[0]}`;
}

/** The answer already held for this link, without asking. `undefined` when
 *  there is none yet. */
export function heldLinkCard(
  base: string,
  href: string,
): HubLinkCard | null | undefined {
  return answered.get(cacheKey(base, href));
}

/**
 * The hub's card for this link, or null when it has none, could not be reached,
 * or answered with something unreadable. Never rejects.
 */
export function hubLinkCard(
  base: string,
  href: string,
): Promise<HubLinkCard | null> {
  const key = cacheKey(base, href);
  if (answered.has(key)) return Promise.resolve(answered.get(key) ?? null);
  const already = asking.get(key);
  if (already) return already;

  const ask = (async () => {
    try {
      const response = await fetch(hubLinkCardUrl(base, href), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;
      const card = readLinkCardBody(await response.json(), base);
      if (card === undefined) return null;
      answered.set(key, card);
      return card;
    } catch {
      return null;
    } finally {
      asking.delete(key);
    }
  })();
  asking.set(key, ask);
  return ask;
}

/** Forget every answer. For tests. */
export function forgetLinkCards(): void {
  answered.clear();
  asking.clear();
}
