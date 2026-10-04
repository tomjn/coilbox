import {
  emptyRecord,
  META_SCHEMA_VERSION,
  type RogueliteMeta,
  type RogueliteRun,
  type UnlockRecord,
} from "./model";
import { deepestColumn } from "./progress";

/**
 * Meta-progression rules — the persistent, between-run unlocks. The guiding
 * principle is "options, not raw power": winning or dying widens what you can
 * *choose* next time (new starting loadouts, harder ascension tiers), never a
 * flat stat boost, so runs stay fair and self-contained. All pure + tested; the
 * page just persists the result.
 */

/** Highest ascension tier the design offers. */
export const MAX_ASCENSION = 5;

/** A starting loadout offered at run setup. A loadout pre-unlocks one of the
 * commander's build branches, so a run can open committed to a doctrine instead
 * of the neutral starter kit. `branchIndex < 0` is the neutral default. */
export interface Loadout {
  id: string;
  label: string;
  /** Which of the start unit's build options to pre-unlock (-1 = none). */
  branchIndex: number;
}

/** The always-available default plus the unlockable doctrines. */
export const LOADOUTS: Loadout[] = [
  { id: "standard", label: "Standard deployment", branchIndex: -1 },
  { id: "vanguard", label: "Armoured vanguard", branchIndex: 0 },
  { id: "air", label: "Air superiority", branchIndex: 1 },
  { id: "recon", label: "Recon doctrine", branchIndex: 2 },
];

/** Win counts at which each doctrine unlocks. */
const LOADOUT_UNLOCK_WINS: Record<string, number> = {
  vanguard: 1,
  air: 2,
  recon: 3,
};

/** Event-pool ids and the run count at which each is drawn into the deck. */
const EVENT_POOL_UNLOCK_RUNS: Record<string, number> = {
  anomalies: 2,
  warlords: 5,
};

/** A game's key in the meta document. Lower case, as Conquest's unlocks are. */
export const gameKey = (shortname: string) => shortname.trim().toLowerCase();

/** What a game offers at setup. */
export interface GameUnlocks {
  loadouts: string[];
  eventPools: string[];
  /** The highest ascension tier the player may pick, and the ceiling a win has
   * to reach to unlock the next. */
  ascensionTier: number;
}

/**
 * What the player may choose in a game: everything the legacy record unlocked
 * plus everything the game's own record unlocked, and the higher of the two
 * ascension tiers. Nothing a player earned before records were kept per game is
 * taken away, and what they earn now is earned in one game.
 */
export function unlocksFor(
  meta: RogueliteMeta,
  shortname: string,
): GameUnlocks {
  const own = meta.games[gameKey(shortname)];
  return {
    loadouts: [...new Set([...meta.legacy.loadouts, ...(own?.loadouts ?? [])])],
    eventPools: [
      ...new Set([...meta.legacy.eventPools, ...(own?.eventPools ?? [])]),
    ],
    ascensionTier: Math.max(meta.legacy.ascensionTier, own?.ascensionTier ?? 0),
  };
}

/** The loadouts the player may pick now: the default plus any unlocked. */
export function unlockedLoadouts(unlocks: {
  loadouts: readonly string[];
}): Loadout[] {
  const ids = new Set(["standard", ...unlocks.loadouts]);
  return LOADOUTS.filter((l) => ids.has(l.id));
}

/** Look up a loadout by id (falls back to the neutral default). */
export function loadoutById(id: string | undefined): Loadout {
  return LOADOUTS.find((l) => l.id === id) ?? LOADOUTS[0];
}

/** True when any record has counted this run id. */
function isCounted(meta: RogueliteMeta, runId: string): boolean {
  return (
    meta.legacy.seen.includes(runId) ||
    Object.values(meta.games).some((g) => g.seen.includes(runId))
  );
}

/**
 * Mark the runs that were already finished when the meta was first read as
 * counted, once. Runs finished before records kept a `seen` list may have been
 * counted once, repeatedly or never, and nothing says which, so they are not
 * counted again. The ids go in the legacy record, and `awardMeta` looks in every
 * record. Returns the same object when already seeded, or when the document is
 * from a newer version and must not be rewritten.
 */
export function seedSeen(
  meta: RogueliteMeta,
  finishedIds: ReadonlySet<string>,
): RogueliteMeta {
  if (meta.seenSeeded || meta.schemaVersion > META_SCHEMA_VERSION) return meta;
  const legacySeen = [...meta.legacy.seen];
  for (const id of finishedIds) {
    if (!isCounted(meta, id) && !legacySeen.includes(id)) legacySeen.push(id);
  }
  return {
    ...meta,
    legacy: { ...meta.legacy, seen: legacySeen },
    seenSeeded: true,
  };
}

/**
 * The one rule for counting finished runs, shared by every place that shows
 * runs. Before the meta is seeded nothing is awarded. After that, a finished
 * run no record has counted is awarded into its game's record. `baseline` is
 * the ids of the runs that were already finished when the runs were first read
 * this session, so a run that ends later is never mistaken for one of them.
 */
export function awardFinishedRuns(
  meta: RogueliteMeta,
  runs: Readonly<Record<string, RogueliteRun>>,
  baseline: ReadonlySet<string>,
): RogueliteMeta {
  let next = seedSeen(meta, baseline);
  if (!next.seenSeeded) return next;
  for (const [id, run] of Object.entries(runs)) {
    if (run.progress.status !== "active") next = awardMeta(next, run, id);
  }
  return next;
}

/**
 * Fold a finished run into the meta document: bump the run/win/deepest stats of
 * its own game's record, then unlock any loadouts / event pools / ascension tier
 * that game's own totals cross. Thresholds count the game's own runs and wins
 * only. The legacy totals already bought the legacy unlocks, which every game
 * keeps through `unlocksFor`.
 *
 * A run with no shortname has no game to belong to, so it goes to the legacy
 * record, which is the record of runs with no game.
 *
 * Returns the same object when the run was counted before, or when the document
 * is from a newer version and must not be rewritten.
 */
export function awardMeta(
  meta: RogueliteMeta,
  run: RogueliteRun,
  runId: string,
): RogueliteMeta {
  if (meta.schemaVersion > META_SCHEMA_VERSION) return meta;
  const key = gameKey(run.settings.game.shortname);
  const prev: UnlockRecord = key
    ? (meta.games[key] ?? emptyRecord)
    : meta.legacy;
  if (isCounted(meta, runId)) return meta;

  const won = run.progress.status === "won";
  const runs = prev.stats.runs + 1;
  const wins = prev.stats.wins + (won ? 1 : 0);
  const deepest = Math.max(prev.stats.deepest, deepestColumn(run));

  // Loadouts unlock by wins; event pools by runs played.
  const loadouts = new Set(prev.loadouts);
  for (const [id, need] of Object.entries(LOADOUT_UNLOCK_WINS)) {
    if (wins >= need) loadouts.add(id);
  }
  const eventPools = new Set(prev.eventPools);
  for (const [id, need] of Object.entries(EVENT_POOL_UNLOCK_RUNS)) {
    if (runs >= need) eventPools.add(id);
  }

  // Ascension unlocks one tier at a time, and only by *winning at least at the
  // current ceiling* — so you can't outrun the difficulty. The ceiling is what
  // the game offers (legacy and its own record), so a win at the legacy tier
  // raises the game's own tier to one above it.
  const ceiling = unlocksFor(meta, key).ascensionTier;
  let ascensionTier = prev.ascensionTier;
  if (won && run.settings.ascension >= ceiling && ceiling < MAX_ASCENSION) {
    ascensionTier = ceiling + 1;
  }

  const next: UnlockRecord = {
    loadouts: [...loadouts],
    eventPools: [...eventPools],
    ascensionTier,
    stats: { runs, wins, deepest },
    seen: [...prev.seen, runId],
  };
  return {
    ...meta,
    schemaVersion: META_SCHEMA_VERSION,
    legacy: key ? meta.legacy : next,
    games: key ? { ...meta.games, [key]: next } : meta.games,
  };
}
