import { useEffect, useSyncExternalStore } from "react";
import { shareInFlight } from "../content/inFlight";
import { dlGithubReleaseArchives, type ReleaseArchive } from "./bindings";

/** Session cache of each repository's release archives, keyed by `owner/name`. */
const cache = new Map<string, ReleaseArchive[]>();
const pending = new Map<string, Promise<ReleaseArchive[]>>();
/** When each held list was read, so an automatic refresh can skip a fresh one. */
const readAt = new Map<string, number>();
/** Bumped by an invalidation, so a read that started before it is not stored. */
let generation = 0;

/** Bumped when a held list changes, so pages showing one read it again. */
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readVersion(): number {
  return version;
}

function sameArchives(a: ReleaseArchive[], b: ReleaseArchive[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.filename === b[i].filename &&
        x.url === b[i].url &&
        x.tag === b[i].tag,
    )
  );
}

/**
 * The release archives of `repo`, newest first as GitHub lists them. Callers
 * that ask together share one request, and a later ask is served from the
 * session. Pass `refresh` to ask GitHub again, which anything about to
 * download from the repo should do, so a release published since the last ask
 * is the one installed. A failed request, a rate limit refusal included, is not
 * kept, so the next ask tries again.
 */
export function loadGithubReleases(
  repo: string,
  refresh = false,
): Promise<ReleaseArchive[]> {
  const hit = refresh ? undefined : cache.get(repo);
  if (hit) return Promise.resolve(hit);
  return shareInFlight(pending, repo, async () => {
    const started = generation;
    const { archives } = await dlGithubReleaseArchives({ repo });
    if (started === generation) {
      const held = cache.get(repo);
      cache.set(repo, archives);
      readAt.set(repo, Date.now());
      if (held && !sameArchives(held, archives)) changed();
    }
    return archives;
  });
}

/** The archives of `repo` if already held, so a caller can use them at once. */
export function heldGithubReleases(repo: string): ReleaseArchive[] | undefined {
  return cache.get(repo);
}

/** Forget every held list, so the next ask fetches again. */
export function invalidateGithubReleases(): void {
  generation += 1;
  cache.clear();
  pending.clear();
  readAt.clear();
}

/**
 * Ask GitHub again for each of `repos`. Pass `olderThanMs` to skip a list read
 * more recently than that. A failure keeps the held list.
 */
export async function refreshGithubReleases(
  repos: readonly string[],
  olderThanMs = 0,
): Promise<void> {
  const now = Date.now();
  await Promise.allSettled(
    repos
      .filter((r) => now - (readAt.get(r) ?? 0) >= olderThanMs)
      .map((r) => loadGithubReleases(r, true)),
  );
}

/**
 * How long an automatic refresh leaves a list alone. GitHub allows 60
 * unauthenticated requests an hour from one address, and coilbox does not sign
 * in to GitHub, so each repo checked costs one of those.
 */
export const AUTO_REFRESH_MS = 10 * 60 * 1000;

/**
 * A number that changes whenever a held release list changes, for a hook that
 * reads lists to depend on.
 */
export function useGithubReleasesVersion(): number {
  return useSyncExternalStore(subscribe, readVersion);
}

/**
 * Keep the release lists of `repos` current while a page shows them: read
 * them again when the window comes back into focus and on a timer, each at
 * most once every {@link AUTO_REFRESH_MS}.
 */
export function useGithubReleasesAutoRefresh(repos: readonly string[]): void {
  const key = repos.join("\n");
  useEffect(() => {
    if (!key) return;
    const list = key.split("\n");
    const run = () => {
      void refreshGithubReleases(list, AUTO_REFRESH_MS);
    };
    window.addEventListener("focus", run);
    const timer = window.setInterval(run, AUTO_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", run);
      window.clearInterval(timer);
    };
  }, [key]);
}
