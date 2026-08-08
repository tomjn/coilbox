/**
 * The suggested map: which curated map the welcome screen promotes today, and
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
import { occupancy } from "../multiplayer/battles/battleFilters";
import type { Battle } from "../multiplayer/bindings";
import { useMultiplayer } from "../multiplayer/store";
import { usePreferredTarget } from "../play/config";
import { getProfileMapLists } from "../profile/profile";
import type { ContentPick } from "./contentArt";

/**
 * The download kinds a curated map can actually be installed from.
 * `suggestedMapToInput` builds a queue request for these two and nothing else,
 * so anything outside them would be offered with a dead button.
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
export function suggestedMapPool(
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
 * every curated map is suggested exactly once and none is favoured. Everyone
 * computes it from the same two inputs, so everyone gets the same answer without
 * asking a server.
 *
 * Takes the date rather than reading the clock, so a test can ask about any day.
 */
export function pickSuggestedMap(
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
 * The three fields of the lobby mirror the suggested pick reads. A real
 * `LobbyState` satisfies it, and a test writes a room rather than forty fields.
 * Narrow on purpose: this module is allowed to know which maps are in play and
 * nothing else about the lobby.
 */
export type SuggestedLobbySnapshot = {
  battles: Record<string, Pick<Battle, "map" | "host" | "members">>;
};

/**
 * Occupants a room needs before it counts as people playing.
 *
 * Lobby servers are full of autohosts sitting alone in an empty room, and the
 * host is always counted, so a room of one is a bot waiting rather than a game.
 * Featuring its map would make the card's claim false, and false is worse than
 * the rotation.
 */
const PLAYING_MIN_OCCUPANCY = 2;

/**
 * Where the suggested map came from, so the card can say which.
 *
 * The user cannot otherwise tell: both sources put one curated map on one card.
 * Without this the feature would be invisible and so unfalsifiable.
 */
export type SuggestedSource = "battle" | "curated";

/**
 * The curated map most people are on right now, or null.
 *
 * Deliberately restricted to the pool. The pool is the set of maps this card can
 * honestly offer: each has a verified spring name and a download that works, and
 * the catalog carries a picture of it. Synthesising an entry for any map a battle
 * happens to name would drop the card to a bare name over a glyph for a map that
 * may not be downloadable anywhere, which is a worse home page than the rotation.
 * So a battle on an uncurated map is no answer, and the rotation stands.
 *
 * That makes this a re-ordering of the curated rotation rather than a new source
 * of maps, which is what "prefer a map an open battle is using *over the curated
 * rotation*" asks for.
 *
 * Ranked by heads, not rooms: three idle autohosts should not outrank one full
 * team game. Ties go to pool order, so the answer is a function of the snapshot
 * and never of the order the server happened to send the rooms in.
 */
export function battleSuggestedMap(
  pool: SuggestedMap[],
  lobby: SuggestedLobbySnapshot | null,
): SuggestedMap | null {
  if (!lobby) return null;
  const players = new Map<string, number>();
  for (const battle of Object.values(lobby.battles)) {
    const heads = occupancy(battle);
    if (heads < PLAYING_MIN_OCCUPANCY) continue;
    const key = battle.map.toLowerCase();
    players.set(key, (players.get(key) ?? 0) + heads);
  }
  if (players.size === 0) return null;

  let best: SuggestedMap | null = null;
  let bestHeads = 0;
  for (const map of pool) {
    const springName = springNameOf(map);
    if (!springName) continue;
    // Exact spring name, lowercased, the same identity `poolKey` uses. Not a
    // fuzzy match on the version suffix: "Supreme Isthmus v2.1" and v2.2 are
    // different archives, and offering the curated one because a battle is on
    // the other would feature a map that still would not let you into it.
    const heads = players.get(springName.toLowerCase()) ?? 0;
    // Strictly greater, so the first in pool order wins a tie.
    if (heads > bestHeads) {
      best = map;
      bestHeads = heads;
    }
  }
  return best;
}

/**
 * The map to feature, and why.
 *
 * A live lobby's answer beats the day's rotation, and everything else falls
 * through to it. `lobby` is null whenever there is no connection, so a logged-out
 * or offline player takes exactly the branch they took before this existed.
 */
export function suggestedMapFor(
  pool: SuggestedMap[],
  lobby: SuggestedLobbySnapshot | null,
  date: Date,
): { map: SuggestedMap | null; source: SuggestedSource } {
  const battle = battleSuggestedMap(pool, lobby);
  if (battle) return { map: battle, source: "battle" };
  return { map: pickSuggestedMap(pool, date), source: "curated" };
}

/**
 * What the card may offer for the suggested map.
 *
 * The map-pack states plus `failed`, which the packs fold into `available`
 * because a pack row can afford to look retryable and say nothing. One card
 * carrying one map cannot: a download that failed silently reads as a button
 * that does nothing.
 */
export type SuggestedState = PackMapState | "failed";

/**
 * Classify the suggested map.
 *
 * Two independent readings of "already installed", because either alone misses
 * cases. The on-disk file listing does not know a map installed under a
 * different file name, and the unitsync scan is empty until it resolves and on
 * an install with no engine yet. A hit from either is believed.
 *
 * Pure, so the states the card can be in are testable without mounting it.
 */
export function suggestedMapState(args: {
  input: EnqueueInput | null;
  filename?: string;
  /** The map's spring name, when its download declares one. */
  springName?: string;
  /** Lowercased map file names present in a content root. */
  installed: Set<string>;
  /** Lowercased map names a settled unitsync scan reported. */
  scanned: Set<string>;
  queueStatus: QueueStatus | null;
}): SuggestedState {
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
 * The map this card has taken, for the tool cards to settle around (issue #1055).
 *
 * The tool cards already avoid each other's pictures, and this card was outside
 * that set, so it could show the same map as the Maps card standing beside it in
 * the same group. It claims its map instead of joining the priority list because
 * it has no tool id and no second map to fall back on, and because a card that is
 * about one named map cannot yield it to a card that stands for a collection.
 *
 * Pure, and expressed in `contentArt`'s own currency, so the pick layer learns
 * nothing about the catalog: it is handed a picture that is spoken for.
 *
 * `shown` is whether the page has a suggested map zone at all. A profile that
 * left it out has no card holding this map, and a claim then would cost the Maps
 * card a picture for nothing.
 *
 * The claim stands whether or not the map is installed. Uninstalled, the card
 * paints the catalog's thumbnail and no tool card can offer the map anyway,
 * because those offers come from the unitsync scan. So the claim only bites in
 * exactly the case that is the defect.
 */
export function suggestedMapClaim(
  map: SuggestedMap | null,
  shown: boolean,
): readonly ContentPick[] {
  const springName = shown && map ? springNameOf(map) : undefined;
  return springName ? [{ kind: "map", mapName: springName }] : [];
}

/**
 * Today's suggested map.
 *
 * `loading` separates "the catalog has not answered yet" from "the catalog
 * answered and there is nothing curated", which the card needs because it shows
 * a placeholder for the first and nothing for the second.
 *
 * The date is taken once per mount. The rotation turns over at UTC midnight, and
 * a session that spans one keeps yesterday's map until the page is revisited,
 * which is a boundary nobody is watching for.
 *
 * When a lobby connection happens to be live, a map people are on beats the
 * rotation (issue #996). Reading it is passive: `useMultiplayer` is a plain
 * `useContext` on a provider `app.plugins.ts` already mounts app-wide and two
 * other home zones already read. Nothing here can open a connection, read a
 * credential or raise a login prompt, and `mirror.state` is null until something
 * else connects, so a logged-out or offline player gets the rotation and only the
 * rotation.
 *
 * The battle answer is latched for the life of the mount. `mirror.state.battles`
 * changes every time anyone anywhere joins or leaves a room, which on a busy
 * server is several times a second, and an unlatched card would swap its picture,
 * name and blurb under a reader who is looking at it. So the zone settles on the
 * first answer the lobby gives and keeps it. The cost is that the pick can be a
 * session old, which for rooms that live tens of minutes is a boundary worth
 * trading for a card that holds still.
 */
export function useSuggestedMap(): {
  map: SuggestedMap | null;
  loading: boolean;
  source: SuggestedSource;
} {
  const catalogLists = useSuggestedMapLists();
  const maps = useSuggestedMaps();
  const loaded = useCatalogLoaded();
  const { mirror } = useMultiplayer();
  const today = useMemo(() => new Date(), []);
  const pool = useMemo(
    () =>
      suggestedMapPool(maps, mergeMapLists(catalogLists, getProfileMapLists())),
    [maps, catalogLists],
  );
  const answer = useMemo(
    () => suggestedMapFor(pool, mirror.state, today),
    [pool, mirror.state, today],
  );

  const [latched, setLatched] = useState<SuggestedMap | null>(null);
  useEffect(() => {
    // `prev ?? map` keeps the first answer, and returning `prev` unchanged lets
    // React bail out of the re-render for every later lobby delta.
    if (answer.source === "battle") setLatched((prev) => prev ?? answer.map);
  }, [answer]);

  return {
    map: latched ?? answer.map,
    loading: !loaded,
    source: latched ? "battle" : answer.source,
  };
}

/**
 * The suggested map's own picture.
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
 * `thumb` is optional on a curated map, and the map packs were written without
 * one because a pack row shows no picture. The pool takes the packs' maps too, so
 * for most of the rotation there was nothing for this to resolve and the card came
 * up blank (issue #1037). The catalog now carries a picture for every map in the
 * pool, so a map added to a pack without one is a card with no art on its day.
 *
 * Neither source is available on a cold offline first run for a map the player
 * does not have. The card then renders without art, which the component handles by
 * dropping to its plain surface rather than by reaching for a third source.
 *
 * Both hooks run on every render, as hooks must. The minimap one is handed a map
 * name only when the map is installed, and does nothing without one.
 */
export function useSuggestedMapArt(
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
export function useSuggestedMapInstall(map: SuggestedMap | null): {
  state: SuggestedState;
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
    ? suggestedMapState({
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
