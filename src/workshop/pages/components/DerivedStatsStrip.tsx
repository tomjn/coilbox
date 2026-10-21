/**
 * The numbers players argue about (issue #2644): DPS, alpha damage, cost per
 * hit point, DPS per 100 metal, hit points per build second and range per
 * cost, recomputed from `derivedStats.ts` every time the unit or its weapons
 * change. A figure `derivedStats.ts` could not compute honestly, a paralyzer's
 * DPS or a unit with no weapon's range per cost, is left off the strip
 * entirely rather than shown as a misleading zero or dash.
 *
 * Where `gameStats` (issue #3114) has a different number for a figure than
 * `stats` does, a tile shows both: "74 → 89", with the sign written out
 * rather than left to colour alone, since colour is not read by everyone and
 * is not enough on its own besides. Colour still marks whether the change
 * helped, but which direction counts as "helped" is a property of the stat:
 * a lower cost per hit point is the good direction, everything else here is
 * the opposite, per {@link Direction}.
 */
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatNumber as formatLocaleNumber } from "@/lib/format";
import {
  alphaDamageHelp,
  costPerHitPointHelp,
  dpsHelp,
  dpsPer100MetalHelp,
  hitPointsPerBuildSecondHelp,
  rangePerCostHelp,
  type UnitDerivedStats,
} from "../../derivedStats";

/** Whether a higher number is the better one for a given stat. Cost per hit
 *  point is the one figure here where lower is better (a cheaper unit for
 *  its toughness). Every other stat runs the other way. */
type Direction = "higher" | "lower";

/** Two numbers a small enough distance apart to call unchanged, the same
 *  tolerance `unitReference.ts`'s `sameValue` uses for a reference row. */
function changed(a: number, b: number): boolean {
  return Math.abs(a - b) >= 1e-6;
}

/** One figure on the strip. `undefined` when {@link UnitDerivedStats} could
 *  not compute it, in which case nothing is drawn for it at all. `gameValue`
 *  is the same figure off the game's own unit, `null` when the game's unit
 *  could not compute it either (in which case there is nothing to compare
 *  `value` against). */
function Stat({
  label,
  value,
  gameValue,
  help,
  direction,
}: {
  label: string;
  value: number | null;
  gameValue: number | null;
  help: string;
  direction: Direction;
}) {
  if (value === null) return null;
  const hasChange = gameValue !== null && changed(value, gameValue);
  const diff = hasChange ? value - (gameValue as number) : 0;
  const better = direction === "higher" ? diff > 0 : diff < 0;
  const diffClass = !hasChange
    ? ""
    : better
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-destructive";
  const sign = diff > 0 ? "+" : diff < 0 ? "" : "±";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col rounded-md border px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            {hasChange ? (
              <span className="font-mono text-sm font-medium">
                {formatNumber(gameValue as number)}
                <span className="text-muted-foreground"> {"→"} </span>
                {formatNumber(value)}
                <span className={`ml-1 ${diffClass}`}>
                  ({sign}
                  {formatNumber(diff)})
                </span>
              </span>
            ) : (
              <span className="font-mono text-sm font-medium">
                {formatNumber(value)}
              </span>
            )}
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
  return formatLocaleNumber(value, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function DerivedStatsStrip({
  stats,
  gameStats,
}: {
  stats: UnitDerivedStats;
  /** The same numbers off the game's own unit, unedited (issue #3114), so a
   *  tile can show what an edit changed. Nothing to compare against for a
   *  unit this project added with no game unit behind it. */
  gameStats?: UnitDerivedStats;
}) {
  const { t } = useLingui();
  const excludedManual = stats.weapons.filter(
    (w) => w.excludedFromSum === "manual",
  ).length;
  const excludedSlaved = stats.weapons.filter(
    (w) => w.excludedFromSum === "slaved",
  ).length;
  const manualText = plural(excludedManual, {
    one: "# manual-fire weapon",
    other: "# manual-fire weapons",
  });
  const slavedText = plural(excludedSlaved, {
    one: "# slaved weapon",
    other: "# slaved weapons",
  });
  const excludedNote =
    excludedManual > 0 && excludedSlaved > 0
      ? t`${manualText} and ${slavedText}`
      : excludedManual > 0
        ? manualText
        : excludedSlaved > 0
          ? slavedText
          : "";

  const nothingToShow =
    stats.dps === null &&
    stats.alphaDamage === null &&
    stats.costPerHitPoint === null &&
    stats.dpsPer100Metal === null &&
    stats.hitPointsPerBuildSecond === null &&
    stats.rangePerCost === null;
  if (nothingToShow) return null;

  const dpsText = excludedNote
    ? `${dpsHelp()} ${t`Leaves out ${excludedNote}, which do not fire on a reload cycle of their own.`}`
    : dpsHelp();
  const alphaDamageText = excludedNote
    ? `${alphaDamageHelp()} ${t`Leaves out ${excludedNote}.`}`
    : alphaDamageHelp();

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <Stat
        label={t`DPS`}
        value={stats.dps}
        gameValue={gameStats?.dps ?? null}
        help={dpsText}
        direction="higher"
      />
      <Stat
        label={t`Volley damage`}
        value={stats.alphaDamage}
        gameValue={gameStats?.alphaDamage ?? null}
        help={alphaDamageText}
        direction="higher"
      />
      <Stat
        label={t`Cost per HP`}
        value={stats.costPerHitPoint}
        gameValue={gameStats?.costPerHitPoint ?? null}
        help={costPerHitPointHelp()}
        direction="lower"
      />
      <Stat
        label={t`DPS per 100 metal`}
        value={stats.dpsPer100Metal}
        gameValue={gameStats?.dpsPer100Metal ?? null}
        help={dpsPer100MetalHelp()}
        direction="higher"
      />
      <Stat
        label={t`HP per build second`}
        value={stats.hitPointsPerBuildSecond}
        gameValue={gameStats?.hitPointsPerBuildSecond ?? null}
        help={hitPointsPerBuildSecondHelp()}
        direction="higher"
      />
      <Stat
        label={t`Range per cost`}
        value={stats.rangePerCost}
        gameValue={gameStats?.rangePerCost ?? null}
        help={rangePerCostHelp()}
        direction="higher"
      />
    </div>
  );
}
