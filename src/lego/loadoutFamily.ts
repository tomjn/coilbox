/**
 * The family view of a chassis (issue #3283): every loadout as a column, with
 * a row for each mount point and each stat, and the rows where the loadouts
 * differ marked.
 *
 * Each loadout is read as the whole unit `loadoutUnit` gives, so the mounts come
 * from `mountContents` and the stats from whatever `statsFor` reads off a unit,
 * the same as the builder reads them for the loadout on screen.
 */

import { budgetStanding } from "./budget";
import { loadoutUnit, loadoutUnitNames } from "./loadouts";
import type { LegoProject } from "./model";
import { mountContents } from "./mountPoints";
import { STATS, type UnitStats } from "./unitStats";

export interface FamilyColumn {
  id: string;
  name: string;
  /** The unit name this loadout exports under. */
  exportName: string;
  active: boolean;
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
}

export interface Family {
  columns: FamilyColumn[];
  rows: FamilyRow[];
}

function figure(value: number): string {
  return String(Number(value.toFixed(1)));
}

function allSame(cells: (string | null)[]): boolean {
  return cells.every((cell) => cell === cells[0]);
}

/** What is left of the chassis budget in each column, and which are over. */
function budgetRow(budget: number, costs: (number | null)[]): FamilyRow {
  const standings = costs.map((cost) => budgetStanding(budget, cost));
  const cells = standings.map((s) =>
    s ? `${figure(Math.abs(s.left))} ${s.over ? "over" : "left"}` : null,
  );
  return {
    id: "budget",
    kind: "budget",
    label: `Budget (${figure(budget)})`,
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
): Family | null {
  const loadouts = project.loadouts;
  if (!loadouts || loadouts.length < 2) return null;
  const names = loadoutUnitNames(project);
  const units = loadouts.map((loadout) => ({
    loadout,
    unit: loadoutUnit(project, loadout.id),
  }));

  const columns: FamilyColumn[] = loadouts.map((loadout) => ({
    id: loadout.id,
    name: loadout.name,
    exportName: names.get(loadout.id) ?? project.unitName,
    active: loadout.id === project.activeLoadout,
  }));

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
      label: (labelCount.get(label) ?? 0) > 1 ? `${pieceName} ${label}` : label,
      cells,
      differs: !allSame(cells),
    };
  });

  const stats = units.map(({ unit }) => (unit ? statsFor(unit) : null));
  if (stats.every((s) => s !== null)) {
    for (const { id, label } of STATS) {
      const values = stats.map((s) => (s as UnitStats)[id]);
      const cells = values.map((v) => (v === null ? null : figure(v)));
      const differs = !allSame(cells);
      const row: FamilyRow = { id, kind: "stat", label, cells, differs };
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
