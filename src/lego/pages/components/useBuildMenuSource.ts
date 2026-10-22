/**
 * The game a unit's loadouts go on a build menu of: its name, the folder its
 * units are exported into, and its unit table, which is where the builders are
 * read from (issue #3288). The same game and table the weapon picker reads.
 */

import { useLingui } from "@lingui/react/macro";
import type { GameItem } from "@/content/bindings";
import { useUnitDefs } from "../../../workshop/config";
import { exportedInto } from "../../../workshop/legoUnits";
import type { LegoProject } from "../../model";
import { installedGameFor, unitGame } from "../../unitGame";
import { useTestGame } from "./useTestGame";

export interface BuildMenuSource {
  gameName: string | null;
  /** The folder the game's units are exported into. */
  gameFolder: string | null;
  /** The game's unit table. Null until it is read. */
  units: Record<string, unknown> | null;
  /** What the game checksummed to, for a project started here. */
  checksum: string | undefined;
  /** The installed games, which name a new project's game. */
  installed: GameItem[];
  /** Why there is nothing to pick from, or null. */
  unavailable: string | null;
}

export function useBuildMenuSource(project: LegoProject): BuildMenuSource {
  const { t } = useLingui();
  const { target, targetLoading, scan } = useTestGame();
  const own = unitGame(project);
  const installed = scan.data?.games ?? [];
  const legacy = project.game === undefined;
  const game = own
    ? installedGameFor(own, installed)
    : legacy
      ? installed.find((g) => exportedInto(project, g.primaryArchive.path))
      : undefined;
  const { defs, defsFor, status, error } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const current = defs && defsFor === game?.primaryArchive.name ? defs : null;
  const named = own?.name ?? t`The game it was exported into`;
  const scanError = scan.error;
  const gameLabel = game?.name ?? named;
  const reason = error ?? t`its definitions could not be read`;
  const unavailable =
    !own && !(legacy && project.exported)
      ? t`Choose a game for this unit first.`
      : !targetLoading && !target
        ? t`No engine is installed, so the game cannot be read.`
        : scanError
          ? t`The content scan failed: ${scanError}`
          : scan.data && !game
            ? t`${named} is not installed.`
            : status === "error"
              ? t`Could not read ${gameLabel}: ${reason}`
              : null;
  return {
    gameName: game?.name ?? null,
    gameFolder: game?.primaryArchive.path ?? null,
    units: current?.units ?? null,
    checksum: current?.checksum,
    installed,
    unavailable,
  };
}
