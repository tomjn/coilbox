/**
 * The unit's own definition as the game it was exported into has it, which is
 * where a yardmap or a build list written by the workshop would be (issue
 * #3291). Absent until the unit is exported and the game is read.
 */

import { normaliseCloneKey } from "../../../workshop/clones";
import { useUnitDefs } from "../../../workshop/config";
import { exportedInto } from "../../../workshop/legoUnits";
import type { LegoProject } from "../../model";
import { useTestGame } from "./useTestGame";

export function useBuiltUnitDef(project: LegoProject | null | undefined) {
  const { target, scan } = useTestGame();
  const game = project
    ? scan.data?.games.find((g) => exportedInto(project, g.primaryArchive.path))
    : undefined;
  const { defs, defsFor } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const key = project?.exported
    ? normaliseCloneKey(project.exported.unitName)
    : null;
  const def =
    key && defs && defsFor === game?.primaryArchive.name
      ? (defs.units[key] as Record<string, unknown> | undefined)
      : undefined;
  return { game, key, def };
}
