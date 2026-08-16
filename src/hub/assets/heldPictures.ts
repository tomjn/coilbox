/**
 * One question per screen rather than one per picture (issue #1687).
 *
 * `POST /api/v1/assets/pictures` takes up to 500 identities at a time, and the
 * screens that want it draw one map each: a card on the hub browser, the map in
 * a battle room, an item page. Every one of those asks on its own, so the batch
 * has to be assembled underneath them rather than by them.
 *
 * A caller asks for one identity and gets a promise. The ask is queued, and the
 * queue is flushed on a microtask, which puts every picture asked for while one
 * commit's effects run into a single request. React runs a commit's effects in
 * one task, so a screen of twenty four cards is one request and not twenty four.
 *
 * ## What is remembered, and what is not
 *
 * An answer is kept for the session, including "no picture", so the same map on
 * two screens is asked about once. Same lifetime as the BAR map index in
 * `src/downloads/config.ts` and for the same reason: neither is worth a second
 * request inside one sitting, and both are re-read on the next start.
 *
 * A failed request is not remembered. It says nothing about what the hub holds,
 * so remembering it would turn one bad moment on the network into a session with
 * no hub pictures in it.
 *
 * Answers are kept per hub address, so changing the hub in Settings does not
 * leave the old hub's paths on screen.
 */

import type { AssetIdentity } from "./have";
import type { HeldMapAsset } from "./picture";
import { type AssetPicture, fetchHubPictures } from "./pictures";

/** One identity as a string, so it can key a map. The same fields the hub keys a
 *  row on, in a shape neither key can collide across. */
export function identityKey(identity: AssetIdentity): string {
  return identity.keyed_on === "map"
    ? `map\n${identity.map_name}\n${identity.variant}`
    : `unit\n${identity.game}\n${identity.unit_name}\n${identity.variant}`;
}

/** Answers, keyed on hub address and identity. Null is an answer. */
const answered = new Map<string, AssetPicture | null>();

/** Asks that have not been answered yet, so a second caller for one identity
 *  waits on the first request rather than starting a second. */
const asking = new Map<string, Promise<AssetPicture | null>>();

interface Queued {
  base: string;
  cacheKey: string;
  identity: AssetIdentity;
  settle: (picture: AssetPicture | null) => void;
}

let queue: Queued[] = [];
let scheduled = false;

/**
 * What the hub holds for this identity, or null when it holds nothing it will
 * show, could not be reached, or answered with something unreadable.
 *
 * Never rejects. Every caller of this has a fallback that is what it would draw
 * for a map the hub has no picture of, so a failure is that same answer.
 */
export function heldPicture(
  base: string,
  identity: AssetIdentity,
): Promise<AssetPicture | null> {
  const cacheKey = `${base}\n${identityKey(identity)}`;

  if (answered.has(cacheKey)) {
    return Promise.resolve(answered.get(cacheKey) ?? null);
  }
  const already = asking.get(cacheKey);
  if (already) return already;

  const promise = new Promise<AssetPicture | null>((resolve) => {
    queue.push({ base, cacheKey, identity, settle: resolve });
  });
  asking.set(cacheKey, promise);

  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      void flush();
    });
  }
  return promise;
}

/** Send everything queued, one request per hub address per 500 keys. */
async function flush(): Promise<void> {
  scheduled = false;
  const sending = queue;
  queue = [];

  const byBase = new Map<string, Queued[]>();
  for (const ask of sending) {
    const group = byBase.get(ask.base);
    if (group) group.push(ask);
    else byBase.set(ask.base, [ask]);
  }

  for (const [base, group] of byBase) {
    const result = await fetchHubPictures(
      base,
      group.map((ask) => ask.identity),
    );
    group.forEach((ask, index) => {
      const picture = result.ok ? (result.pictures[index] ?? null) : null;
      // A failure is not an answer, so it is not remembered. Anything the hub
      // did say is, including that it has no picture.
      if (result.ok) answered.set(ask.cacheKey, picture);
      asking.delete(ask.cacheKey);
      ask.settle(picture);
    });
  }
}

/**
 * One answer as the picture ladder takes it, or null for no picture.
 *
 * The hub's own `url` is dropped rather than used. `./tier.ts` joins the path to
 * whichever durable base this session is configured with, and a distributor
 * serving assets from their own is the reason that override exists, so taking
 * the hub's URL would quietly ignore it.
 */
export function heldMapAsset(
  picture: AssetPicture | null,
): HeldMapAsset | null {
  if (!picture) return null;
  return {
    tier: picture.tier,
    path: picture.path,
    width: picture.width,
    height: picture.height,
  };
}

/** Forget every answer. For tests, which would otherwise see the hub answer once
 *  and every case after it read the first one's cache. */
export function forgetHeldPictures(): void {
  answered.clear();
  asking.clear();
  queue = [];
}
