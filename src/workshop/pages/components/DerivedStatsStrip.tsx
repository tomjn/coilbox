/**
 * The numbers players argue about (issue #2644): DPS, alpha damage, cost per
 * hit point, DPS per 100 metal, hit points per build second and range per
 * cost, recomputed from `derivedStats.ts` every time the unit or its weapons
 * change. A figure `derivedStats.ts` could not compute honestly, a paralyzer's
 * DPS or a unit with no weapon's range per cost, is left off the strip
 * entirely rather than shown as a misleading zero or dash.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UnitDerivedStats } from "../../derivedStats";

/** One figure on the strip. `undefined` when {@link UnitDerivedStats} could
 *  not compute it, in which case nothing is drawn for it at all. */
function Stat({
  label,
  value,
  help,
}: {
  label: string;
  value: number | null;
  help: string;
}) {
  if (value === null) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col rounded-md border px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="font-mono text-sm font-medium">
              {formatNumber(value)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{help}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Three significant figures is plenty for a number somebody is arguing
 *  about rather than typing into a def. */
function formatNumber(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function DerivedStatsStrip({ stats }: { stats: UnitDerivedStats }) {
  const excludedManual = stats.weapons.filter(
    (w) => w.excludedFromSum === "manual",
  ).length;
  const excludedSlaved = stats.weapons.filter(
    (w) => w.excludedFromSum === "slaved",
  ).length;
  const excludedNote = [
    excludedManual > 0 &&
      `${excludedManual} manual-fire weapon${excludedManual === 1 ? "" : "s"}`,
    excludedSlaved > 0 &&
      `${excludedSlaved} slaved weapon${excludedSlaved === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" and ");

  const nothingToShow =
    stats.dps === null &&
    stats.alphaDamage === null &&
    stats.costPerHitPoint === null &&
    stats.dpsPer100Metal === null &&
    stats.hitPointsPerBuildSecond === null &&
    stats.rangePerCost === null;
  if (nothingToShow) return null;

  const dpsHelp = `Damage per second against the default armour class, summed across every weapon that fires on its own${excludedNote ? `. Leaves out ${excludedNote}, which do not fire on a reload cycle of their own` : ""}. A weapon that deals different damage to some armour classes may hit harder or softer against them than this.`;

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <Stat label="DPS" value={stats.dps} help={dpsHelp} />
      <Stat
        label="Alpha damage"
        value={stats.alphaDamage}
        help={`Total damage in one burst from every weapon counted in DPS above${excludedNote ? `, leaving out ${excludedNote}` : ""}.`}
      />
      <Stat
        label="Cost per HP"
        value={stats.costPerHitPoint}
        help="Metal cost divided by hit points. Lower is a tankier unit for its cost."
      />
      <Stat
        label="DPS per 100 metal"
        value={stats.dpsPer100Metal}
        help="DPS scaled to a metal cost of 100, so units of different cost can be compared directly."
      />
      <Stat
        label="HP per build second"
        value={stats.hitPointsPerBuildSecond}
        help="Hit points divided by build time. Build time is already stated in seconds at a build power of 1, so this holds for a builder of any speed."
      />
      <Stat
        label="Range per cost"
        value={stats.rangePerCost}
        help="The longest range among the unit's weapons, divided by metal cost. Counts every weapon, including a manual-fire or slaved one: a threat range does not need a sustained rate of fire."
      />
    </div>
  );
}
