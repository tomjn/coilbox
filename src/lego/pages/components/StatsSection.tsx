/**
 * The unit's cost, health, speed, range and damage per second, beside the same
 * numbers for the game unit chosen with the reference button (issue #3293).
 *
 * Read only. A number is changed on the workshop's unit page, so once the unit
 * is exported into a game each one links to its field there. The numbers are
 * the definition the next export would write, except a field that was changed
 * by hand in the game's file, which shows the file's value. See `unitStats.ts`.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";
import { normaliseCloneKey } from "@/workshop/clones";
import { useUnitDefs } from "@/workshop/config";
import { DPS_HELP, type WeaponInput } from "@/workshop/derivedStats";
import { exportedInto } from "@/workshop/legoUnits";
import { useModProjects } from "@/workshop/project";
import { unitEditPath } from "@/workshop/routes";
import { unitEffectiveWeapons } from "@/workshop/unitWeapons";
import { receiptFor } from "../../exportRecord";
import type { LegoProject } from "../../model";
import { unitGame } from "../../movement";
import type { LoadedPack } from "../../pack";
import { writtenDigest } from "../../reexport";
import type { UnitBounds } from "../../s3oBuild";
import { legoUnitDef } from "../../unitDef";
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

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  bounds: UnitBounds;
  /** The game unit to compare with, or null when none is chosen. */
  reference: ReferenceUnit | null;
}

function figure(value: number): string {
  return Number(value.toFixed(1)).toLocaleString();
}

export function StatsSection({ project, pack, bounds, reference }: Props) {
  const { target, scan } = useTestGame();
  const { projects: tweakProjects } = useModProjects();
  const source = useWeaponSource(project);

  // The game the unit was exported into, which is where its file is.
  const own = unitGame(project);
  const exportedGames = (scan.data?.games ?? []).filter((g) =>
    exportedInto(project, g.primaryArchive.path),
  );
  const game =
    exportedGames.find((g) => own && g.primaryArchive.name === own.archive) ??
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
  const missingReference = !reference
    ? "Choose a game unit with the reference button to compare."
    : compared.status === "error"
      ? `Could not read ${reference.gameName}.`
      : !comparedDefs
        ? `Reading ${reference.gameName}`
        : !referenceDef
          ? `${reference.label} is not in ${reference.gameName}.`
          : null;

  function cell(id: StatId): ReactNode {
    const value = ownStats[id];
    if (value === null)
      return <span className="text-muted-foreground">None</span>;
    const field = fields?.[id];
    return game && key && field ? (
      <Link
        to={unitEditPath(tweakProjects, game.name, key, field)}
        className="underline"
        title="Change in Unit tweaks"
      >
        {figure(value)}
      </Link>
    ) : (
      figure(value)
    );
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">Stats</p>
      <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-xs tabular-nums">
        <dt />
        <dd className="text-muted-foreground">This unit</dd>
        <dd className="truncate text-muted-foreground" title={reference?.label}>
          {reference?.label ?? ""}
        </dd>
        {STATS.map(({ id, label }) => (
          <StatRow
            key={id}
            label={label}
            title={id === "dps" ? DPS_HELP : undefined}
            own={<output aria-label={label}>{cell(id)}</output>}
            reference={
              referenceStats ? (
                <output aria-label={`${label}, ${reference?.label}`}>
                  {referenceStats[id] === null ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    figure(referenceStats[id])
                  )}
                </output>
              ) : null
            }
          />
        ))}
      </dl>
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
