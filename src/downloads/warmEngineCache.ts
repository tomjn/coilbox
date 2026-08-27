import {
  type ContentState,
  contentRescan,
  contentStateLoad,
} from "../content/bindings";
import {
  primeScan,
  type ScanTarget,
  targetsFromState,
} from "../content/config";

/**
 * The engines in `after` that `before` did not have, as scan targets.
 *
 * Without a `before` snapshot every engine looks new, which would warm the whole
 * machine's worth of them. Nothing is returned in that case, so a failed read
 * costs the old behaviour rather than a pile of background scans.
 */
export function addedTargets(
  before: ContentState | null,
  after: ContentState | null,
): ScanTarget[] {
  if (!before) return [];
  const known = new Set(
    targetsFromState(before).map((t) => `${t.rootPath}::${t.enginePath}`),
  );
  return targetsFromState(after).filter(
    (t) => !known.has(`${t.rootPath}::${t.enginePath}`),
  );
}

/**
 * Install an engine, pick up the content it changed, then build that engine's
 * unitsync archive cache in the background.
 *
 * unitsync writes its archive cache into the engine folder rather than the
 * content root, so every engine starts cold and the first caller to load one
 * pays for reading the whole library: measured at 23.4s against a 9.1 GB content
 * folder, against 0.14s once the cache is there. Left alone that bill lands on
 * whoever next opens a battle room, where it reads as a minimap that will not
 * load. Paying it here puts it behind the install that caused it, which already
 * has a progress bar of its own.
 *
 * The warm is not awaited. It is worth 23 seconds of background work and nothing
 * waits on the result, so holding the queue open for it would only make the
 * install look like it had stalled.
 */
export async function installEngine(
  download: () => Promise<unknown>,
): Promise<void> {
  // Read the engines before downloading: this is the only thing that says which
  // of them the install went on to add.
  const before = await contentStateLoad(undefined).catch(() => null);
  await download();
  const after = await contentRescan(undefined).catch(() => null);
  warm(addedTargets(before?.state ?? null, after?.state ?? null)).catch(
    () => {},
  );
}

/** Scan each target in turn, so two new engines never load two libraries at once. */
async function warm(targets: ScanTarget[]): Promise<void> {
  for (const t of targets) {
    await primeScan(t.enginePath, t.rootPath).catch(() => {});
  }
}
