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
import { useUnitsyncScan } from "../content/config";
import { scanSettled } from "../content/scanSettled";
import { dlInstalledContent } from "../downloads/bindings";
import { useContentRoots, useWriteRoot } from "../downloads/config";
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
 * `suggestedMap.test.ts`.
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
 * Install-independent on purpose. What the player has decides which of these
 * maps is offered, in {@link pickSuggestedMap}, and this list is where the walk
 * starts from, so two players still start from the same place on the same day.
 *
 * An empty pool used to fall back to the unpictured candidates, so that a
 * distribution curating maps without thumbnails kept a card with a glyph on it.
 * It no longer does, because "there is nothing to offer" is now an ordinary
 * state of this card rather than a defect: a player who has every curated map
 * gets no card either (issue #1102). Two ways to empty the offer, one outcome,
 * one code path.
 */
export function suggestedMapPool(
  maps: SuggestedMap[],
  lists: SuggestedMapList[],
): SuggestedMap[] {
  return suggestedMapCandidates(maps, lists).filter(picturable);
}

/* -------------------------------------------------------------------------- *
 * What the player already has.
 * -------------------------------------------------------------------------- */

/**
 * The two readings of "the player has this map" that every install check in the
 * app uses, resolved once for the page.
 *
 * Both, because either alone misses cases. The on-disk file listing does not
 * know a map installed under a different file name from the one the catalog
 * records, and the unitsync scan is empty until it resolves and on an install
 * with no engine at all. A hit from either is believed.
 *
 * `known` is the difference between "the player has nothing" and "nobody has
 * looked yet", which this card cannot paper over: an unread inventory read as an
 * empty one offers a map the player already has, and promotes the card to the
 * top of the page for a player whose maps are all present.
 */
export interface MapInventory {
  /** Lowercased map file names present in a content root. */
  files: ReadonlySet<string>;
  /** Lowercased map names a settled unitsync scan reported. */
  names: ReadonlySet<string>;
  /** True once both readings have landed. */
  known: boolean;
}

/**
 * Whether the player already has this curated map.
 *
 * The same three comparisons `filterUninstalledMaps` makes for the get-started
 * card, so the two surfaces agree about what counts as installed: the catalog's
 * file name against the listing, and the spring name or the title against what
 * the engine can see.
 */
export function suggestedMapInstalled(
  map: SuggestedMap,
  inventory: MapInventory,
): boolean {
  const filename = map.filename?.toLowerCase();
  if (filename && inventory.files.has(filename)) return true;
  const springName = springNameOf(map)?.toLowerCase();
  if (springName && inventory.names.has(springName)) return true;
  return inventory.names.has(map.title.toLowerCase());
}

/** Whether the player has no maps at all, which is a definite answer or false. */
export function noMapsInstalled(inventory: MapInventory): boolean {
  return (
    inventory.known && inventory.files.size === 0 && inventory.names.size === 0
  );
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
 * The map to feature on a given day: the day's own map, or the next one along
 * that the player does not already have. Null when they have all of them.
 *
 * The day index steps the pool by one, so over any run of `pool.length` days
 * every curated map is reached exactly once and none is favoured.
 *
 * The walk forward is the whole of issue #1102. The card offers a map you do not
 * have, so a map you have is passed over, and the card leaves the page when
 * every candidate is passed over. What that gives up is stated where it was
 * decided: PR #1018 kept an installed map on the card and turned it into a link
 * to it, precisely so that everyone saw the same map on the same day, and two
 * players with different installs now see different maps. A card you cannot act
 * on is not worth the space on a launcher.
 *
 * Walking forward from the day's index rather than picking out of a
 * pre-filtered list is what keeps the answer steady while the page is open. A
 * filtered list is indexed by its own length, so installing any map at all
 * would renumber it and change the card to an unrelated map. Here, learning that
 * some other map is installed moves nothing, and the answer only changes when
 * the map on the card is the one that got installed.
 *
 * Takes the date rather than reading the clock, so a test can ask about any day.
 */
export function pickSuggestedMap(
  pool: SuggestedMap[],
  date: Date,
  inventory: MapInventory,
): SuggestedMap | null {
  if (pool.length === 0) return null;
  const day = utcDayIndex(date);
  // Two-step modulo: a date before 1970 gives a negative index, and JavaScript's
  // `%` keeps the sign.
  const start = ((day % pool.length) + pool.length) % pool.length;
  for (let step = 0; step < pool.length; step += 1) {
    const map = pool[(start + step) % pool.length];
    if (!suggestedMapInstalled(map, inventory)) return map;
  }
  return null;
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
  /** Where on the page the card goes, or that there is no card. */
  placement: SuggestedPlacement;
  /**
   * What the player has, as this answer read it.
   *
   * Carried with the answer rather than read again by the card, because the pick
   * and the card's own "Installed" badge are two statements about the same
   * inventory and two readings could disagree. It is also one directory listing
   * and one unitsync scan for the page rather than one per reader.
   */
  inventory: MapInventory;
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
 *
 * A map the player already has is no answer either, for the same reason the
 * rotation passes over one: this card offers a download. The busiest map they do
 * not have still beats the rotation.
 */
export function battleSuggestedMap(
  pool: SuggestedMap[],
  lobby: SuggestedLobbySnapshot | null,
  inventory: MapInventory,
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
    if (suggestedMapInstalled(map, inventory)) continue;
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
  inventory: MapInventory,
): { map: SuggestedMap | null; source: SuggestedSource } {
  const battle = battleSuggestedMap(pool, lobby, inventory);
  if (battle) return { map: battle, source: "battle" };
  return { map: pickSuggestedMap(pool, date, inventory), source: "curated" };
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
 * "Installed" is now mostly unreachable, and deliberately still here. The card
 * only ever offers a map the player does not have, so the only way it can be
 * looking at an installed map is that its own download just landed: the queue
 * reports `done` at once, and the inventory catches up a moment later when
 * {@link useMapInventory} re-reads it. That is the acknowledgement the button
 * owes the click, so the card holds its map and says so rather than skipping to
 * the next map in the rotation under the reader's hands.
 *
 * Pure, so the states the card can be in are testable without mounting it.
 */
export function suggestedMapState(args: {
  input: EnqueueInput | null;
  map: SuggestedMap | null;
  inventory: MapInventory;
  queueStatus: QueueStatus | null;
}): SuggestedState {
  const { input, map, inventory, queueStatus } = args;
  if (map && suggestedMapInstalled(map, inventory)) return "installed";
  const base = packMapState({
    input,
    filename: map?.filename,
    installed: inventory.files,
    queueStatus,
  });
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
 * Read off the placement, which is the one thing that knows whether there is a
 * card at all. A card that is not on the page must claim nothing, or a tool card
 * loses a picture to a card nobody can see, and since the card can now be absent
 * for three different reasons (no zone, nothing left to offer, the catalog said
 * nothing) that has to be one question rather than three.
 */
export function suggestedMapClaim(
  answer: SuggestedMapAnswer,
): readonly ContentPick[] {
  const springName =
    answer.placement === "absent" || !answer.map
      ? undefined
      : springNameOf(answer.map);
  return springName ? [{ kind: "map", mapName: springName }] : [];
}

/* -------------------------------------------------------------------------- *
 * Where the card goes, which is a page-level answer rather than a card's own.
 * -------------------------------------------------------------------------- */

/**
 * The three places the suggested map card can be.
 *
 * - `cards`: fourth in the tool grid's Downloads group, where a map suggestion
 *   is one download offer among the others. The ordinary answer.
 * - `row`: promoted into the top row, ahead of the continue hero and the resume
 *   rail. Getting a first map installed outranks resuming a run, because without
 *   a map nothing can be played.
 * - `absent`: no card. The profile left the zone out, or the catalog offers
 *   nothing, or the player already has everything it could offer.
 */
export type SuggestedPlacement = "cards" | "row" | "absent";

/** What the page is, as far as this card is concerned. */
export interface SuggestedPage {
  /** The page carries the suggested map zone. */
  zone: boolean;
  /**
   * The onboarding section is offering maps, or `null` while that is not known
   * yet.
   *
   * Not "the page lists the onboarding zone", which is the coarser question and
   * the one issue #1109 replaced. A zone that is on the page and saying nothing
   * suppressed a promotion that nothing was competing with, which is exactly the
   * player who dismissed the setup card and has no engine.
   *
   * Two halves, joined in `CoilboxHome`. Whether the zone is on the page at all
   * is the layout's, from the same list it renders from. Whether it is offering
   * maps is state, and it comes from `useGetStartedOffer`, the collector the
   * get-started card itself draws from. Neither zone reads the other. See {@link
   * suggestedMapPlacement}.
   */
  onboardingMaps: boolean | null;
}

/**
 * Where the card goes, given what the page carries and what the player has.
 *
 * Promotion is the unusual answer and it is deliberately narrow. Two things have
 * to be true: the player has no maps at all, and nothing else on the page is
 * already offering them one.
 *
 * The second is not a guess and not a second opinion. `GetStartedCard` lists
 * curated maps with a packs banner under them, and it is the better offer of the
 * two, so where it is making it this card stays in the Downloads group. Where it
 * is not, this card takes the top row. That covers the state a coarser question
 * missed: a player who dismissed "Set up Coilbox" and has no engine gets nothing
 * at all from onboarding, and used to get nothing here either because the zone
 * was still listed.
 *
 * Nobody sees both offers, and nobody sees neither.
 *
 * While the answer is still loading the card keeps the place the profile gave
 * it, so the placeholder holds the Downloads row's height (issue #1083) and the
 * card never appears in one place and then moves to another. An unknown
 * `onboardingMaps` is part of that wait and the caller folds it into `loading`.
 * The `=== false` here says the same thing again, so a caller that did not
 * cannot promote on a question nobody has answered.
 */
export function suggestedMapPlacement(args: {
  page: SuggestedPage;
  loading: boolean;
  map: SuggestedMap | null;
  /** Whether the player has no maps at all. See {@link noMapsInstalled}. */
  noMaps: boolean;
}): SuggestedPlacement {
  if (!args.page.zone) return "absent";
  if (args.loading) return "cards";
  if (!args.map) return "absent";
  return args.noMaps && args.page.onboardingMaps === false ? "row" : "cards";
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
 * The answer is held for the day, once it is a real answer.
 *
 * Three things move under this card while it is on screen, and it should sit
 * still through all of them. `mirror.state.battles` changes every time anyone
 * anywhere joins or leaves a room, which on a busy server is several times a
 * second. The inventory changes the moment any download lands, including the
 * card's own. And the pool the two are read against changes with them. An
 * unheld card would swap its picture, name and blurb under a reader who is
 * looking at it, and worst of all it would do that the instant they pressed
 * Install, which is the one moment the card owes them an answer about the map
 * they just asked for.
 *
 * So the first real answer of the day is kept, and the day is what releases it:
 * {@link useUtcDay} turns the card over at UTC midnight where it stands (issue
 * #1022) and the hold turns over with it. Nothing is held before the catalog and
 * the inventory have both answered, because a held guess is a guess kept all
 * session.
 *
 * The one thing that may still replace a held answer is the lobby's, once, and
 * only over the rotation's. A connection settles seconds after the page paints,
 * so an unheld first answer would otherwise mean the card could never prefer a
 * map people are on (issue #996). After that first upgrade the lobby is ignored,
 * which is what stops the card following the server's churn.
 */
export function useSuggestedMap(page: SuggestedPage): SuggestedMapAnswer {
  const catalogLists = useSuggestedMapLists();
  const maps = useSuggestedMaps();
  const loaded = useCatalogLoaded();
  const inventory = useMapInventory();
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
  // The onboarding offer is part of being ready, because the answer is held for
  // the day the moment it is real and a placement taken before onboarding has
  // spoken would be held all day. It is the same two reads the inventory waits
  // on, so on the ordinary path this adds no wait.
  const ready = loaded && inventory.known && page.onboardingMaps !== null;
  const fresh = useMemo(
    () => suggestedMapFor(pool, mirror.state, today, inventory),
    [pool, mirror.state, today, inventory],
  );
  const placement = suggestedMapPlacement({
    page,
    loading: !ready,
    map: fresh.map,
    noMaps: noMapsInstalled(inventory),
  });

  const [held, setHeld] = useState<Held | null>(null);
  useEffect(() => {
    if (!ready) return;
    // Returning `prev` unchanged lets React bail out of the re-render for every
    // lobby delta and every download that lands.
    setHeld((prev) => holdSuggestion(prev, day, { ...fresh, placement }));
  }, [ready, day, fresh, placement]);

  const settled = held?.day === day ? held : null;
  return useMemo(
    () => ({
      map: ready ? (settled?.map ?? fresh.map) : null,
      loading: !ready,
      source: settled?.source ?? fresh.source,
      placement: settled?.placement ?? placement,
      inventory,
    }),
    [ready, settled, fresh, placement, inventory],
  );
}

/** The answer this mount is holding, and the day it is the answer for. */
interface Held {
  day: number;
  map: SuggestedMap | null;
  source: SuggestedSource;
  placement: SuggestedPlacement;
}

/**
 * Keep what is held, or take the new answer. Pure, so the day boundary and the
 * one lobby upgrade are testable without a clock or a connection.
 */
export function holdSuggestion(
  prev: Held | null,
  day: number,
  answer: Omit<Held, "day">,
): Held {
  if (!prev || prev.day !== day) return { day, ...answer };
  if (prev.source !== "battle" && answer.source === "battle")
    return { day, ...answer };
  return prev;
}

/**
 * What the player has, re-read whenever the download queue finishes anything.
 *
 * The two inventories are the ones every other install check in the app uses, so
 * a map fetched from the maps page or a pack counts here without this being told
 * about it. Neither is allowed to answer until it has actually read something:
 * an unloaded content root and an unfinished scan both look exactly like an
 * empty install, and this card acts on "the player has no maps" by taking the
 * top of the page.
 */
export function useMapInventory(): MapInventory {
  const { paths, loading: rootsLoading } = useContentRoots();
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [files, setFiles] = useState<ReadonlySet<string> | null>(null);

  const refresh = useCallback(async () => {
    if (paths.length === 0) return;
    try {
      const { maps } = await dlInstalledContent({ paths });
      setFiles(new Set(maps));
    } catch {
      // Leave the last listing in place. A failed read is not a report that the
      // user has nothing, and treating it as one re-offers an installed map.
    }
  }, [paths]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useDownloadComplete(refresh);

  // A target that has resolved but not scanned yet is the case to wait for. See
  // {@link scanSettled}, which the get-started offer waits on too so that the
  // two cannot disagree about whether the inventory has answered.
  const scanKnown = scanSettled({
    targetLoading,
    hasTarget: !!(target?.enginePath && target?.dataDir),
    scan,
  });

  return useMemo(
    () => ({
      files: files ?? EMPTY_NAMES,
      names: new Set((scan.data?.maps ?? []).map((m) => m.name.toLowerCase())),
      known:
        (files !== null || (!rootsLoading && paths.length === 0)) && scanKnown,
    }),
    [files, rootsLoading, paths.length, scan.data, scanKnown],
  );
}

/** One empty set, so an unread inventory is not a new object every render. */
const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

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
 * The suggested map's own picture: the catalog's `thumb`, through the same Rust
 * image proxy and disk cache the download browsers use. Fetched once, then
 * available offline.
 *
 * Deliberately not {@link ./art}'s `resolveCardArt`. That chain answers "what
 * should the card for a *tool* show", keyed by nav id and floored by a
 * procedural pattern seeded from that id. This card is about one named map, and
 * the only honest art for a named map is a picture of it. A procedural swirl
 * under a map's name would be a picture of nothing.
 *
 * One source, and there used to be two. The other was the engine's own minimap
 * of the archive on disk, which is a better picture and is only available for a
 * map the player has. The card now only ever names a map they do not have
 * (issue #1102), so it was never asked for, and everything built to stop the two
 * sources swapping under a reader (issues #1095, #1100, PR #1101) went with it.
 *
 * What survives that is the card's own download landing while it is still on
 * screen, which does put an installed map under this hook. It stays on the
 * thumbnail it is already painting: it is a picture of the same map, the card is
 * about to be replaced by the next launch anyway, and reaching for the minimap
 * there would mean rendering a full-size map image to change a picture into
 * another picture of the same thing.
 *
 * `thumb` is optional on a curated map, and a map that arrived through a pack had
 * none, so for most of the rotation there was nothing for this to resolve and the
 * card came up blank (issue #1037). {@link suggestedMapPool} passes over a map
 * the catalog cannot picture, so a thumbnail the editor forgot costs a map its
 * turn in the rotation rather than costing a reader their card (issue #1070).
 *
 * On a cold offline first run there is nothing to fetch, and the card renders
 * without art on its plain surface rather than reaching for a third source.
 */
export function useSuggestedMapArt(
  map: SuggestedMap | null,
  broken: string | null = null,
): string | undefined {
  const thumb = useCachedImage(map?.thumb, true);
  return thumb && thumb !== broken ? thumb : undefined;
}

/**
 * Whether the user already has this map, whether a download is under way, and
 * how to start one.
 *
 * The inventory arrives with the page's answer rather than being read again
 * here, because the pick and this badge are two statements about the same two
 * listings and two readings of them could disagree. It re-reads itself whenever
 * the download queue finishes anything, which is what turns this card's own
 * Install button into "Installed" the moment its download lands.
 */
export function useSuggestedMapInstall(
  map: SuggestedMap | null,
  inventory: MapInventory,
): {
  state: SuggestedState;
  /** The queue's message for a failed download, when there is one. */
  error: string | null;
  /** False when there is nowhere to download to, and while that is still unread. */
  canDownload: boolean;
  /**
   * True only once the download folder has been read and there is none.
   *
   * Separate from `!canDownload`, which is also false for the frame or two the
   * read takes. That is the whole of issue #1099: the card told a configured
   * user to set a folder they had already set, every launch, until the read
   * landed.
   */
  noWriteRoot: boolean;
  download: () => void;
} {
  const writeRoot = useWriteRoot();
  const writePath = writeRoot.path;
  const { enqueue, statusFor, items } = useDownloadQueue();

  const input = map ? suggestedMapToInput(map, writePath) : null;
  const identity = input ? identityOf(input) : null;
  const queueStatus = identity ? statusFor(identity) : null;
  const state = map
    ? suggestedMapState({ input, map, inventory, queueStatus })
    : "unavailable";
  const error =
    items.find((i) => i.identity === identity && i.error)?.error ?? null;

  return {
    state,
    error,
    canDownload: !!writePath,
    noWriteRoot: !writeRoot.loading && !writePath,
    download: () => {
      if (input) enqueue(input);
    },
  };
}
