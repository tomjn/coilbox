import type { RogueliteMeta, RogueliteRun } from "./model";
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

/** The loadouts the player may pick now: the default plus any unlocked. */
export function unlockedLoadouts(meta: RogueliteMeta): Loadout[] {
  const ids = new Set(["standard", ...meta.loadouts]);
  return LOADOUTS.filter((l) => ids.has(l.id));
}

/** Look up a loadout by id (falls back to the neutral default). */
export function loadoutById(id: string | undefined): Loadout {
  return LOADOUTS.find((l) => l.id === id) ?? LOADOUTS[0];
}

/**
 * Fold a finished run into the meta document: bump the run/win/deepest stats,
 * then unlock any loadouts / event pools / ascension tier the new totals cross.
 * Idempotent-ish per run: call once when a run reaches `won`/`lost`.
 */
export function awardMeta(
  meta: RogueliteMeta,
  run: RogueliteRun,
): RogueliteMeta {
  const won = run.progress.status === "won";
  const runs = meta.stats.runs + 1;
  const wins = meta.stats.wins + (won ? 1 : 0);
  const deepest = Math.max(meta.stats.deepest, deepestColumn(run));

  // Loadouts unlock by wins; event pools by runs played.
  const loadouts = new Set(meta.loadouts);
  for (const [id, need] of Object.entries(LOADOUT_UNLOCK_WINS)) {
    if (wins >= need) loadouts.add(id);
  }
  const eventPools = new Set(meta.eventPools);
  for (const [id, need] of Object.entries(EVENT_POOL_UNLOCK_RUNS)) {
    if (runs >= need) eventPools.add(id);
  }

  // Ascension unlocks one tier at a time, and only by *winning at least at the
  // current ceiling* — so you can't outrun the difficulty.
  let ascensionTier = meta.ascensionTier;
  if (
    won &&
    run.settings.ascension >= meta.ascensionTier &&
    ascensionTier < MAX_ASCENSION
  ) {
    ascensionTier += 1;
  }

  return {
    schemaVersion: 1,
    loadouts: [...loadouts],
    eventPools: [...eventPools],
    ascensionTier,
    stats: { runs, wins, deepest },
  };
}
