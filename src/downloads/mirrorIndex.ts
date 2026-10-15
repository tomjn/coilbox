import { shareInFlight } from "../content/inFlight";
import {
  dlEvolutionRtsMaps,
  dlHakoraMaps,
  dlSpringfilesList,
} from "./bindings";

type Springfiles = Awaited<ReturnType<typeof dlSpringfilesList>>;
type Hakora = Awaited<ReturnType<typeof dlHakoraMaps>>;
type EvolutionRts = Awaited<ReturnType<typeof dlEvolutionRtsMaps>>;

/** Session cache of each mirror's full index, keyed by source and category. */
const cache = new Map<string, object>();
const pending = new Map<string, Promise<object>>();
/** Bumped by a clear, so a read that started before it is not stored after. */
let generation = 0;

/** A logical clock. A cache entry and a download each take a tick. */
let clock = 0;
/** The tick at which each held index finished loading. */
const loadedAt = new WeakMap<object, number>();

/** A tick for a download to remember when it was asked for. */
export function indexTick(): number {
  clock += 1;
  return clock;
}

function held<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

/**
 * The held index for `key`, or one request for it. `refresh` skips the held
 * copy and fetches again. Callers that ask together share one request. A failed
 * request is not kept, so the next ask tries again, and a refresh that fails
 * leaves the held copy in place.
 */
function load<T extends object>(
  key: string,
  fetch: () => Promise<T>,
  refresh: boolean,
): Promise<T> {
  const hit = refresh ? undefined : held<T>(key);
  if (hit) return Promise.resolve(hit);
  return shareInFlight(pending, key, async () => {
    const started = generation;
    const res = await fetch();
    if (started === generation) {
      loadedAt.set(res, indexTick());
      cache.set(key, res);
    }
    return res;
  }) as Promise<T>;
}

const springfilesKey = (category: string) => `springfiles:${category}`;

/** Every springfiles entry in a category. Pass `refresh` to fetch it again. */
export function loadSpringfilesList(
  category: string,
  refresh = false,
): Promise<Springfiles> {
  return load(
    springfilesKey(category),
    () => dlSpringfilesList({ category }),
    refresh,
  );
}

/** The springfiles list if it is already held, so a page can draw it at once. */
export function heldSpringfilesList(category: string): Springfiles | undefined {
  return held(springfilesKey(category));
}

/** Every map on the hakora mirror. Pass `refresh` to fetch it again. */
export function loadHakoraMaps(refresh = false): Promise<Hakora> {
  return load("hakora", () => dlHakoraMaps(undefined), refresh);
}

export function heldHakoraMaps(): Hakora | undefined {
  return held("hakora");
}

/** Every map on the evolutionrts mirror. Pass `refresh` to fetch it again. */
export function loadEvolutionRtsMaps(refresh = false): Promise<EvolutionRts> {
  return load("evolutionrts", () => dlEvolutionRtsMaps(undefined), refresh);
}

export function heldEvolutionRtsMaps(): EvolutionRts | undefined {
  return held("evolutionrts");
}

/**
 * Look something up in a mirror index for a download that was asked for at
 * `askedAt` (a tick from {@link indexTick}). A miss in a copy that loaded before
 * that tick may only mean the item was added since, so the index is fetched once
 * more. A copy that loaded after it, such as one an earlier download of the same
 * pack refreshed, is trusted, so a pack of missing items refetches once.
 */
export async function findInIndex<I extends object, R>(
  read: (refresh: boolean) => Promise<I>,
  find: (index: I) => R | undefined,
  askedAt: number,
): Promise<R | undefined> {
  const index = await read(false);
  const hit = find(index);
  if (hit !== undefined || (loadedAt.get(index) ?? 0) > askedAt) return hit;
  return find(await read(true));
}

/** Forget every held index, so the next ask fetches again. */
export function invalidateMirrorIndexes(): void {
  generation += 1;
  cache.clear();
  pending.clear();
}
