/**
 * Whether the unit fits its game: armour class, categories and movement class
 * (issue #3305). See `gameFit.ts` for what each row means. It changes nothing.
 */

import { Link } from "react-router";
import { normaliseArmorDefs } from "../../../workshop/armorClasses";
import { useUnitDefs } from "../../../workshop/config";
import { exportedInto } from "../../../workshop/legoUnits";
import { useModProjects } from "../../../workshop/project";
import { unitEditPath } from "../../../workshop/routes";
import { type FitRow, gameFit } from "../../gameFit";
import type { LegoProject } from "../../model";
import type { UnitBounds } from "../../s3oBuild";
import { legoUnitDef } from "../../unitDef";
import { installedGameFor, unitGame } from "../../unitGame";
import { useTestGame } from "./useTestGame";

interface Props {
  project: LegoProject;
  bounds: UnitBounds;
}

export function GameFitSection({ project, bounds }: Props) {
  const { target, targetLoading, scan } = useTestGame();
  const { projects: tweakProjects } = useModProjects();
  const own = unitGame(project);
  const game = installedGameFor(own, scan.data?.games ?? []);
  const { defs, defsFor, status, error } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const current = defs && defsFor === game?.primaryArchive.name ? defs : null;

  const unavailable = !own
    ? "Choose a game for this unit to check it against."
    : !targetLoading && !target
      ? "No engine is installed, so the game cannot be read."
      : scan.error
        ? `The content scan failed: ${scan.error}`
        : scan.data && !game
          ? `${own.name} is not installed, so it cannot be read.`
          : status === "error"
            ? `Could not read ${own.name}: ${error ?? "its definitions could not be read"}`
            : !current
              ? `Reading ${own.name}`
              : null;

  let rows: FitRow[] = [];
  let fromFile = false;
  let editPath: string | null = null;
  if (!unavailable && current && game) {
    // Once the unit is exported into this game and read back, the game's own
    // entry is the truth, hand edits included (issue #3313). Before that, the
    // definition the builder would write.
    const key = (project.exported?.unitName ?? project.unitName).toLowerCase();
    const entry =
      project.exported && exportedInto(project, game.primaryArchive.path)
        ? current.units[key]
        : undefined;
    fromFile = !!entry;
    // No totals: the rows read armour, categories and movement, which the
    // totals do not change.
    rows = gameFit(entry ?? legoUnitDef(project, bounds, "def", null), key, {
      units: current.units,
      moveDefs: current.moveDefs,
      armorDefs: normaliseArmorDefs(current.armorDefs),
    });
    if (fromFile) editPath = unitEditPath(tweakProjects, game.name, key);
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">Fit to the game</p>
      {unavailable ? (
        <p className="text-xs text-muted-foreground">{unavailable}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {fromFile
              ? "From the exported file"
              : "As the builder would write it"}
          </p>
          {rows.map((row) => (
            <div key={row.id} className="text-xs">
              <p
                className={
                  row.status === "warn" ? "text-destructive" : undefined
                }
              >
                {row.text}
              </p>
              {row.suggested && row.suggested.length > 0 ? (
                <p className="text-muted-foreground">
                  Similar units use {row.suggested.join(", ")}.
                </p>
              ) : null}
              {row.status === "warn" && row.id !== "movement" && editPath ? (
                <Link to={editPath} className="underline">
                  Change in Unit tweaks
                </Link>
              ) : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
