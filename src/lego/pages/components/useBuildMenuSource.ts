/**
 * The game a unit's loadouts go on a build menu of: its name, the folder its
 * units are exported into, and its unit table, which is where the builders are
 * read from (issue #3288). The same game and table the weapon picker reads.
 */

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
  const named = own?.name ?? "The game it was exported into";
  const unavailable =
    !own && !(legacy && project.exported)
      ? "Choose a game for this unit first."
      : !targetLoading && !target
        ? "No engine is installed, so the game cannot be read."
        : scan.error
          ? `The content scan failed: ${scan.error}`
          : scan.data && !game
            ? `${named} is not installed.`
            : status === "error"
              ? `Could not read ${game?.name ?? named}: ${error ?? "its definitions could not be read"}`
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
