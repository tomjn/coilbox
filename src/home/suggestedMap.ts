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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
 *
 * Separate from {@link suggestedMapPool} so that a test can hold the catalog to
 * the rule that everything offered here can be pictured. See
 * `suggestedCatalog.test.ts`.
 */
export function suggestedMapCandidates(
  maps: SuggestedMap[],
  lists: SuggestedMapList[],
): SuggestedMap[] {
  const seen = new Set<string>();
  const candidates: SuggestedMap[] = [];
  for (const map of [...maps, ...lists.flatMap((l) => l.maps)]) {
    if (!INSTALLABLE_KINDS.has(map.download.kind)) continue;
    const key = poolKey(map);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(map);
  }
  return candidates;
}

/** Whether the catalog gives this map a picture the card can paint. */
function picturable(map: SuggestedMap): boolean {
  return (map.thumb?.length ?? 0) > 0;
}

/**
 * The maps the rotation runs over: the candidates the catalog can picture.
 *
 * `thumb` is optional on a curated map, and a pack's maps were written without
 * one because a pack row on the Maps page shows no picture. The pool takes the
 * packs too, so for most of the rotation there was nothing to paint and the card
 * came up blank (issue #1037). What to do about the next one is issue #1070, and
 * this is the answer: pass over it.
 *
 * A card with no picture standing beside three that have one reads as a card
 * that failed rather than as a map, and there is no honest substitute to draw. A
 * procedural field would be a picture of nothing under a named map, and the
 * spring name is exactly what a mirror will hand back the wrong map for (issue
 * #1067). The next map in the rotation is a real picture of a real map, so the
 * rotation moves on and the missing thumbnail costs a reader nothing.
 *
 * Skipping is install-independent on purpose, so everyone still gets the same
 * map on the same day. A player who has the map installed would have got its
 * minimap, and gives that up to keep the rotation the same everywhere.
 *
 * Unless it would empty the rotation. A distribution's own `mapLists` join this
 * pool, and one that curates maps without thumbnails would otherwise lose the
 * zone altogether and never be told why. A card with a glyph beats no card.
 */
export function suggestedMapPool(
  maps: SuggestedMap[],
  lists: SuggestedMapList[],
): SuggestedMap[] {
  const candidates = suggestedMapCandidates(maps, lists);
  const pictured = candidates.filter(picturable);
  return pictured.length > 0 ? pictured : candidates;
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
 * How long a tick waits at the very least, so a timer that fires a hair before
 * the boundary reschedules once rather than spinning until the clock catches up.
 */
const MIN_TICK_MS = 1_000;

/**
 * Milliseconds from `now` to the next UTC midnight, floored at
 * {@link MIN_TICK_MS}.
 *
 * Counted off the same `Math.floor(t / DAY_MS)` {@link utcDayIndex} uses, so the
 * instant this waits for is exactly the instant that changes the day index.
 */
export function msToNextUtcDay(now: number): number {
  return Math.max((Math.floor(now / DAY_MS) + 1) * DAY_MS - now, MIN_TICK_MS);
}

/**
 * The UTC day the rotation is on, and everything that keeps it current.
 *
 * Coilbox is a launcher, so a window left open for more than a day is ordinary.
 * The day was read once per mount, and a session that spanned UTC midnight kept
 * yesterday's map until the page was revisited, which is a boundary nobody was
 * watching for (issue #1022).
 *
 * One module-level store rather than a timer per hook. That was first written
 * when the map was resolved twice per render and two timers could have crossed
 * midnight in separate tasks; {@link SuggestedMapContext} has since made one
 * resolution the only one there is. The store stays because it is still the
 * cheaper shape: one timer for the page rather than one per mount, and no timer
 * at all while nothing is mounted.
 *
 * The tick re-reads the clock rather than adding one to the day, so a machine
 * that slept through midnight lands on the day it woke up on rather than the day
 * after the one it slept on.
 *
 * No timer runs while nothing is mounted. The last listener to go clears it, and
 * the first to arrive re-reads the day before anything renders, so a page left
 * unmounted across midnight is right on its first frame.
 */
let currentDay = utcDayIndex(new Date());
const dayListeners = new Set<() => void>();
let dayTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleDayTick(): void {
  dayTimer = setTimeout(tickDay, msToNextUtcDay(Date.now()));
}

function tickDay(): void {
  const day = utcDayIndex(new Date());
  if (day !== currentDay) {
    currentDay = day;
    for (const listener of dayListeners) listener();
  }
  scheduleDayTick();
}

/** Subscribe to the day boundary. Exported for the tests that drive the tick. */
export function subscribeUtcDay(listener: () => void): () => void {
  dayListeners.add(listener);
  if (dayTimer === undefined) {
    currentDay = utcDayIndex(new Date());
    scheduleDayTick();
  }
  return () => {
    dayListeners.delete(listener);
    if (dayListeners.size > 0) return;
    clearTimeout(dayTimer);
    dayTimer = undefined;
  };
}

/** The day the rotation is on now. Exported for the tests that read it. */
export function utcDayNow(): number {
  return currentDay;
}

/**
 * The UTC day, as a value that changes when the rotation should turn over.
 *
 * `utcDayNow` is the server snapshot too, because a static render has no clock
 * to wait for and the day the module loaded on is the only answer there is.
 */
export function useUtcDay(): number {
  return useSyncExternalStore(subscribeUtcDay, utcDayNow, utcDayNow);
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
 * What the page decided to feature, resolved once and read everywhere.
 *
 * `loading` separates "the catalog has not answered yet" from "the catalog
 * answered and there is nothing curated", which the card needs because it shows
 * a placeholder for the first and nothing for the second.
 */
export type SuggestedMapAnswer = {
  map: SuggestedMap | null;
  loading: boolean;
  source: SuggestedSource;
};

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
 * Called once, above the layout, and published through
 * {@link SuggestedMapContext}. See there for why the zone is told the answer
 * rather than working it out again.
 *
 * The date comes from {@link useUtcDay}, so a session left open across UTC
 * midnight turns the card over where it stands rather than holding yesterday's
 * map until the page is next visited (issue #1022).
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
export function useSuggestedMap(): SuggestedMapAnswer {
  const catalogLists = useSuggestedMapLists();
  const maps = useSuggestedMaps();
  const loaded = useCatalogLoaded();
  const { mirror } = useMultiplayer();
  const day = useUtcDay();
  // The rotation reads nothing off a date but its UTC day, so the day's own
  // first instant stands for every instant in it. Built here rather than passed
  // as a number so the pure functions keep the `Date` argument a test can write.
  const today = useMemo(() => new Date(day * DAY_MS), [day]);
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

  return useMemo(
    () => ({
      map: latched ?? answer.map,
      loading: !loaded,
      source: latched ? "battle" : answer.source,
    }),
    [latched, answer, loaded],
  );
}

/**
 * The page's answer, handed to the zone that draws it.
 *
 * The map used to be worked out twice on every home render: once above the
 * layout so its pick could be claimed against the tool cards, and once inside
 * the zone. Both read the same context in the same commit, so they agreed, but
 * they agreed by coincidence rather than by construction (issue #1077). The
 * claim's whole purpose is that two places name one map, and anything that made
 * either resolution depend on time, on a fetch, or on state that settles later
 * would have turned that into a race whose failure was silent: the card paints
 * one map while the claim reserves another, so a tool card moves off a picture
 * nobody is showing. The battle latch above is exactly that kind of thing, one
 * mount ahead of the other from its first lobby delta.
 *
 * So there is one resolution and the zone is told the answer. A context rather
 * than a prop, because the layout composes this zone into the tool grid rather
 * than rendering it in place. A prop would have to be threaded through every
 * layout that ever draws the zone, and a layout that forgot would quietly have
 * the seam back.
 *
 * `null` when nothing has provided one, which {@link useSuggestedMapAnswer}
 * refuses rather than papers over. A card that resolved its own map would be the
 * defect this exists to remove.
 */
export const SuggestedMapContext = createContext<SuggestedMapAnswer | null>(
  null,
);

/** The map to feature, and why. Must be used under {@link SuggestedMapContext}. */
export function useSuggestedMapAnswer(): SuggestedMapAnswer {
  const answer = useContext(SuggestedMapContext);
  if (!answer)
    throw new Error("suggested map zone rendered outside SuggestedMapContext");
  return answer;
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
 * `thumb` is optional on a curated map, and a map that arrived through a pack had
 * none, so for most of the rotation there was nothing for this to resolve and the
 * card came up blank (issue #1037). {@link suggestedMapPool} now passes over a map
 * the catalog cannot picture, so a thumbnail the editor forgot costs a map its turn
 * in the rotation rather than costing a reader their card (issue #1070).
 *
 * Neither source is available on a cold offline first run for a map the player
 * does not have. The card then renders without art, which the component handles by
 * dropping to its plain surface rather than by reaching for a third source.
 *
 * Both hooks run on every render, as hooks must. The minimap one is handed a map
 * name only when the map is installed, and does nothing without one.
 *
 * ## Why the middle step exists
 *
 * For a map you have, both sources answer, and they answer at different times:
 * the thumbnail at about 760ms and the minimap at about 990ms. The card painted
 * the first and then changed to the second, and since both are pictures of the
 * same map the change said nothing the first one did not (issue #1095).
 *
 * The two are not interchangeable, so the fix is not to drop one. The minimap is
 * the archive the player actually has, rendered by their own engine and needing
 * no network. The thumbnail is the catalog's own image of the map, and a mirror
 * is exactly the thing that hands back a different map under a name (issue
 * #1067). Preferring whichever arrived first would have made which picture you
 * get a function of which cache happened to be warm, which is a different card
 * on two launches of the same app on the same map.
 *
 * Nor does swapping the preference settle it. Whichever source is preferred, the
 * other can still resolve first and be replaced, so an ordering alone only moves
 * the swap to the run where the caches warm the other way round.
 *
 * So the answer is written down and read back, the way the tool cards' is (PR
 * #1096): {@link rememberedSuggestedMapArt} holds the minimap this card settled
 * on last launch, read from `localStorage` while this module loads, and it
 * stands in front of the thumbnail until this launch's own minimap arrives. That
 * is the same URL in the ordinary case, so the picture on the card never
 * changes.
 *
 * Only the minimap is remembered. The thumbnail resolves to a `data:` URL of the
 * image itself, about 140KB for the map on the card as this was written, so
 * there is nothing short to write down. That is no loss: a map you do not have
 * is a map the minimap is never asked for, so its card shows the thumbnail from
 * its first paint and has no swap to remove.
 *
 * A remembered entry can only ever be early, never wrong about its subject. It
 * names the map it is a picture of and is ignored for any other, and both
 * pictures this card can show are pictures of that one map. So there is no
 * pruning here of the kind `contentArt` needs, where a stale entry could put one
 * card's map on another card. The one thing that can go stale is the file, which
 * is a cache entry something else may evict, and the card withdraws it through
 * {@link forgetSuggestedMapArt} when the image will not load.
 */
export function useSuggestedMapArt(
  map: SuggestedMap | null,
  installed: boolean,
  broken: string | null = null,
): string | undefined {
  const { target } = usePreferredTarget();
  const springName = map ? springNameOf(map) : undefined;
  const minimap = useUnitsyncMinimap(
    target?.enginePath,
    target?.dataDir,
    installed ? springName : undefined,
  );
  const thumb = useCachedImage(map?.thumb, true);
  const url = minimap.url;
  useEffect(() => {
    if (springName && url) rememberSuggestedMapArt(springName, url);
  }, [springName, url]);
  return suggestedArtUrl({
    minimap: url,
    remembered: rememberedArtFor(remembered, springName),
    thumb,
    broken,
  });
}

/**
 * Which of the three answers the card paints, in preference order, skipping any
 * the card has already refused.
 *
 * Pure, so the order and the fall-through are testable without a DOM or a
 * unitsync worker.
 */
export function suggestedArtUrl(args: {
  minimap?: string | null;
  remembered?: string;
  thumb?: string;
  broken: string | null;
}): string | undefined {
  for (const url of [args.minimap, args.remembered, args.thumb])
    if (url && url !== args.broken) return url;
  return undefined;
}

/* -------------------------------------------------------------------------- *
 * What the card painted last launch, so this launch paints it at once.
 * -------------------------------------------------------------------------- */

/** The minimap this card settled on, and the map it is a picture of. */
export interface RememberedMapArt {
  mapName: string;
  url: string;
}

/** Where the snapshot is kept, alongside the tool cards' and the theme's. */
const ART_STORAGE_KEY = "coilbox.home.suggestedMapArt";

/**
 * What the last launch painted.
 *
 * Declared here rather than beside the rest of the snapshot code at the foot of
 * the file. A `let` is unreachable until its declaration runs, and Vite's hot
 * reload can re-evaluate a module while React is part way through a render,
 * which would put {@link useSuggestedMapArt} between the two.
 */
let remembered: RememberedMapArt | null = null;

/** The text last written, so an unchanged snapshot is not written again. */
let writtenArt: string | undefined;

/** What the last launch painted. For tests, and for the card's own error path. */
export function rememberedSuggestedMapArt(): RememberedMapArt | null {
  return remembered;
}

/**
 * Take a snapshot as the starting point, without writing it back. What the
 * module does at load with the stored text, and what a test does by hand.
 */
export function seedSuggestedMapArt(entry: RememberedMapArt | null): void {
  remembered = entry;
}

/**
 * The remembered URL for this map, if it is a picture of this map.
 *
 * Case-insensitive, for the reason every other name comparison here is: a spring
 * name reaches this module from the catalog in one case and from a unitsync scan
 * in another.
 */
export function rememberedArtFor(
  entry: RememberedMapArt | null,
  mapName: string | undefined,
): string | undefined {
  if (!entry || !mapName) return undefined;
  return entry.mapName.toLowerCase() === mapName.toLowerCase()
    ? entry.url
    : undefined;
}

/** Hold what this launch resolved and write it down, if it says anything new. */
export function rememberSuggestedMapArt(mapName: string, url: string): void {
  remembered = { mapName, url };
  const text = JSON.stringify({ version: 1, ...remembered });
  if (text === writtenArt) return;
  writtenArt = text;
  try {
    localStorage.setItem(ART_STORAGE_KEY, text);
  } catch {
    // No storage (a test's node environment, or a webview with it switched off).
    // Everything above still works, this launch simply teaches the next one
    // nothing.
  }
}

/**
 * Forget a picture that would not load.
 *
 * A remembered URL names a file in a cache something else is free to evict, and
 * an evicted file is indistinguishable from a working one until the card tries
 * to paint it. Dropping it here rather than only in the card is what lets the
 * card fall through to the catalog's thumbnail instead of to its bare map glyph.
 */
export function forgetSuggestedMapArt(url: string): void {
  if (remembered?.url !== url) return;
  remembered = null;
  writtenArt = undefined;
  try {
    localStorage.removeItem(ART_STORAGE_KEY);
  } catch {
    // As above.
  }
}

/**
 * Read a snapshot back.
 *
 * Anything it does not recognise is nothing at all. The cost of answering
 * nothing is one launch of the behaviour every launch had before this existed.
 */
export function decodeSuggestedMapArt(
  text: string | null,
): RememberedMapArt | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, mapName, url } = parsed as Record<string, unknown>;
  if (version !== 1) return null;
  if (typeof mapName !== "string" || typeof url !== "string") return null;
  if (!mapName || !url) return null;
  return { mapName, url };
}

/** The stored snapshot, or nothing where there is no storage to read. */
function readRememberedArt(): RememberedMapArt | null {
  try {
    const text = localStorage.getItem(ART_STORAGE_KEY);
    writtenArt = text ?? undefined;
    return decodeSuggestedMapArt(text);
  } catch {
    return null;
  }
}

// Read while the module loads, which is before anything renders. Synchronous on
// purpose: this is the value first paint needs, and a promise would arrive after
// exactly the paint it exists to fill.
remembered = readRememberedArt();

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
