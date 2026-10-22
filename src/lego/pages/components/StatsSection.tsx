/**
 * The unit's cost, health, speed, range and damage per second, beside the same
 * numbers for the game unit chosen with the reference button (issue #3293).
 *
 * Read only. A number is changed on the workshop's unit page, so once the unit
 * is exported into a game each one links to its field there. The numbers are
 * the definition the next export would write, except a field that was changed
 * by hand in the game's file, which shows the file's value. See `unitStats.ts`.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import { normaliseCloneKey } from "@/workshop/clones";
import { useUnitDefs } from "@/workshop/config";
import { dpsHelp, type WeaponInput } from "@/workshop/derivedStats";
import { exportedInto } from "@/workshop/legoUnits";
import { useModProjects } from "@/workshop/project";
import { unitEditPath } from "@/workshop/routes";
import { unitEffectiveWeapons } from "@/workshop/unitWeapons";
import { budgetStanding } from "../../budget";
import { receiptFor } from "../../exportRecord";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { writtenDigest } from "../../reexport";
import type { UnitBounds } from "../../s3oBuild";
import { legoUnitDef } from "../../unitDef";
import { gameRecordFor, sameGame, unitGame } from "../../unitGame";
import {
  STATS,
  type StatId,
  statFields,
  unitStats,
  withKeptFields,
} from "../../unitStats";
import {
  mountedWeapons,
  pickedWeapon,
  weaponExportPlan,
} from "../../weaponModule";
import { worthTotals } from "../../worth";
import type { ReferenceUnit } from "./ReferencePicker";
import { useTestGame } from "./useTestGame";
import { useWeaponSource } from "./WeaponsSection";
import { useWorkshopChanges, WorkshopChangeMarks } from "./WorkshopChangeMarks";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  bounds: UnitBounds;
  /** The game unit to compare with, or null when none is chosen. */
  reference: ReferenceUnit | null;
  /** Sets or clears the chassis budget. Without it the budget is not offered
   *  and only a budget already set is shown. */
  onBudgetChange?: (budget: number | undefined) => void;
}

/**
 * The unit fields each stat is read from, for marking a workshop change to
 * one. Range and damage come from the weapons, which the marks do not follow.
 */
const STAT_FIELDS: Partial<Record<StatId, string[]>> = {
  cost: ["metalCost", "buildCostMetal"],
  health: ["health", "maxDamage"],
  speed: ["speed"],
};

function figure(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

export function StatsSection({
  project,
  pack,
  bounds,
  reference,
  onBudgetChange,
}: Props) {
  const { t } = useLingui();
  const { target, scan } = useTestGame();
  const { projects: tweakProjects } = useModProjects();
  const source = useWeaponSource(project);
  const workshop = useWorkshopChanges(project);

  // The game the unit was exported into, which is where its file is.
  const own = unitGame(project);
  const games = scan.data?.games ?? [];
  const exportedGames = games.filter((g) =>
    exportedInto(project, g.primaryArchive.path),
  );
  const game =
    exportedGames.find((g) => sameGame(own, gameRecordFor(g, games))) ??
    exportedGames[0];
  const built = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const gameDefs =
    built.defs && built.defsFor === game?.primaryArchive.name
      ? built.defs
      : null;
  const gamePath = game?.primaryArchive.path;
  const receipt = gamePath ? receiptFor(project, gamePath) : null;
  // A renamed unit is a new file in the game, which has no hand edits yet.
  const key =
    receipt && receipt.unitName === project.unitName
      ? normaliseCloneKey(receipt.unitName)
      : null;
  const file = key && gameDefs ? gameDefs.units[key] : undefined;

  const next = legoUnitDef(
    project,
    bounds,
    "def",
    worthTotals(project, pack),
    weaponExportPlan(project, source.projects).slots,
  );
  // Nothing recording the builder writing the file means the export leaves all
  // of it alone.
  const last =
    receipt &&
    !writtenDigest(receipt, receipt.dir, `units/${receipt.unitName}.lua`)
      ? null
      : receipt?.def;
  const { def, kept } = withKeptFields(next, file, last);
  const weapons: WeaponInput[] =
    kept.includes("weapons") && gameDefs && key
      ? unitEffectiveWeapons(def, gameDefs.weaponDefs, [key], {}, undefined)
      : mountedWeapons(project).flatMap(({ fires }) => {
          const picked = pickedWeapon(
            fires,
            source.gameName ?? "",
            source.weaponDefs,
            source.projects,
          );
          return picked && "def" in picked ? [{ def: picked.def }] : [];
        });
  const ownStats = unitStats(def, weapons);
  const standing = budgetStanding(project.budget, ownStats.cost);
  const fields =
    file && gameDefs && key ? statFields(file, gameDefs.weaponDefs, key) : null;

  const compared = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    reference?.archive,
  );
  const comparedDefs =
    compared.defs && compared.defsFor === reference?.archive
      ? compared.defs
      : null;
  const referenceDef = reference
    ? comparedDefs?.units[reference.unit]
    : undefined;
  const referenceStats =
    reference && comparedDefs && referenceDef
      ? unitStats(
          referenceDef,
          unitEffectiveWeapons(
            referenceDef,
            comparedDefs.weaponDefs,
            [reference.unit],
            {},
            undefined,
          ),
        )
      : null;
  const referenceGame = reference?.gameName ?? "";
  const referenceName = reference?.label ?? "";
  const missingReference = !reference
    ? t`Choose a game unit with the reference button to compare.`
    : compared.status === "error"
      ? t`Could not read ${referenceGame}.`
      : !comparedDefs
        ? t`Reading ${referenceGame}`
        : !referenceDef
          ? t`${referenceName} is not in ${referenceGame}.`
          : null;
  const overBudget = standing ? figure(-standing.left) : "";
  const leftBudget = standing ? figure(standing.left) : "";

  function cell(id: StatId): ReactNode {
    const value = ownStats[id];
    if (value === null)
      return (
        <span className="text-muted-foreground">
          <Trans>None</Trans>
        </span>
      );
    const field = fields?.[id];
    return game && key && field ? (
      <Link
        to={unitEditPath(tweakProjects, game.name, key, field)}
        className="underline"
        title={t`Change in Unit tweaks`}
      >
        {figure(value)}
      </Link>
    ) : (
      figure(value)
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">
        <Trans>Stats</Trans>
      </p>
      <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
        <dt />
        <dd className="text-muted-foreground">
          <Trans>This unit</Trans>
        </dd>
        <dd className="truncate text-muted-foreground" title={reference?.label}>
          {reference?.label ?? ""}
        </dd>
        {STATS.map(({ id, label }) => (
          <StatRow
            key={id}
            label={label}
            title={id === "dps" ? dpsHelp() : undefined}
            own={
              <span className="flex flex-wrap items-center gap-1.5">
                <output aria-label={label}>{cell(id)}</output>
                <WorkshopChangeMarks
                  unitKey={workshop.key}
                  changes={workshop.changesFor(STAT_FIELDS[id] ?? [])}
                />
              </span>
            }
            reference={
              referenceStats ? (
                <output aria-label={t`${label}, ${referenceName}`}>
                  {referenceStats[id] === null ? (
                    <span className="text-muted-foreground">
                      <Trans>None</Trans>
                    </span>
                  ) : (
                    figure(referenceStats[id])
                  )}
                </output>
              ) : null
            }
          />
        ))}
      </dl>
      {onBudgetChange || project.budget !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <Label htmlFor="lego-budget" className="text-muted-foreground">
            <Trans>Budget</Trans>
          </Label>
          <Input
            id="lego-budget"
            type="number"
            min={1}
            className="h-6 w-20 text-xs"
            disabled={!onBudgetChange}
            defaultValue={project.budget ?? ""}
            key={project.budget ?? "none"}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              const next =
                event.currentTarget.value.trim() !== "" &&
                Number.isFinite(value) &&
                value > 0
                  ? value
                  : undefined;
              if (next !== project.budget) onBudgetChange?.(next);
            }}
          />
          {standing ? (
            <output
              aria-label={t`Budget left`}
              className={standing.over ? "text-destructive" : undefined}
            >
              {standing.over ? (
                <Trans>{overBudget} over</Trans>
              ) : (
                <Trans>{leftBudget} left</Trans>
              )}
            </output>
          ) : null}
        </div>
      ) : null}
      {missingReference ? (
        <p className="text-xs text-muted-foreground">{missingReference}</p>
      ) : null}
    </div>
  );
}

function StatRow({
  label,
  title,
  own,
  reference,
}: {
  label: string;
  title?: string;
  own: ReactNode;
  reference: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground" title={title}>
        {label}
      </dt>
      <dd>{own}</dd>
      <dd>{reference}</dd>
    </>
  );
}
