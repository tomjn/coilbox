import { shareInFlight } from "../content/inFlight";
import { dlRecoilEngines, dlSpringfilesEngines } from "./bindings";

type Recoil = Awaited<ReturnType<typeof dlRecoilEngines>>;
type Springfiles = Awaited<ReturnType<typeof dlSpringfilesEngines>>;

/** Session cache of the two engine lists. */
const cache = new Map<string, object>();
const pending = new Map<string, Promise<object>>();
/** Bumped by an invalidation, so a read that started before it is not stored. */
let generation = 0;

/** A logical clock. A held list and a lookup each take a tick. */
let clock = 0;
/** The tick at which each held list finished loading. */
const loadedAt = new WeakMap<object, number>();

/** A tick for a lookup to remember when it was asked for. */
export function engineTick(): number {
  clock += 1;
  return clock;
}

function load<T extends object>(
  key: string,
  fetch: () => Promise<T>,
  refresh: boolean,
): Promise<T> {
  const hit = refresh ? undefined : (cache.get(key) as T | undefined);
  if (hit) return Promise.resolve(hit);
  return shareInFlight(pending, key, async () => {
    const started = generation;
    const res = await fetch();
    if (started === generation) {
      loadedAt.set(res, engineTick());
      cache.set(key, res);
    }
    return res;
  }) as Promise<T>;
}

/**
 * The Recoil engine releases for this platform. Callers that ask together share
 * one request and a later ask is served from the session. A failed request is
 * not kept, so the next ask tries again. Pass `refresh` to ask again.
 */
export function loadRecoilEngines(refresh = false): Promise<Recoil> {
  return load("recoil", () => dlRecoilEngines(undefined), refresh);
}

/** The Recoil list if it is already held, so a caller can use it at once. */
export function heldRecoilEngines(): Recoil | undefined {
  return cache.get("recoil") as Recoil | undefined;
}

/** The springfiles engine list. Same rules as {@link loadRecoilEngines}. */
export function loadSpringfilesEngines(refresh = false): Promise<Springfiles> {
  return load("springfiles", () => dlSpringfilesEngines(undefined), refresh);
}

/** The springfiles list if it is already held. */
export function heldSpringfilesEngines(): Springfiles | undefined {
  return cache.get("springfiles") as Springfiles | undefined;
}

/** Forget both lists, so the next ask fetches again. */
export function invalidateEngineLists(): void {
  generation += 1;
  cache.clear();
  pending.clear();
}

export interface EngineCatalog {
  recoil: Recoil["releases"];
  springfiles: Springfiles["engines"];
}

/**
 * Both engine lists, for a lookup of `versions` asked for at `askedAt` (a tick
 * from {@link engineTick}). A version missing from a list that loaded before that
 * tick may only be newer than the list, so that list is fetched once more. A list
 * that loaded after it is trusted, so a version no list has refetches once and
 * not on every render. A list that cannot be read comes back empty, and a failed
 * refetch keeps the held copy.
 */
export async function loadEngineCatalog(
  versions: string[],
  askedAt: number,
): Promise<EngineCatalog> {
  const read = (refreshRecoil: boolean, refreshSpringfiles: boolean) =>
    Promise.all([
      loadRecoilEngines(refreshRecoil).catch(() => undefined),
      loadSpringfilesEngines(refreshSpringfiles).catch(() => undefined),
    ]);
  const catalog = ([r, s]: Awaited<
    ReturnType<typeof read>
  >): EngineCatalog => ({
    recoil: r?.releases ?? [],
    springfiles: s?.engines ?? [],
  });
  const stale = (list: object | undefined) =>
    (list ? (loadedAt.get(list) ?? 0) : 0) <= askedAt;

  const first = await read(false, false);
  const held = catalog(first);
  const found = (v: string) =>
    held.recoil.some((e) => e.version === v) ||
    held.springfiles.some((e) => e.version === v);
  if (versions.every(found)) return held;
  const [oldRecoil, oldSpringfiles] = [stale(first[0]), stale(first[1])];
  if (!oldRecoil && !oldSpringfiles) return held;
  const [r, s] = await read(oldRecoil, oldSpringfiles);
  return catalog([r ?? first[0], s ?? first[1]]);
}
