import { shareInFlight } from "../content/inFlight";
import { dlGithubReleaseArchives, type ReleaseArchive } from "./bindings";

/** Session cache of each repository's release archives, keyed by `owner/name`. */
const cache = new Map<string, ReleaseArchive[]>();
const pending = new Map<string, Promise<ReleaseArchive[]>>();
/** Bumped by an invalidation, so a read that started before it is not stored. */
let generation = 0;

/**
 * The release archives of `repo`, newest first as GitHub lists them. Callers
 * that ask together share one request, and a later ask is served from the
 * session. Pass `refresh` to ask GitHub again. A failed request, a rate limit
 * refusal included, is not kept, so the next ask tries again.
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
    if (started === generation) cache.set(repo, archives);
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
}
