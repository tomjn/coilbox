/**
 * One question per screen rather than one per map (issue #1738).
 *
 * The same shape as `../assets/heldPictures.ts`, and for the same reason: the
 * screens that want a map's facts draw one map each, so the batch has to be
 * assembled underneath them rather than by them. A caller asks about one name
 * and gets a promise, the ask is queued, and the queue flushes on a microtask,
 * which puts every name asked for while one commit's effects run into a single
 * request. A lobby listing twenty maps is one request and not twenty.
 *
 * ## What is remembered, and what is not
 *
 * An answer is kept for the session, including "the hub has never heard of it",
 * so the same map on two screens is asked about once.
 *
 * A failed request is not remembered. It says nothing about what the hub knows,
 * so remembering it would turn one bad moment on the network into a session with
 * no map facts in it.
 *
 * Answers are kept per hub address, so changing the hub in Settings does not
 * leave the old hub's answers on screen.
 */

import { fetchMapFacts, type MapFacts } from "./lookup";

/** Answers, keyed on hub address and map name. Null is an answer. */
const answered = new Map<string, MapFacts | null>();

/** Asks that have not been answered yet, so a second caller for one name waits
 *  on the first request rather than starting a second. */
const asking = new Map<string, Promise<MapFacts | null>>();

interface Queued {
  base: string;
  cacheKey: string;
  mapName: string;
  settle: (facts: MapFacts | null) => void;
}

let queue: Queued[] = [];
let scheduled = false;

/**
 * What the hub knows about this map, or null when it knows nothing, could not be
 * reached, or answered with something unreadable.
 *
 * Never rejects. Every caller has a fallback that is what it would draw for a
 * map the hub has never heard of, so a failure is that same answer.
 */
export function knownMap(
  base: string,
  mapName: string,
): Promise<MapFacts | null> {
  const cacheKey = `${base}\n${mapName}`;

  if (answered.has(cacheKey)) {
    return Promise.resolve(answered.get(cacheKey) ?? null);
  }
  const already = asking.get(cacheKey);
  if (already) return already;

  const promise = new Promise<MapFacts | null>((resolve) => {
    queue.push({ base, cacheKey, mapName, settle: resolve });
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

/** Send everything queued, one request per hub address per batch. */
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
    const result = await fetchMapFacts(
      base,
      group.map((ask) => ask.mapName),
    );
    group.forEach((ask, index) => {
      const facts = result.ok ? (result.maps[index] ?? null) : null;
      // A failure is not an answer, so it is not remembered. Anything the hub
      // did say is, including that it knows nothing about the map.
      if (result.ok) answered.set(ask.cacheKey, facts);
      asking.delete(ask.cacheKey);
      ask.settle(facts);
    });
  }
}

/** Forget every answer. For tests, which would otherwise see the hub answer once
 *  and every case after it read the first one's cache. */
export function forgetKnownMaps(): void {
  answered.clear();
  asking.clear();
  queue = [];
}
