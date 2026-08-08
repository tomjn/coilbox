/**
 * Step 2 of the card-art chain: art derived from what is actually installed and
 * played on this machine.
 *
 * A card for Singleplayer shows the minimap of the map sitting in your saved
 * setup. Maps shows one of the maps you have. Games shows one of your games.
 * Nothing here is drawn: PR #982 already renders minimaps and loading-screen art
 * to a disk cache and serves them over `coilbox://`, so this module picks the
 * content and hands back that URL.
 *
 * ## When real content beats the illustration, and when it does not
 *
 * The illustration is the default. Real content has to earn its place by saying
 * something the drawing cannot (issues #1036, #1039, #1040).
 *
 * A minimap on Singleplayer earns it: it tells you which map is loaded in your
 * setup, which no drawing of two armies can. The same minimap on Campaigns,
 * Scenarios and Replays earns nothing, because it is the same picture and so
 * carries no information at all once repeated, while the drawings it displaced
 * were six different pictures. That is why {@link PICK_PRIORITY} exists.
 *
 * Warpath earns nothing at any priority, so it offers no content: a run is a
 * journey across a galaxy and one battle's map is a fact about a fight the card
 * does not stand for. Its diamond lattice says more, and rendering the run
 * itself is issue #1023 on another milestone.
 *
 * A card standing for a collection is the opposite case: the collection is
 * nothing but its members, so any member is a fair picture of it. Maps and Games
 * therefore offer every installed map and game, best first.
 *
 * ## Solving a synchronous source over asynchronous data
 *
 * {@link CardArtSource} is synchronous and every answer here is behind an IPC
 * call, so the two are bridged by a module-level cache and an explicit refresh:
 *
 * 1. {@link contentCardArt} reads the cache and nothing else. It never waits,
 *    never starts work, and answers `undefined` while the cache is cold, which
 *    the chain treats as "nothing from me" and falls through to the bundled
 *    illustration and then to the procedural floor. So first paint is never held
 *    up, and a cold cache is invisible rather than blank. On the second and every
 *    later launch it answers from {@link rememberContentArt} instead of nothing,
 *    which is what stops the cards changing picture a beat after they paint.
 * 2. `useContentCardArt` in {@link ./useContentCardArt} does the asynchronous
 *    half. It reads the stores that know what you played, resolves each pick to
 *    a URL, and calls {@link publishContentArt}.
 * 3. Publishing bumps a version that the same hook subscribes to, so the home
 *    page re-renders and every card re-asks the chain. The cards themselves stay
 *    ignorant. They call `resolveCardArt` and get a better answer than they did
 *    a moment ago.
 *
 * The hook is mounted once, by `CoilboxHome`, above the layout. That is what
 * makes step 3 work: the re-render has to happen above the cards, and a zone
 * cannot re-render its siblings.
 *
 * The hook lives in its own file so that this one imports nothing but types and
 * pure helpers. `art.ts` registers the source, so whatever this file pulls in
 * lands in the import graph of every test that touches the chain, and the chain
 * is meant to unit test without a DOM or a Tauri bridge.
 *
 * Splitting it this way also keeps the interesting part testable. Which content
 * each tool shows is {@link contentPicks}, a pure function of plain data, so
 * "this install has no replays" is a unit test rather than a mocked IPC bridge.
 *
 * ## Remembering what the last launch painted
 *
 * That chain costs a visible change on every launch: the cards paint their
 * illustrations, then a unitsync worker renders a minimap and they swap (issue
 * #1056). The pictures are the same pictures nearly every time, so the page has
 * the right answer already and is just not allowed to say it yet.
 *
 * So it is written down. {@link rememberContentArt} holds what the last launch
 * resolved, read from `localStorage` by {@link loadContentArt} during boot, and
 * {@link contentCardArt} answers from it until this launch's own resolve lands.
 * `localStorage` is synchronous and already in memory, which is what makes this
 * legal at all: the rule that first paint must never wait on a disk read still
 * holds, and `index.html` and `profile.ts` already read the boot background the
 * same way. The key is per install, because two installs on one machine share
 * `localStorage` but share no content. See {@link contentArtStorageKey}.
 *
 * A remembered URL is last launch's answer, and last launch is not this one, so
 * it is a claim to be checked rather than a fact:
 *
 * - {@link pruneRemembered} drops an entry the moment this launch's own picks
 *   disagree with it. A card whose map changed shows its illustration and then
 *   the new map, which is the old behaviour, rather than showing the old map as
 *   though it were current. Wrong is worse than late: that is the whole reason a
 *   plain URL cache was rejected.
 * - It drops an entry whose picture this launch has given to another card, or
 *   which the suggested map has claimed, so a warm start cannot put one picture
 *   on two cards where a cold start would not. Priority stays
 *   {@link PICK_PRIORITY} and never render order.
 * - {@link forgetContentArt} drops an entry whose image fails to load, which is
 *   what an evicted cache file looks like from here. The card falls back through
 *   the chain to its illustration rather than to the icon-only card.
 *
 * Nothing here is a second opinion about which card shows what. The snapshot is
 * one past {@link contentPicks} assignment, and every rule above is a reason to
 * stop trusting part of it.
 *
 * ## Where a card learns what its siblings picked
 *
 * Here, in {@link contentPicks}. It is already the only function that sees the
 * whole page at once, because the content step is published page-wide by one
 * hook above the layout rather than resolved per zone, so making the picks aware
 * of each other cost no new plumbing.
 *
 * That is a deliberate exception to the rule that a zone must not read another
 * zone's state, and it is narrower than it sounds. No zone learns anything: a
 * card still calls `resolveCardArt(id)` and gets one answer. What changed is
 * that the answer is now computed for the page rather than for the card, which
 * is what art is. Four cards each individually showing the right map is still a
 * page showing one picture four times, and no card can see that from inside
 * itself.
 *
 * The suggested map's card is on that page too, and is not a tool. It reaches
 * the catalog and the lobby mirror, neither of which may be imported here, so it
 * arrives already decided, as `claimed`: one more picture that is spoken for. See
 * {@link ContentPickSources.claimed}.
 *
 * ## Where the picks come from, and where they deliberately differ
 *
 * The campaign and skirmish picks answer a different question from
 * `src/home/continue.ts` on purpose.
 * "Resume" wants a mission left mid-attempt and a preset with a timestamp on it.
 * A picture wants the last thing you touched, finished or not. So the campaign
 * pick reads `lastPlayedMissionId`, which still has an answer once you have
 * completed everything, and the skirmish pick reads the working draft, which
 * `continue.ts` cannot rank because it carries no timestamp but which is the
 * truest statement of what your Singleplayer screen currently holds.
 *
 * ## Real pictures under card text
 *
 * A minimap of a desert map is bright, a night map's is nearly black, and card
 * text sits over both. This module repaints neither, for a reason worth stating:
 * step 1 of the chain is a distribution's own image file (issue #1000), which
 * Coilbox cannot touch at all, so a card that only reads when its art happens to
 * land the right way is already broken and no source can fix that from its own
 * side. Legibility over arbitrary art belongs to whatever paints the text over
 * it, and `cardShell.ts` measures it against both ends of what a picture can be. {@link CardArt} carries the
 * step that answered, so a card can tell a photograph from the procedural field
 * and scrim accordingly.
 *
 * What this module does do is pick the mip level that helps. Minimaps are
 * requested at mip 3, a 128px render, which is the same entry the maps grid
 * fills, so on any install where Content > Maps has been opened the home page
 * renders nothing new at all. Upscaled behind a card it also reads as a soft
 * wash of the terrain rather than as detail competing with the label.
 */

import type { Campaign, ProgressFile } from "../campaign/model";
import { hashString } from "../conquest/rng";
import type { CardArtSource } from "./art";

/* -------------------------------------------------------------------------- *
 * The pure half: which content each tool's card should picture.
 * -------------------------------------------------------------------------- */

/**
 * What a card should show, before anything renders it.
 *
 * Two kinds because there are two renderers behind them: a map name resolves
 * through unitsync's minimap cache, a game name through its header-art cache.
 */
export type ContentPick =
  | { kind: "map"; mapName: string }
  | { kind: "game"; gameName: string };

/** The fields of a saved skirmish setup a pick reads. */
export type DraftSummary = { gameName: string; mapName: string };

/** The fields of a replay listing a pick reads. */
export type ReplaySummary = { mapName?: string };

/** The fields of a scenario a pick reads. */
export type ScenarioSummary = { setup: { mapName: string } };

/** The one field of an installed map or game a collection pick reads. */
export type NamedContent = { name: string };

/** Everything {@link contentPicks} reads. */
export interface ContentPickSources {
  draft: DraftSummary;
  /** Replays newest first, which is the order `contentListReplays` returns. */
  replays: readonly ReplaySummary[];
  campaigns: readonly { campaign: Campaign }[];
  progress: ProgressFile;
  /** Scenarios newest edit first, which is the order `useScenarios` returns. */
  scenarios: readonly { scenario: ScenarioSummary }[];
  /** Every installed map, as the unitsync scan lists them. */
  maps: readonly NamedContent[];
  /** Every installed game, as the unitsync scan lists them. */
  games: readonly NamedContent[];
  /**
   * Tools a distribution has already given art, which take no part in the
   * sibling set (issue #1000).
   *
   * An overridden card will never paint what this module picks for it, because
   * the override is step 1 and this is step 2. Leaving it in the priority list
   * would let it take a map off a card that would have shown it, and gain
   * nobody anything. So an overridden tool makes no offer at all, and the
   * picture it would have claimed falls to the next card that wants it.
   */
  overridden?: ReadonlySet<string>;
  /**
   * Content a card outside this set is already showing (issue #1055).
   *
   * The suggested map's card is the one on the page that is not a tool, so it
   * has no tool id, takes no part in {@link PICK_PRIORITY}, and has no second
   * map to fall back on: it is about one named map and nothing else. It is also
   * the card most likely to collide, because a curated map is one an install is
   * likely to have. So it takes its map before the priority list is walked, and
   * every card in the list settles around it.
   *
   * Pre-taken rather than first in the priority list, which is the same
   * exclusion PR #1072 made from the other direction: `overridden` is a card
   * that cannot use a picture, this is a picture no card may use.
   */
  claimed?: readonly ContentPick[];
}

/** The map your saved Singleplayer setup is pointed at. */
export function skirmishPick(draft: DraftSummary): ContentPick | undefined {
  return draft.mapName ? { kind: "map", mapName: draft.mapName } : undefined;
}

/** The game your saved Singleplayer setup is pointed at. */
export function gamePick(draft: DraftSummary): ContentPick | undefined {
  return draft.gameName
    ? { kind: "game", gameName: draft.gameName }
    : undefined;
}

/**
 * The map of your most recent replay.
 *
 * The listing is already newest first and carries the map name, so this needs no
 * demo decode. A replay whose header could not be read has no `mapName`, and the
 * one behind it answers instead rather than the card going blank.
 */
export function replayPick(
  replays: readonly ReplaySummary[],
): ContentPick | undefined {
  const named = replays.find((r) => r.mapName);
  return named?.mapName ? { kind: "map", mapName: named.mapName } : undefined;
}

/**
 * The map of the mission you last played, in the campaign you last touched.
 *
 * Progress is the index rather than the campaign list, because a campaign you
 * have never opened says nothing about you. An unreadable timestamp is dropped
 * the way `rankCandidates` drops one, so the pick cannot turn on a `NaN`
 * comparison.
 */
export function campaignPick(
  campaigns: readonly { campaign: Campaign }[],
  progress: ProgressFile,
): ContentPick | undefined {
  let bestAt = -Infinity;
  let bestMap: string | undefined;
  for (const { campaign } of campaigns) {
    const saved = progress.campaigns[campaign.id];
    if (!saved?.lastPlayedMissionId) continue;
    const at = Date.parse(saved.updatedAt);
    if (!Number.isFinite(at) || at <= bestAt) continue;
    const mission = campaign.missions.find(
      (m) => m.id === saved.lastPlayedMissionId,
    );
    const mapName = mission?.snapshot?.mapName;
    if (!mapName) continue;
    bestAt = at;
    bestMap = mapName;
  }
  return bestMap ? { kind: "map", mapName: bestMap } : undefined;
}

/** The map of the scenario you edited most recently. */
export function scenarioPick(
  scenarios: readonly { scenario: ScenarioSummary }[],
): ContentPick | undefined {
  const named = scenarios.find((s) => s.scenario.setup.mapName);
  const mapName = named?.scenario.setup.mapName;
  return mapName ? { kind: "map", mapName } : undefined;
}

/**
 * Every member of a collection, in a deterministic order.
 *
 * A collection card can honestly show any member, so it offers all of them and
 * lets {@link assignPicks} take the first one no other card wanted. That is also
 * why these cards can never be the ones left without art by a collision: there
 * is always another map.
 *
 * The order is the sorted names rotated by a hash of the names themselves, so
 * two installs with the same content agree, the answer does not move between
 * renders or between launches, and installing something new does move it. The
 * sort is what makes it independent of the order unitsync happened to scan in.
 *
 * Seeding off the day was the alternative. It varies more, but it changes the
 * page under a session that is open across midnight, and it makes every test of
 * this function need a clock.
 */
export function collectionPicks(
  items: readonly NamedContent[],
  kind: ContentPick["kind"],
): readonly ContentPick[] {
  const names = [...new Set(items.map((i) => i.name).filter(Boolean))].sort();
  if (names.length === 0) return [];
  const start = hashString(names.join("\n")) % names.length;
  return names.map((_, i) => {
    const name = names[(start + i) % names.length];
    return kind === "map"
      ? { kind: "map", mapName: name }
      : { kind: "game", gameName: name };
  });
}

/**
 * The tools that offer content, in the order they get first refusal on it.
 *
 * A declared order rather than the order the cards render in, so the page does
 * not depend on which zone painted first and a test can assert one answer.
 *
 * The ranking is how strongly the picture is about the card, following the rule
 * at the head of this file. Your skirmish setup's map is the setup. Your newest
 * replay's map is where that match was fought. A scenario's map is the ground it
 * is set on. A campaign's is one stop on a journey the road drawing describes
 * better, so it yields to all three. The two collection cards come last because
 * they are the only ones that lose nothing by yielding: they have another
 * member to offer.
 */
export const PICK_PRIORITY: readonly string[] = [
  "play.skirmish",
  "play.replays",
  "scenario.list",
  "campaign.list",
  "content.games",
  "content.maps",
];

/** What each tool would show, best first, before the collisions are settled. */
export function contentOffers(
  sources: ContentPickSources,
): Map<string, readonly ContentPick[]> {
  const offers = new Map<string, readonly ContentPick[]>();
  const add = (toolId: string, picks: readonly ContentPick[]) => {
    if (sources.overridden?.has(toolId)) return;
    if (picks.length > 0) offers.set(toolId, picks);
  };
  const one = (pick: ContentPick | undefined) => (pick ? [pick] : []);
  add("play.skirmish", one(skirmishPick(sources.draft)));
  add("play.replays", one(replayPick(sources.replays)));
  add("scenario.list", one(scenarioPick(sources.scenarios)));
  add("campaign.list", one(campaignPick(sources.campaigns, sources.progress)));
  // The game in your saved setup first, then the rest of the shelf. It is a
  // member of the collection like any other, and it is the one you play.
  add("content.games", [
    ...one(gamePick(sources.draft)),
    ...collectionPicks(sources.games, "game"),
  ]);
  add("content.maps", collectionPicks(sources.maps, "map"));
  return offers;
}

/**
 * A piece of content, as one string. Maps and games are separate namespaces.
 *
 * Case-insensitive, because the names being compared do not all come from the
 * same place. A card's own pick is a unitsync scan name, while a claim from the
 * suggested map is the spring name the catalog downloads it by, and the two are
 * written by different hands. `suggestedMapState` already compares them
 * lowercased for the same reason. Two installed maps whose names differ only in
 * case are the same map to a reader either way.
 */
function contentKey(pick: ContentPick): string {
  const name = pick.kind === "map" ? pick.mapName : pick.gameName;
  return `${pick.kind === "map" ? "m" : "g"}:${name.toLowerCase()}`;
}

/**
 * Give each tool the best picture no tool above it has already taken.
 *
 * A tool whose every candidate is taken gets nothing and falls through to its
 * illustration, which is the right answer rather than a compromise: the second
 * copy of a picture carries none of the information the first one did, and the
 * drawing it displaced carried some.
 *
 * `claimed` starts the taken set off, so a picture already on the page outside
 * this set is spoken for before the walk begins. The walk itself is unchanged,
 * and the answer still depends on {@link PICK_PRIORITY} alone and never on which
 * zone rendered first.
 */
export function assignPicks(
  offers: ReadonlyMap<string, readonly ContentPick[]>,
  claimed: readonly ContentPick[] = [],
): Map<string, ContentPick> {
  const taken = new Set<string>(claimed.map(contentKey));
  const picks = new Map<string, ContentPick>();
  for (const toolId of PICK_PRIORITY) {
    const free = offers.get(toolId)?.find((p) => !taken.has(contentKey(p)));
    if (!free) continue;
    taken.add(contentKey(free));
    picks.set(toolId, free);
  }
  return picks;
}

/**
 * Every tool with something real to show, and what it should show.
 *
 * Coverage is deliberately partial, and a tool absent from the result falls
 * through to the bundled illustration and then to the procedural field, so a gap
 * here is a local decision with no chain consequences.
 */
export function contentPicks(
  sources: ContentPickSources,
): Map<string, ContentPick> {
  return assignPicks(contentOffers(sources), sources.claimed);
}

/** A stable string for a set of picks, so an effect can depend on their value. */
export function picksKey(picks: ReadonlyMap<string, ContentPick>): string {
  return [...picks]
    .map(([toolId, p]) =>
      p.kind === "map"
        ? `${toolId}=m:${p.mapName}`
        : `${toolId}=g:${p.gameName}`,
    )
    .sort()
    .join("|");
}

/* -------------------------------------------------------------------------- *
 * The cache the synchronous source reads.
 * -------------------------------------------------------------------------- */

/** Tool id to resolved art URL, as this launch resolved it. */
let urls: ReadonlyMap<string, string> = new Map();

/**
 * What the last launch painted, which stands in until this one has an answer.
 * Filled at the foot of this file, where everything that reads it also lives.
 *
 * Declared here, above {@link contentCardArt}, rather than beside the rest of
 * it. A `let` is unreachable until its declaration runs, and Vite's hot reload
 * can re-evaluate this module while React is part way through a render, which
 * put a card's render between the two and threw.
 */
let remembered: ReadonlyMap<string, RememberedArt> = new Map();

/** The text last written, so an unchanged snapshot is not written again. */
let written: string | undefined;

/** Bumped whenever the cache changes value, for the store subscription. */
let version = 0;

const listeners = new Set<() => void>();

/**
 * Step 2 of the chain.
 *
 * Deliberately does nothing but two map lookups. It runs during a card's render,
 * so anything else here would be work on the paint path. This launch's own answer
 * wins, and the remembered one stands in until it arrives. `undefined` when
 * neither has anything, and for every tool this module has no answer for.
 */
export const contentCardArt: CardArtSource = ({ toolId }) =>
  urls.get(toolId) ?? remembered.get(toolId)?.url;

/**
 * Replace the cache and wake the subscribers.
 *
 * Compared by value first. The effect that publishes runs after the render it
 * caused, so waking on an unchanged answer would loop forever.
 *
 * `picks` is what the URLs are pictures of, which is what makes them worth
 * writing down, because a URL alone cannot be checked against a later launch. A
 * caller with no picks to declare publishes nothing new to remember and carries
 * the existing snapshot forward.
 */
export function publishContentArt(
  next: ReadonlyMap<string, string>,
  picks: ReadonlyMap<string, ContentPick> = new Map(),
): void {
  remember(rememberedFrom(next, picks, remembered));
  if (sameUrls(urls, next)) return;
  urls = next;
  wake();
}

function sameUrls(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Empty the cache and the snapshot it was standing on. For tests, and for a hard
 * content refresh.
 *
 * Stored text is left alone. Emptying memory is a request to resolve everything
 * again, and the resolve writes the snapshot back, so deleting it here would only
 * cost the next launch its first paint if this one never finished.
 */
export function resetContentArt(): void {
  urls = new Map();
  remembered = new Map();
  written = undefined;
  wake();
}

/** Bump the version and wake the subscribers. */
function wake(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Subscribe to cache changes. The store half of `useSyncExternalStore`. */
export function subscribeContentArt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The cache's current version. The snapshot half of `useSyncExternalStore`. */
export function contentArtVersion(): number {
  return version;
}

/* -------------------------------------------------------------------------- *
 * What the last launch painted, so this one paints it at once.
 * -------------------------------------------------------------------------- */

/** A picture a card painted last launch, and what it was a picture of. */
export interface RememberedArt {
  pick: ContentPick;
  url: string;
}

/** Where the snapshot is kept, alongside the theme and the boot background. */
const STORAGE_KEY = "coilbox.home.contentArt";

/**
 * The key this install keeps its snapshot under.
 *
 * `localStorage` is keyed by the app identifier and is not redirected by portable
 * mode, the same fact `profile.ts` records for the theme keys. So a distribution
 * shipped inside a game and the player's ordinary install share one store while
 * sharing no content at all, and each pruned the other down to what it could see:
 * one launch of a portable package with an empty inventory left the ordinary
 * install's next launch three pictures short (issue #1115).
 *
 * The theme keys live with that sharing by rewriting authoritatively every
 * launch, so the distribution's brand simply always wins. A cache has no such
 * answer, because both installs are right about their own content, so it gets a
 * key each instead. A non-portable install keeps the bare key, so nothing already
 * remembered is lost to this.
 */
export function contentArtStorageKey(portableRoot: string): string {
  return portableRoot ? `${STORAGE_KEY}:${portableRoot}` : STORAGE_KEY;
}

/** The resolved key, set by {@link loadContentArt} before the first render. */
let storageKey = STORAGE_KEY;

/** What the last launch painted. For the hook that prunes it, and for tests. */
export function rememberedContentArt(): ReadonlyMap<string, RememberedArt> {
  return remembered;
}

/**
 * Take a snapshot as the starting point, without writing it back.
 *
 * What the module does at load with the stored text, and what a test does with a
 * snapshot it wrote by hand.
 */
export function rememberContentArt(
  entries: ReadonlyMap<string, RememberedArt>,
): void {
  remembered = entries;
  wake();
}

/** Hold a snapshot and write it down, if it says anything new. */
function remember(entries: ReadonlyMap<string, RememberedArt>): void {
  remembered = entries;
  const text = encodeRemembered(entries);
  if (text === written) return;
  written = text;
  try {
    localStorage.setItem(storageKey, text);
  } catch {
    // No storage (a test's node environment, or a webview with it switched
    // off). Everything above still works, this launch simply teaches the next
    // one nothing.
  }
}

/**
 * Drop everything in the snapshot this launch has since contradicted.
 *
 * Called from a render rather than an effect, and does not wake the subscribers.
 * It is called above the layout, so the cards render after it in the same pass
 * and see the pruned answer without a second render. That is what keeps a
 * contradicted picture from ever being painted once the contradiction is known,
 * which is the whole point of pruning rather than just caching. Safe from a
 * render for the reason `publishArtOverrides` is: it only ever removes, so
 * running it twice on one value gives the same answer as running it once.
 *
 * Not written back to storage. The resolve that follows publishes and writes the
 * whole snapshot anyway, and a launch that never gets that far has learned
 * nothing worth teaching the next one.
 */
export function validateRememberedArt(
  picks: ReadonlyMap<string, ContentPick>,
  claimed: readonly ContentPick[] = [],
): void {
  if (remembered.size === 0) return;
  const kept = pruneRemembered(remembered, picks, claimed);
  if (kept.size !== remembered.size) remembered = kept;
}

/**
 * Which remembered entries this launch has not contradicted.
 *
 * Three ways to lose one, and all three are the snapshot being checked against
 * the answer this launch worked out for itself rather than a fourth opinion
 * about who shows what:
 *
 * 1. The card has picked something else. Its map changed, so the remembered one
 *    is last launch's answer being shown as though it were this one's.
 * 2. Another card has been given that picture. Priority is
 *    {@link PICK_PRIORITY}, so this is the same collision `assignPicks` settles,
 *    caught on the way in.
 * 3. The suggested map has claimed it, which is the same exclusion again from
 *    outside the grid.
 *
 * A card this launch has no pick for yet keeps its picture. That is the ordinary
 * state of the first few hundred milliseconds, when the stores behind the picks
 * have not answered, and it is the case the whole snapshot exists for.
 */
export function pruneRemembered(
  entries: ReadonlyMap<string, RememberedArt>,
  picks: ReadonlyMap<string, ContentPick>,
  claimed: readonly ContentPick[] = [],
): Map<string, RememberedArt> {
  const owner = new Map<string, string>();
  for (const [toolId, pick] of picks) owner.set(contentKey(pick), toolId);
  const spoken = new Set(claimed.map(contentKey));
  const kept = new Map<string, RememberedArt>();
  for (const [toolId, entry] of entries) {
    const key = contentKey(entry.pick);
    if (spoken.has(key)) continue;
    const now = owner.get(key);
    if (now !== undefined && now !== toolId) continue;
    const fresh = picks.get(toolId);
    if (fresh && contentKey(fresh) !== key) continue;
    kept.set(toolId, entry);
  }
  return kept;
}

/**
 * The snapshot to keep, given what this launch has just resolved.
 *
 * What it resolved, plus whatever the old snapshot still holds for a card it has
 * not answered for. The carry-forward matters because the stores behind the
 * picks settle at different times, so the first publish of a launch is often one
 * card, and overwriting the snapshot with it would cost every other card its
 * head start on the launch after.
 *
 * A picture goes in once. This launch's answers are one {@link contentPicks}
 * assignment and so already agree with each other, and a carried entry yields to
 * them, so the snapshot cannot hand two cards the same picture next launch.
 */
export function rememberedFrom(
  resolved: ReadonlyMap<string, string>,
  picks: ReadonlyMap<string, ContentPick>,
  entries: ReadonlyMap<string, RememberedArt>,
): Map<string, RememberedArt> {
  const next = new Map<string, RememberedArt>();
  const taken = new Set<string>();
  for (const [toolId, url] of resolved) {
    const pick = picks.get(toolId);
    // A URL with no pick behind it cannot be checked next launch, so it is not
    // worth remembering.
    if (!pick) continue;
    next.set(toolId, { pick, url });
    taken.add(contentKey(pick));
  }
  for (const [toolId, entry] of entries) {
    if (next.has(toolId)) continue;
    const key = contentKey(entry.pick);
    if (taken.has(key)) continue;
    next.set(toolId, entry);
    taken.add(key);
  }
  return next;
}

/**
 * Forget a picture that would not load.
 *
 * A remembered URL names a file in a cache that something else is free to
 * evict, and an evicted file is indistinguishable from a working one until the
 * card tries to paint it. Dropping it here rather than in the card is what sends
 * that card back through the chain to its illustration, instead of to the
 * icon-only card the card's own fallback would leave it on.
 *
 * This launch's own answers are dropped too. They are rendered on demand and so
 * are almost never the ones that fail, but a URL that does not load is not art
 * whichever half of this module produced it.
 */
export function forgetContentArt(url: string): void {
  const keptUrls = new Map([...urls].filter(([, u]) => u !== url));
  const keptEntries = new Map(
    [...remembered].filter(([, entry]) => entry.url !== url),
  );
  if (keptUrls.size === urls.size && keptEntries.size === remembered.size)
    return;
  urls = keptUrls;
  remember(keptEntries);
  wake();
}

/** The snapshot as one line of JSON. */
export function encodeRemembered(
  entries: ReadonlyMap<string, RememberedArt>,
): string {
  return JSON.stringify({
    version: 1,
    entries: [...entries].map(([tool, { pick, url }]) => ({
      tool,
      kind: pick.kind,
      name: pick.kind === "map" ? pick.mapName : pick.gameName,
      url,
    })),
  });
}

/**
 * Read a snapshot back.
 *
 * Anything it does not recognise is nothing at all rather than a partial answer.
 * The whole snapshot is one page's worth of pictures that agree with each other,
 * so half of one is not a safer version of it, and the cost of answering nothing
 * is one launch of the behaviour every launch had before this existed.
 */
export function decodeRemembered(
  text: string | null,
): Map<string, RememberedArt> {
  const empty = () => new Map<string, RememberedArt>();
  if (!text) return empty();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty();
  }
  if (typeof parsed !== "object" || parsed === null) return empty();
  const { version: v, entries } = parsed as {
    version?: unknown;
    entries?: unknown;
  };
  if (v !== 1 || !Array.isArray(entries)) return empty();
  const out = empty();
  for (const raw of entries) {
    if (typeof raw !== "object" || raw === null) return empty();
    const { tool, kind, name, url } = raw as Record<string, unknown>;
    if (typeof tool !== "string" || typeof name !== "string") return empty();
    if (typeof url !== "string" || !tool || !name || !url) return empty();
    if (kind === "map") out.set(tool, { pick: { kind, mapName: name }, url });
    else if (kind === "game")
      out.set(tool, { pick: { kind, gameName: name }, url });
    else return empty();
  }
  return out;
}

/** The stored snapshot, or nothing where there is no storage to read. */
function readRemembered(): Map<string, RememberedArt> {
  try {
    const text = localStorage.getItem(storageKey);
    written = text ?? undefined;
    return decodeRemembered(text);
  } catch {
    return new Map();
  }
}

/**
 * Read back what this install painted last launch, under the key that is its own.
 *
 * Called once from `main.tsx`, before the first render. Still synchronous, which
 * is the point: this is the value first paint needs, and a promise would arrive
 * after exactly the paint it exists to fill. What moved is only where in the boot
 * it happens. It used to run while this module loaded, which is earlier than the
 * profile has said which install this is, and reading the other install's
 * snapshot is the bug (issue #1115). The profile load already sits well before
 * the render, so the read still lands before first paint with nothing awaited in
 * between.
 *
 * A launch that never calls this simply remembers nothing, which is the behaviour
 * every launch had before the snapshot existed.
 */
export function loadContentArt(portableRoot: string): void {
  storageKey = contentArtStorageKey(portableRoot);
  remembered = readRemembered();
  wake();
}
