import { shareInFlight } from "../content/inFlight";
import { dlRecoilEngines, dlSpringfilesEngines } from "./bindings";

type Recoil = Awaited<ReturnType<typeof dlRecoilEngines>>;
type Springfiles = Awaited<ReturnType<typeof dlSpringfilesEngines>>;

/** Session cache of the two engine lists. */
const cache = new Map<string, object>();
const pending = new Map<string, Promise<object>>();
/** Bumped by an invalidation, so a read that started before it is not stored. */
let generation = 0;

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
    if (started === generation) cache.set(key, res);
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
