import type { GameRef } from "../conquest/model";
import type { ConquestUnlocks } from "../conquest/unlocks";
import type { AchievementResult } from "../content/achievements";
import { aiRecordFor } from "../content/aiRecord";
import type { StatRecord } from "../content/bindings";
import type { InstalledGame } from "../play/installedGames";
import { MAX_ASCENSION, unlockedLoadouts, unlocksFor } from "../runlite/meta";
import type { RogueliteMeta, RunStats } from "../runlite/model";
import { createGameResolver, type GameId } from "./games";

export interface CampaignRow {
  id: string;
  title: string;
  missions: number;
  completed: number;
  finished: boolean;
  nextMission: string | undefined;
}

export interface ConquestSummary {
  finished: number;
  won: number;
  lost: number;
  threatLevel: number;
  inProgress: number;
}

export interface AiSummary {
  games: number;
  wins: number;
  losses: number;
  undecided: number;
  topAi: { ai: string; bonus: string | null; games: number } | null;
}

export interface WarpathSummary {
  runs: number;
  wins: number;
  deepest: number;
  ascensionTier: number;
  maxAscension: number;
  loadouts: string[];
  eventPools: string[];
}

export interface CareerGame {
  key: string;
  title: string;
  installed: boolean | null;
  campaigns: CampaignRow[];
  conquest: ConquestSummary | null;
  ai: AiSummary | null;
  /** The game's own Warpath runs, with what it offers at setup. */
  warpath: WarpathSummary | null;
}

export interface Career {
  games: CareerGame[];
  /** Warpath runs from before records were kept per game, or with no game. */
  legacyWarpath: WarpathSummary | null;
  isEmpty: boolean;
}

export interface CareerInput {
  installed: readonly InstalledGame[] | null;
  campaigns: {
    campaigns: readonly {
      campaign: {
        id: string;
        title: string;
        missions: readonly {
          id: string;
          title: string;
          snapshot?: { gameName?: string };
        }[];
      };
    }[];
    progress: {
      campaigns: Record<
        string,
        { completedMissionIds: string[]; lastPlayedMissionId?: string }
      >;
    };
  } | null;
  conquest: {
    galaxies: readonly { galaxy: { id: string; game: GameRef } }[];
    state: { conquests: Record<string, { status: string }> };
    unlocks: ConquestUnlocks;
  } | null;
  ai: {
    records: StatRecord[];
    player: string;
    refights: ReadonlySet<string>;
    scripted: ReadonlySet<string>;
  } | null;
  warpath: RogueliteMeta | null;
}

/** One game being assembled. The title comes from the best name seen for it. */
interface Draft {
  game: CareerGame;
  rank: number;
}

/** The game most of a campaign's missions are set up on, the first named on a tie. */
function campaignGameName(
  missions: readonly { snapshot?: { gameName?: string } }[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const m of missions) {
    const name = m.snapshot?.gameName?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The campaigns the player has made progress in, as rows. A campaign never
 * played has no row. A completed id the campaign no longer has (a mission
 * removed after it was played) is not counted.
 */
export function campaignRows(
  source: NonNullable<CareerInput["campaigns"]>,
): { gameName: string | undefined; row: CampaignRow }[] {
  const rows: { gameName: string | undefined; row: CampaignRow }[] = [];
  for (const { campaign } of source.campaigns) {
    const saved = source.progress.campaigns[campaign.id];
    if (!saved) continue;
    const done = new Set(saved.completedMissionIds);
    const completed = campaign.missions.filter((m) => done.has(m.id)).length;
    if (completed === 0 && !saved.lastPlayedMissionId) continue;
    const next = campaign.missions.find((m) => !done.has(m.id));
    rows.push({
      gameName: campaignGameName(campaign.missions),
      row: {
        id: campaign.id,
        title: campaign.title,
        missions: campaign.missions.length,
        completed,
        finished: campaign.missions.length > 0 && next === undefined,
        nextMission: next?.title,
      },
    });
  }
  return rows;
}

/** The headline numbers across every game, from what the page already holds. */
export interface CareerTotals {
  aiGames: number;
  aiWins: number;
  conquestsFinished: number;
  conquestsWon: number;
  warpathRuns: number;
  warpathWins: number;
  campaignsFinished: number;
  campaignsStarted: number;
}

/**
 * Add up the career. A part with no answer, or none to show, adds nothing:
 * the caller decides which totals to display.
 */
export function careerTotals(career: Career): CareerTotals {
  const totals: CareerTotals = {
    aiGames: 0,
    aiWins: 0,
    conquestsFinished: 0,
    conquestsWon: 0,
    warpathRuns: career.legacyWarpath?.runs ?? 0,
    warpathWins: career.legacyWarpath?.wins ?? 0,
    campaignsFinished: 0,
    campaignsStarted: 0,
  };
  for (const game of career.games) {
    totals.aiGames += game.ai?.games ?? 0;
    totals.aiWins += game.ai?.wins ?? 0;
    totals.conquestsFinished += game.conquest?.finished ?? 0;
    totals.conquestsWon += game.conquest?.won ?? 0;
    totals.warpathRuns += game.warpath?.runs ?? 0;
    totals.warpathWins += game.warpath?.wins ?? 0;
    totals.campaignsStarted += game.campaigns.length;
    totals.campaignsFinished += game.campaigns.filter((c) => c.finished).length;
  }
  return totals;
}

/** The achievements to show in a short summary. */
export interface AchievementDigest {
  /** The most recently earned, newest first, capped at `limit`. */
  shown: AchievementResult[];
  /** Earned in all, including those not shown. */
  earned: number;
  total: number;
}

/** Earned achievements, newest first, cut to `limit`, with the counts. */
export function achievementDigest(
  results: readonly AchievementResult[],
  limit: number,
): AchievementDigest {
  const earned = results.filter((r) => r.earned);
  const shown = [...earned]
    .sort((a, b) => (b.earnedAtMs ?? 0) - (a.earnedAtMs ?? 0))
    .slice(0, limit);
  return { shown, earned: earned.length, total: results.length };
}

/**
 * A Warpath summary from one record's stats and what it offers, or null when
 * the record has no runs.
 */
function warpathSummary(
  stats: RunStats,
  unlocks: {
    loadouts: readonly string[];
    eventPools: readonly string[];
    ascensionTier: number;
  },
): WarpathSummary | null {
  if (stats.runs === 0) return null;
  return {
    runs: stats.runs,
    wins: stats.wins,
    deepest: stats.deepest,
    ascensionTier: unlocks.ascensionTier,
    maxAscension: MAX_ASCENSION,
    loadouts: unlockedLoadouts(unlocks)
      .filter((l) => l.id !== "standard")
      .map((l) => l.label),
    eventPools: [...unlocks.eventPools],
  };
}

/** Add a second summary of the same game to the first. */
function mergeWarpath(a: WarpathSummary, b: WarpathSummary): WarpathSummary {
  return {
    ...a,
    runs: a.runs + b.runs,
    wins: a.wins + b.wins,
    deepest: Math.max(a.deepest, b.deepest),
    ascensionTier: Math.max(a.ascensionTier, b.ascensionTier),
    loadouts: [...new Set([...a.loadouts, ...b.loadouts])],
    eventPools: [...new Set([...a.eventPools, ...b.eventPools])],
  };
}

/**
 * Everything the player has done, per game, with each store read as it is.
 *
 * A store that is `null` is one with no answer yet (still loading, or failed),
 * and contributes nothing. That is different from a store that answered with
 * nothing, which is why the caller reports the two apart.
 *
 * Warpath keeps one record per game, keyed by shortname like Conquest's. A
 * game's summary shows its own runs and wins, and the tier and unlocks it
 * offers, which include what the legacy record unlocked. The legacy record
 * (runs from before records were kept per game, or with no game) is returned
 * once, as `legacyWarpath`.
 *
 * Pure: the hooks that read the stores live in `useCareer`.
 */
export function buildCareer(input: CareerInput): Career {
  const resolver = createGameResolver(input.installed);
  const drafts = new Map<string, Draft>();

  const entry = (id: GameId): CareerGame => {
    let draft = drafts.get(id.key);
    if (!draft) {
      draft = {
        rank: id.rank,
        game: {
          key: id.key,
          title: id.title,
          installed: id.installed,
          campaigns: [],
          conquest: null,
          ai: null,
          warpath: null,
        },
      };
      drafts.set(id.key, draft);
    } else if (id.rank > draft.rank) {
      draft.rank = id.rank;
      draft.game.title = id.title;
      draft.game.installed = id.installed;
    }
    return draft.game;
  };

  if (input.campaigns) {
    for (const { gameName, row } of campaignRows(input.campaigns)) {
      entry(resolver.byName(gameName)).campaigns.push(row);
    }
  }

  if (input.conquest) {
    const { galaxies, state, unlocks } = input.conquest;
    const summary = (id: GameId): ConquestSummary => {
      const game = entry(id);
      game.conquest ??= {
        finished: 0,
        won: 0,
        lost: 0,
        threatLevel: 0,
        inProgress: 0,
      };
      return game.conquest;
    };
    for (const [shortname, record] of Object.entries(unlocks)) {
      if (record.finished === 0 && record.threatLevel === 0) continue;
      const c = summary(resolver.byShortname(shortname));
      c.finished += record.finished;
      c.won += record.won;
      c.lost = c.finished - c.won;
      c.threatLevel = Math.max(c.threatLevel, record.threatLevel);
    }
    for (const { galaxy } of galaxies) {
      if (state.conquests[galaxy.id]?.status !== "active") continue;
      summary(
        resolver.byShortname(galaxy.game.shortname, galaxy.game.pinnedName),
      ).inProgress += 1;
    }
  }

  if (input.ai) {
    const { records, player, refights, scripted } = input.ai;
    const buckets = new Map<string, { id: GameId; records: StatRecord[] }>();
    for (const record of records) {
      const id = resolver.byName(record.gameType);
      const bucket = buckets.get(id.key) ?? { id, records: [] };
      if (id.rank > bucket.id.rank) bucket.id = id;
      bucket.records.push(record);
      buckets.set(id.key, bucket);
    }
    for (const { id, records: ofGame } of buckets.values()) {
      const record = aiRecordFor(ofGame, player, refights, scripted);
      if (record.games === 0) continue;
      const top = record.rows[0];
      entry(id).ai = {
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        undecided: record.undecided,
        topAi: top ? { ai: top.ai, bonus: top.bonus, games: top.games } : null,
      };
    }
  }

  let legacyWarpath: WarpathSummary | null = null;
  if (input.warpath) {
    const meta = input.warpath;
    for (const [shortname, record] of Object.entries(meta.games)) {
      const summary = warpathSummary(record.stats, unlocksFor(meta, shortname));
      if (!summary) continue;
      const game = entry(resolver.byShortname(shortname));
      game.warpath = game.warpath
        ? mergeWarpath(game.warpath, summary)
        : summary;
    }
    legacyWarpath = warpathSummary(meta.legacy.stats, meta.legacy);
  }

  // Conquest summaries made only to hold a zero (a game with an unlock record
  // of nothing) are not progress.
  const games = [...drafts.values()]
    .map((d) => d.game)
    .filter(
      (g) =>
        g.campaigns.length > 0 ||
        g.ai !== null ||
        g.warpath !== null ||
        (g.conquest !== null &&
          (g.conquest.finished > 0 ||
            g.conquest.threatLevel > 0 ||
            g.conquest.inProgress > 0)),
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    games,
    legacyWarpath,
    isEmpty: games.length === 0 && legacyWarpath === null,
  };
}
