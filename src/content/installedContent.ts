import { dlInstalledContent } from "../downloads/bindings";
import { shareInFlight } from "./inFlight";

type Installed = Awaited<ReturnType<typeof dlInstalledContent>>;

/** Session cache of the file listing, keyed by the sorted set of paths. */
const cache = new Map<string, Installed>();
const pending = new Map<string, Promise<Installed>>();
/** Bumped by a clear, so a read that started before it is not stored after. */
let generation = 0;

/**
 * Lowercased map and game filenames in the given content roots, from
 * `dl_installed_content`. The answer only changes when a download finishes or
 * something is deleted, so it is kept for the session and callers that ask
 * together share one request. {@link invalidateInstalledContent} clears it. A
 * failed read is not kept, so a retry asks again.
 */
export function installedContent({
  paths,
}: {
  paths: string[];
}): Promise<Installed> {
  const key = [...paths].sort().join("\n");
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return shareInFlight(pending, key, async () => {
    const started = generation;
    const res = await dlInstalledContent({ paths });
    if (started === generation) cache.set(key, res);
    return res;
  });
}

/** Forget every listing, so the next ask reads the disk again. */
export function invalidateInstalledContent(): void {
  generation += 1;
  cache.clear();
  pending.clear();
}
