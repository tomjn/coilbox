/**
 * A parts budget for a chassis (issue #3284), a design tool for a game maker
 * balancing a family of loadouts. It is measured in cost, the Cost row of the
 * stats panel (the metal cost the worth table of #3280 gives the unit), so the
 * figure the game maker sets is the figure they read in the stats. It lives on
 * the chassis and each loadout is measured against it. Going over is a warning
 * and never blocks editing or export.
 */

import { t } from "@lingui/core/macro";
import { loadoutUnit } from "./loadouts";
import { type LegoProject, parseBudget } from "./model";

export { parseBudget };

import { formatNumber } from "@/lib/format";
import type { LoadedPack } from "./pack";
import { type Problem, problem } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { unitBounds } from "./s3oBuild";
import { legoUnitDef } from "./unitDef";
import { unitStats } from "./unitStats";
import { worthTotals } from "./worth";

export interface BudgetStanding {
  budget: number;
  used: number;
  /** Negative when over. */
  left: number;
  over: boolean;
}

/** Where a unit costing `used` stands against `budget`, or null when there is
 *  no budget or no cost to measure. */
export function budgetStanding(
  budget: number | undefined,
  used: number | null,
): BudgetStanding | null {
  if (budget === undefined || used === null) return null;
  const left = budget - used;
  return { budget, used, left, over: left < 0 };
}

function figure(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/** The warning for a unit over budget, or null when it is not. */
export function budgetProblem(standing: BudgetStanding | null): Problem | null {
  if (!standing?.over) return null;
  const over = figure(-standing.left);
  return problem(
    "budget",
    "warning",
    t`Over budget by ${over}. Export is not blocked.`,
  );
}

/** What a unit costs, as the stats panel reads it, or null when it has no
 *  cost. Weapons play no part in cost, so none are read. */
export function unitCost(
  unit: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): number | null {
  const def = legoUnitDef(
    unit,
    unitBounds(unit, pack, raw),
    "def",
    worthTotals(unit, pack),
  );
  return unitStats(def, []).cost;
}

/** The ids of the loadouts whose cost, read by `costFor` off each loadout as a
 *  whole unit, is over the budget. */
export function overBudgetLoadouts(
  project: LegoProject,
  costFor: (unit: LegoProject) => number | null,
): Set<string> {
  const over = new Set<string>();
  if (project.budget === undefined) return over;
  for (const loadout of project.loadouts ?? []) {
    const unit = loadoutUnit(project, loadout.id);
    if (unit && budgetStanding(project.budget, costFor(unit))?.over)
      over.add(loadout.id);
  }
  return over;
}
