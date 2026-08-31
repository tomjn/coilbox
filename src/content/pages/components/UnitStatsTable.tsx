import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UnitDatasetEntry } from "../../bindings";

/**
 * A unit's stats and weapons, standalone so `BuildTreeDrawer` can adopt it
 * later (not part of this work). The keys and their order come straight from
 * `shared/unitdef-stats.json`: `health`, `metalCost`, `energyCost`,
 * `buildTime`, `sightDistance`, `maxVelocity`, `range`, then `weapons`.
 *
 * The stats map is untyped by design (the hub stores it schemaless), so a
 * value is rendered only when its type matches what that key means. A def
 * that says nothing about a stat gets no row: absence is a fact about the
 * reader, and a zero here would be a claim about the game nobody made.
 */

const STAT_LABELS: [key: string, label: string][] = [
  ["health", "Health"],
  ["metalCost", "Metal cost"],
  ["energyCost", "Energy cost"],
  ["buildTime", "Build time"],
  ["sightDistance", "Sight distance"],
  ["maxVelocity", "Speed"],
  ["range", "Range"],
];

interface WeaponStat {
  damage?: number;
  reload?: number;
  range?: number;
  projectile?: string;
}

function isStatValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isWeaponArray(value: unknown): value is WeaponStat[] {
  return Array.isArray(value) && value.length > 0;
}

export function UnitStatsTable({ unit }: { unit: UnitDatasetEntry }) {
  const stats = unit.stats;
  if (!stats) return null;

  const rows = STAT_LABELS.filter(([key]) => isStatValue(stats[key]));
  const weapons = isWeaponArray(stats.weapons) ? stats.weapons : [];

  if (rows.length === 0 && weapons.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
          {rows.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{String(stats[key])}</dd>
            </div>
          ))}
        </dl>
      )}

      {weapons.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Damage</TableHead>
              <TableHead>Reload</TableHead>
              <TableHead>Range</TableHead>
              <TableHead>Projectile</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weapons.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: weapons carry no id of their own
              <TableRow key={i}>
                <TableCell>{w.damage ?? ""}</TableCell>
                <TableCell>{w.reload ?? ""}</TableCell>
                <TableCell>{w.range ?? ""}</TableCell>
                <TableCell>{w.projectile ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
