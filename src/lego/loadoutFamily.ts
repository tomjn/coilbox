/**
 * The family view of a chassis (issue #3283): every loadout as a column, with
 * a row for each mount point and each stat, and the rows where the loadouts
 * differ marked.
 *
 * Each loadout is read as the whole unit `loadoutUnit` gives, so the mounts come
 * from `mountContents` and the stats from whatever `statsFor` reads off a unit,
 * the same as the builder reads them for the loadout on screen.
 */

import { t } from "@lingui/core/macro";
import { formatNumber } from "@/lib/format";
import { budgetStanding } from "./budget";
import { loadoutUnit, loadoutUnitNames } from "./loadouts";
import { lockReason, unitLocks } from "./locks";
import type { LegoProject } from "./model";
import { mountContents } from "./mountPoints";
import { STATS, type UnitStats } from "./unitStats";
import { chainOrder, predecessorOf } from "./upgradeChain";

export interface FamilyColumn {
  id: string;
  name: string;
  /** The unit name this loadout exports under. */
  exportName: string;
  active: boolean;
  /** The name of the loadout this one upgrades from, when the project has it. */
  upgradesFrom?: string;
  /** Why this loadout is locked (#3289), such as "Locked by Cannon". Absent
   *  when it is free. */
  locked?: string;
}

export interface FamilyRow {
  /** `piece:connector` for a mount, the stat's id for a stat. */
  id: string;
  kind: "mount" | "stat" | "budget";
  label: string;
  /** One per column: what sits on the mount, or the figure. Null is empty. */
  cells: (string | null)[];
  /** Whether the columns are not all the same. */
  differs: boolean;
  /** Stat rows that differ: the columns holding the largest and smallest
   *  figure. */
  highest?: number[];
  lowest?: number[];
  /** Budget row: the columns over the chassis budget. */
  over?: number[];
  /** Present when the loadouts form a chain. One per column: what that column
   *  adds, removes or changes against the loadout it upgrades from. Null for the
   *  start of a chain and for a column the same as its predecessor. */
  changes?: (string | null)[];
}

export interface Family {
  columns: FamilyColumn[];
  rows: FamilyRow[];
}

function figure(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

function allSame(cells: (string | null)[]): boolean {
  return cells.every((cell) => cell === cells[0]);
}

/** What is left of the chassis budget in each column, and which are over. */
function budgetRow(budget: number, costs: (number | null)[]): FamilyRow {
  const standings = costs.map((cost) => budgetStanding(budget, cost));
  const cells = standings.map((s) => {
    if (!s) return null;
    const amount = figure(Math.abs(s.left));
    return s.over ? t`${amount} over` : t`${amount} left`;
  });
  const total = figure(budget);
  return {
    id: "budget",
    kind: "budget",
    label: t`Budget (${total})`,
    cells,
    differs: !allSame(cells),
    over: standings.flatMap((s, i) => (s?.over ? [i] : [])),
  };
}

/**
 * The family of a unit, or null when it has fewer than two loadouts and so
 * nothing to compare. `statsFor` reads the stats of one loadout as a unit, or
 * answers null when they cannot be read, which leaves out the stat rows.
 */
export function loadoutFamily(
  project: LegoProject,
  statsFor: (unit: LegoProject) => UnitStats | null,
  moduleName: (id: string) => string = (id) => id,
): Family | null {
  const loadouts = project.loadouts;
  if (!loadouts || loadouts.length < 2) return null;
  const names = loadoutUnitNames(project);
  const ordered = chainOrder(loadouts);
  const units = ordered.map((loadout) => ({
    loadout,
    unit: loadoutUnit(project, loadout.id),
  }));

  const locks = unitLocks(project);
  const columns: FamilyColumn[] = ordered.map((loadout) => {
    const from = predecessorOf(project, loadout);
    const lock = locks.find((l) => l.loadoutId === loadout.id);
    const locked = lock ? lockReason(lock, moduleName) : null;
    return {
      id: loadout.id,
      name: loadout.name,
      exportName: names.get(loadout.id) ?? project.unitName,
      active: loadout.id === project.activeLoadout,
      ...(from ? { upgradesFrom: from.name } : {}),
      ...(locked ? { locked } : {}),
    };
  });
  // For each column, the column it upgrades from, or -1.
  const before = ordered.map((loadout) =>
    loadout.upgradesFrom
      ? ordered.findIndex((other) => other.id === loadout.upgradesFrom)
      : -1,
  );
  const chained = before.some((at) => at >= 0);
  const mountChanges = (cells: (string | null)[]) =>
    chained
      ? {
          changes: cells.map((cell, i) => {
            const was = before[i] < 0 ? cell : cells[before[i]];
            if (cell === was) return null;
            return was === null
              ? "added"
              : cell === null
                ? "removed"
                : `was ${was}`;
          }),
        }
      : {};
  const statChanges = (values: (number | null)[]) =>
    chained
      ? {
          changes: values.map((value, i) => {
            const was = before[i] < 0 ? null : values[before[i]];
            if (value === null || was === null) return null;
            const delta = Number((value - was).toFixed(1));
            return delta === 0
              ? null
              : `${delta > 0 ? "+" : ""}${figure(delta)}`;
          }),
        }
      : {};

  // Every mount any loadout has, in the order first met. A mount sits on a
  // piece, and a piece keeps its id from one loadout to the next.
  const mounts = new Map<string, { label: string; pieceName: string }>();
  const contents = units.map(({ unit }) => {
    const at = new Map<string, string | null>();
    for (const piece of unit?.pieces ?? []) {
      for (const { mount, onIt } of mountContents(unit as LegoProject, piece)) {
        const id = `${piece.id}:${mount.connector}`;
        at.set(id, onIt);
        if (!mounts.has(id))
          mounts.set(id, { label: mount.name, pieceName: piece.name });
      }
    }
    return at;
  });
  const labelCount = new Map<string, number>();
  for (const { label } of mounts.values())
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);

  const rows: FamilyRow[] = [...mounts].map(([id, { label, pieceName }]) => {
    const cells = contents.map((at) => at.get(id) ?? null);
    return {
      id,
      kind: "mount",
      label: (labelCount.get(label) ?? 0) > 1 ? `${pieceName} ${label}` : label, // i18n: not a plural
      cells,
      differs: !allSame(cells),
      ...mountChanges(cells),
    };
  });

  const stats = units.map(({ unit }) => (unit ? statsFor(unit) : null));
  if (stats.every((s) => s !== null)) {
    for (const { id, label } of STATS) {
      const values = stats.map((s) => (s as UnitStats)[id]);
      const cells = values.map((v) => (v === null ? null : figure(v)));
      const differs = !allSame(cells);
      const row: FamilyRow = {
        id,
        kind: "stat",
        label,
        cells,
        differs,
        ...statChanges(values),
      };
      const numbers = values.filter((v): v is number => v !== null);
      if (differs && numbers.length >= 2) {
        const top = Math.max(...numbers);
        const bottom = Math.min(...numbers);
        if (top !== bottom) {
          const where = (target: number) =>
            values.flatMap((v, i) => (v === target ? [i] : []));
          row.highest = where(top);
          row.lowest = where(bottom);
        }
      }
      rows.push(row);
      if (id === "cost" && project.budget !== undefined) {
        rows.push(budgetRow(project.budget, values));
      }
    }
  }

  return { columns, rows };
}
