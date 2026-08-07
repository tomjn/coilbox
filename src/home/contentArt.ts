/**
 * Step 2 of the card-art chain: art derived from what is actually installed and
 * played on this machine.
 *
 * A card for Singleplayer shows the minimap of the map sitting in your saved
 * setup. Replays shows the map of the last match you recorded. Campaigns shows
 * the map of the mission you last played. Nothing here is drawn: PR #982 already
 * renders minimaps and loading-screen art to a disk cache and serves them over
 * `coilbox://`, so this module picks the content and hands back that URL.
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
 *    up, and a cold cache is invisible rather than blank.
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
 * The hook lives in its own file so that this one imports nothing but types.
 * `art.ts` registers the source, so whatever this file pulls in lands in the
 * import graph of every test that touches the chain, and the chain is meant to
 * unit test without a DOM or a Tauri bridge.
 *
 * Splitting it this way also keeps the interesting part testable. Which content
 * each tool shows is {@link contentPicks}, a pure function of plain data, so
 * "this install has no replays" is a unit test rather than a mocked IPC bridge.
 *
 * ## Where the picks come from, and where they deliberately differ
 *
 * `src/home/continue.ts` already ranks what you could resume, and the Warpath
 * pick goes through it so the Continue hero and the Warpath card cannot name
 * different runs.
 *
 * The campaign and skirmish picks answer a different question on purpose.
 * "Resume" wants a mission left mid-attempt and a preset with a timestamp on it.
 * A picture wants the last thing you touched, finished or not. So the campaign
 * pick reads `lastPlayedMissionId`, which still has an answer once you have
 * completed everything, and the skirmish pick reads the working draft, which
 * `continue.ts` cannot rank because it carries no timestamp but which is the
 * truest statement of what your Singleplayer screen currently holds.
 *
 * ## Bright content under light text
 *
 * A minimap of a desert map is bright, and card text sits over it. This module
 * does not darken it, for a reason worth stating: step 1 of the chain is a
 * distribution's own image file (issue #1000), which Coilbox cannot touch at
 * all, so a card that only reads when its art happens to be dark is already
 * broken and no source can fix that from its own side. Legibility over arbitrary
 * art belongs to whatever paints the text over it. {@link CardArt} carries the
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
import type { RogueliteRun } from "../runlite/model";
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

/** Everything {@link contentPicks} reads. */
export interface ContentPickSources {
  draft: DraftSummary;
  /** Replays newest first, which is the order `contentListReplays` returns. */
  replays: readonly ReplaySummary[];
  campaigns: readonly { campaign: Campaign }[];
  progress: ProgressFile;
  /** Scenarios newest edit first, which is the order `useScenarios` returns. */
  scenarios: readonly { scenario: ScenarioSummary }[];
  runs: Record<string, RogueliteRun>;
  /**
   * The Warpath run `continue.ts` chose, so the card and the Continue hero
   * cannot name different runs. Absent when there is nothing to resume.
   */
  resumeRunId?: string;
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
 * The map of the next fight in your Warpath run.
 *
 * Not the node you are standing on. A run starts on `start` and passes through
 * reward, shop and event nodes, none of which has a map, so the current node is
 * blank for most of a run. What a Warpath card should show is the ground ahead,
 * so this takes the battle nodes an edge leads to from where you are. Falling
 * back to the earliest unvisited battle covers the node whose every exit is a
 * shop, which would otherwise leave the card artless in the middle of a run.
 */
export function warpathPick(
  runs: Record<string, RogueliteRun>,
  runId: string | undefined,
): ContentPick | undefined {
  const run = runId ? runs[runId] : undefined;
  if (!run) return undefined;
  const byId = new Map(run.nodes.map((n) => [n.id, n]));
  const next = run.edges
    .filter(([from]) => from === run.progress.currentNodeId)
    .map(([, to]) => byId.get(to))
    .find((n) => n?.battle?.mapName);
  const visited = new Set(run.progress.visited);
  const ahead =
    next ?? run.nodes.find((n) => n.battle?.mapName && !visited.has(n.id));
  const mapName = ahead?.battle?.mapName;
  return mapName ? { kind: "map", mapName } : undefined;
}

/**
 * The run id `continue.ts` chose, recovered from its candidate id.
 *
 * The collector returns candidates rather than entities, so the id it builds is
 * the only handle onto the run it picked. Going through it rather than repeating
 * its "most recently updated active run" rule is what stops the Warpath card and
 * the Continue hero drifting apart. `contentArt.test.ts` pins the format against
 * `warpathCandidate` itself, so a change there fails a test rather than silently
 * blanking the card.
 */
export function resumeRunId(
  candidates: readonly { kind: string; id: string }[],
): string | undefined {
  const found = candidates.find((c) => c.kind === "warpath");
  return found?.id.slice("warpath:".length) || undefined;
}

/**
 * Every tool with something real to show, and what it should show.
 *
 * Coverage is deliberately partial, and a tool absent from the result falls
 * through to the bundled illustration and then to the procedural field, so a gap
 * here is a local decision with no chain consequences. Conquest and the maps
 * browser are absent for reasons that need new work rather than a new line here,
 * tracked as their own issues on milestone 16.
 *
 * The same map may be picked by more than one tool, and it is not deduplicated.
 * If your last skirmish and your last replay were on the same map then both
 * cards showing it is the truth, and picking a second-best map for one of them
 * to avoid the repetition would not be.
 */
export function contentPicks(
  sources: ContentPickSources,
): Map<string, ContentPick> {
  const picks = new Map<string, ContentPick>();
  const add = (toolId: string, pick: ContentPick | undefined) => {
    if (pick) picks.set(toolId, pick);
  };
  add("play.skirmish", skirmishPick(sources.draft));
  add("play.replays", replayPick(sources.replays));
  add("campaign.list", campaignPick(sources.campaigns, sources.progress));
  add("scenario.list", scenarioPick(sources.scenarios));
  add("runlite.list", warpathPick(sources.runs, sources.resumeRunId));
  add("content.games", gamePick(sources.draft));
  return picks;
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

/** Tool id to resolved art URL. The only thing {@link contentCardArt} reads. */
let urls: ReadonlyMap<string, string> = new Map();

/** Bumped whenever the cache changes value, for the store subscription. */
let version = 0;

const listeners = new Set<() => void>();

/**
 * Step 2 of the chain.
 *
 * Deliberately does nothing but a map lookup. It runs during a card's render, so
 * anything else here would be work on the paint path. `undefined` before the
 * cache is warm, and for every tool this module has no answer for.
 */
export const contentCardArt: CardArtSource = ({ toolId }) => urls.get(toolId);

/**
 * Replace the cache and wake the subscribers.
 *
 * Compared by value first. The effect that publishes runs after the render it
 * caused, so waking on an unchanged answer would loop forever.
 */
export function publishContentArt(next: ReadonlyMap<string, string>): void {
  if (sameUrls(urls, next)) return;
  urls = next;
  version += 1;
  for (const listener of listeners) listener();
}

function sameUrls(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Empty the cache. For tests, and for a hard content refresh. */
export function resetContentArt(): void {
  urls = new Map();
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
