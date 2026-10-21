/**
 * What each building of a layout does, from the units of the game it names.
 *
 * Read through `useGameUnits`, the same cached read the blueprint page uses for
 * footprints, so every card of one game is one read. Undefined until the units
 * have been read, and for a game that is not installed, which draws every
 * building in the drawing's own colour.
 */

import { useMemo } from "react";

import { useGameUnits } from "@/content/useGameUnits";
import { type BuildingRole, buildingRoles } from "./role";

export function useBuildingRoles(game?: {
  name?: string | null;
  shortname?: string | null;
}): ((def: string) => BuildingRole | undefined) | undefined {
  const { units } = useGameUnits(
    game?.name ?? "",
    game?.shortname ?? undefined,
  );
  return useMemo(
    () => (units.length > 0 ? buildingRoles(units) : undefined),
    [units],
  );
}
