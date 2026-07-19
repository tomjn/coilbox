import { reachableFrom } from "../content/buildTree";
import type { BattleConfig } from "../play/bindings";
import type { Perk, RogueliteRun } from "./model";

/**
 * The shared-tech-ceiling bridge. A run's build grows by *unlocking* units; the
 * engine only speaks *restriction* (`[RESTRICT] Limit=0`, applied to all teams).
 * So the disabled set is the complement of what's unlocked within the game's
 * reachable arsenal:
 *
 *   disabled = reachableFrom(startUnit) − unlockedUnits
 *
 * Because `[RESTRICT]` is engine-global this raises a *shared* ceiling — the war
 * escalates as you unlock, it is never player-exclusive (that's what per-team
 * perks are for). With no start unit (dataset unavailable) nothing is disabled:
 * the full arsenal is allowed rather than everything banned.
 */
export function disabledUnitsFor(
  run: RogueliteRun,
  edges: Map<string, string[]>,
): string[] {
  if (!run.startUnit) return [];
  const reachable = reachableFrom(run.startUnit, edges);
  const unlocked = new Set(
    run.progress.unlockedUnits.map((u) => u.toLowerCase()),
  );
  const disabled: string[] = [];
  for (const unit of reachable) {
    if (!unlocked.has(unit)) disabled.push(unit);
  }
  return disabled;
}

/**
 * Sum a perk list into its two team levers: `advantage` (an `Advantage` fraction
 * addend) and `income` (an `IncomeMultiplier` addend). Pure — shared by the live
 * launch (`applyPerks`) and the preset snapshot so both compute the same totals.
 */
export function perkTotals(perks: Perk[]): {
  advantage: number;
  income: number;
} {
  let advantage = 0;
  let income = 0;
  for (const p of perks) {
    if (p.kind === "advantage") advantage += p.value;
    else if (p.kind === "income") income += p.value;
  }
  return { advantage, income };
}

/**
 * Apply the run's accumulated personal perks to the player's team in a built
 * {@link BattleConfig}. Perks are the *asymmetric* power the engine does support
 * per team: `advantage` sums into the team's `Advantage` fraction,
 * `income` into its `IncomeMultiplier` (default 1). The player is always team 0
 * (participant[0] = "you" keeps index 0 through `toBattleConfig`). Mutates and
 * returns `config` for chaining.
 */
export function applyPerks(config: BattleConfig, perks: Perk[]): BattleConfig {
  const team = config.teams[0];
  if (!team) return config;
  const { advantage, income } = perkTotals(perks);
  if (advantage > 0) {
    team.advantage = (team.advantage ?? 0) + advantage;
  }
  if (income > 0) {
    team.incomeMultiplier = (team.incomeMultiplier ?? 1) + income;
  }
  return config;
}
