/**
 * The featured map: which curated map the welcome screen promotes today, and
 * what the card may say about it.
 *
 * The curated list is the one the map packs already use, the GitHub
 * `catalog.json`, loaded through `content/branding`'s single session promise and
 * its Rust-side fetch, disk-cache and bundled-seed chain. There is no second
 * fetch and no second cache here, and no new schema: a map good enough to sit in
 * a pack is good enough to feature, so the pool is every curated map the catalog
 * and the distribution profile between them offer.
 *
 * Everything that decides *which* map is a pure function of a pool and a date,
 * so the rotation is testable without a clock, a network or a DOM.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type SuggestedMap,
  type SuggestedMapList,
  useCachedImage,
  useCatalogLoaded,
  useSuggestedMapLists,
  useSuggestedMaps,
} from "../content/branding";
import { useUnitsyncMinimap, useUnitsyncScan } from "../content/config";
import { dlInstalledContent } from "../downloads/bindings";
import { useContentRootPaths, useWriteRootPath } from "../downloads/config";
import {
  type EnqueueInput,
  identityOf,
  type QueueStatus,
  useDownloadComplete,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import {
  mergeMapLists,
  type PackMapState,
  packMapState,
  suggestedMapToInput,
} from "../downloads/mapLists";
import { usePreferredTarget } from "../play/config";
import { getProfileMapLists } from "../profile/profile";

/**
 * The download kinds a curated map can actually be installed from.
 * `suggestedMapToInput` builds a queue request for these two and nothing else,
 * so anything outside them would be featured with a dead button.
 */
const INSTALLABLE_KINDS = new Set(["map", "url"]);

/**
 * A stable identity for a curated map, so the same map reached through both
 * `suggested.maps` and a pack is one entry in the pool rather than two chances
 * of being picked. The spring name is the real identity where there is one, and
 * a direct mirror download is identified by the file it writes.
 */
function poolKey(map: SuggestedMap): string {
  const dl = map.download;
  if (dl.kind === "map") return `map:${dl.springName.toLowerCase()}`;
  if (map.filename) return `file:${map.filename.toLowerCase()}`;
  return `id:${map.id.toLowerCase()}`;
}

/**
 * Every curated map that can be installed, deduped, in catalog order.
 *
 * Order matters, because the rotation walks the pool in it: an editor adding a
 * map to the end of a pack adds it to the end of the cycle. Standalone
 * suggestions come before packs because that is the order the catalog reads in.
 */
export function featuredMapPool(
  maps: SuggestedMap[],
  lists: SuggestedMapList[],
): SuggestedMap[] {
  const seen = new Set<string>();
  const pool: SuggestedMap[] = [];
  for (const map of [...maps, ...lists.flatMap((l) => l.maps)]) {
    if (!INSTALLABLE_KINDS.has(map.download.kind)) continue;
    const key = poolKey(map);
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(map);
  }
  return pool;
}

/** Milliseconds in a day. */
const DAY_MS = 86_400_000;

/**
 * Whole days since the Unix epoch, in UTC.
 *
 * Read off the timestamp alone, never off `getDate()` and friends, so two
 * players see the same number at the same moment however their machines are set.
 * Keying on local dates would give a player in Kiritimati tomorrow's map while a
 * player in Honolulu still had yesterday's, which is precisely what "the same
 * map on the same day" is meant to rule out.
 */
export function utcDayIndex(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

/**
 * The map to feature on a given day, or null when there is nothing curated.
 *
 * The day index steps the pool by one, so over any run of `pool.length` days
 * every curated map is featured exactly once and none is favoured. Everyone
 * computes it from the same two inputs, so everyone gets the same answer without
 * asking a server.
 *
 * Takes the date rather than reading the clock, so a test can ask about any day.
 */
export function pickFeaturedMap(
  pool: SuggestedMap[],
  date: Date,
): SuggestedMap | null {
  if (pool.length === 0) return null;
  const day = utcDayIndex(date);
  // Two-step modulo: a date before 1970 gives a negative index, and JavaScript's
  // `%` keeps the sign.
  return pool[((day % pool.length) + pool.length) % pool.length];
}

/**
 * What the card may offer for the featured map.
 *
 * The map-pack states plus `failed`, which the packs fold into `available`
 * because a pack row can afford to look retryable and say nothing. One card
 * carrying one map cannot: a download that failed silently reads as a button
 * that does nothing.
 */
export type FeaturedState = PackMapState | "failed";

/**
 * Classify the featured map.
 *
 * Two independent readings of "already installed", because either alone misses
 * cases. The on-disk file listing does not know a map installed under a
 * different file name, and the unitsync scan is empty until it resolves and on
 * an install with no engine yet. A hit from either is believed.
 *
 * Pure, so the states the card can be in are testable without mounting it.
 */
export function featuredMapState(args: {
  input: EnqueueInput | null;
  filename?: string;
  /** The map's spring name, when its download declares one. */
  springName?: string;
  /** Lowercased map file names present in a content root. */
  installed: Set<string>;
  /** Lowercased map names a settled unitsync scan reported. */
  scanned: Set<string>;
  queueStatus: QueueStatus | null;
}): FeaturedState {
  const { input, filename, springName, installed, scanned, queueStatus } = args;
  if (springName && scanned.has(springName.toLowerCase())) return "installed";
  const base = packMapState({ input, filename, installed, queueStatus });
  if (base === "available" && queueStatus === "error") return "failed";
  return base;
}

/** The spring name a curated map installs as, when its download declares one. */
export function springNameOf(map: SuggestedMap): string | undefined {
  return map.download.kind === "map" ? map.download.springName : undefined;
}

/**
 * Today's featured map.
 *
 * `loading` separates "the catalog has not answered yet" from "the catalog
 * answered and there is nothing curated", which the card needs because it shows
 * a placeholder for the first and nothing for the second.
 *
 * The date is taken once per mount. The rotation turns over at UTC midnight, and
 * a session that spans one keeps yesterday's map until the page is revisited,
 * which is a boundary nobody is watching for.
 *
 * Issue #996 (prefer a map an open battle is using) belongs here and nowhere
 * else. It needs a `SuggestedMap` for a live battle's map, taken in preference
 * to the rotation's answer and returned from this one hook, so the card, the
 * zone and this module's tests all keep working unchanged.
 */
export function useFeaturedMap(): {
  map: SuggestedMap | null;
  loading: boolean;
} {
  const catalogLists = useSuggestedMapLists();
  const maps = useSuggestedMaps();
  const loaded = useCatalogLoaded();
  const today = useMemo(() => new Date(), []);
  const map = useMemo(
    () =>
      pickFeaturedMap(
        featuredMapPool(
          maps,
          mergeMapLists(catalogLists, getProfileMapLists()),
        ),
        today,
      ),
    [maps, catalogLists, today],
  );
  return { map, loading: !loaded };
}

/**
 * The featured map's own picture.
 *
 * Deliberately not {@link ./art}'s `resolveCardArt`. That chain answers "what
 * should the card for a *tool* show", keyed by nav id and floored by a
 * procedural pattern seeded from that id. This card is about one named map, and
 * the only honest art for a named map is a picture of it. A procedural swirl
 * under a map's name would be a picture of nothing.
 *
 * So one source in two forms, both of them that map's minimap:
 *
 * 1. Installed: the engine's own render, cached on disk by the unitsync worker
 *    and served over `coilbox://` since PR #982. No network, so it survives
 *    offline, and it is the picture of the archive the player actually has.
 * 2. Not installed: the catalog's `thumb`, through the same Rust image proxy and
 *    disk cache the download browsers use. Fetched once, then offline too.
 *
 * Neither is available on a cold offline first run for a map the player does not
 * have. The card then renders without art, which the component handles by
 * dropping to its plain surface rather than by reaching for a third source.
 *
 * Both hooks run on every render, as hooks must. The minimap one is handed a map
 * name only when the map is installed, and does nothing without one.
 */
export function useFeaturedMapArt(
  map: SuggestedMap | null,
  installed: boolean,
): string | undefined {
  const { target } = usePreferredTarget();
  const springName = map ? springNameOf(map) : undefined;
  const minimap = useUnitsyncMinimap(
    target?.enginePath,
    target?.dataDir,
    installed ? springName : undefined,
  );
  const thumb = useCachedImage(map?.thumb, true);
  return minimap.url ?? thumb;
}

/**
 * Whether the user already has this map, whether a download is under way, and
 * how to start one.
 *
 * The two inventories are the ones every other install check in the app uses, so
 * a map fetched from the maps page or a pack shows as installed here without
 * being told about it. `useDownloadComplete` re-reads the on-disk listing when
 * the queue finishes anything, which is what flips the card the moment its own
 * download lands.
 */
export function useFeaturedMapInstall(map: SuggestedMap | null): {
  state: FeaturedState;
  /** The queue's message for a failed download, when there is one. */
  error: string | null;
  /** False when no write root is set, which is the one thing the user must fix. */
  canDownload: boolean;
  download: () => void;
} {
  const writePath = useWriteRootPath();
  const rootPaths = useContentRootPaths();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { enqueue, statusFor, items } = useDownloadQueue();
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  const refreshInstalled = useCallback(async () => {
    if (rootPaths.length === 0) return;
    try {
      const { maps } = await dlInstalledContent({ paths: rootPaths });
      setInstalled(new Set(maps));
    } catch {
      // Leave the last listing in place. A failed read is not a report that the
      // user has nothing, and treating it as one re-offers an installed map.
    }
  }, [rootPaths]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);
  useDownloadComplete(refreshInstalled);

  const scanned = useMemo(
    () =>
      new Set(
        (scan.loading ? [] : (scan.data?.maps ?? [])).map((m) =>
          m.name.toLowerCase(),
        ),
      ),
    [scan.loading, scan.data],
  );

  const input = map ? suggestedMapToInput(map, writePath) : null;
  const identity = input ? identityOf(input) : null;
  const queueStatus = identity ? statusFor(identity) : null;
  const state = map
    ? featuredMapState({
        input,
        filename: map.filename,
        springName: springNameOf(map),
        installed,
        scanned,
        queueStatus,
      })
    : "unavailable";
  const error =
    items.find((i) => i.identity === identity && i.error)?.error ?? null;

  return {
    state,
    error,
    canDownload: !!writePath,
    download: () => {
      if (input) enqueue(input);
    },
  };
}
