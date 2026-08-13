/**
 * What a game calls each side's units, for the three surfaces that convert a
 * layout between them (issues #1314, #1466, #1467).
 *
 * One read of the game's own info, turned into the prefixes `./substitution.ts`
 * reasons about. It is a hook rather than a call because the read goes through
 * unitsync, and it takes the archive rather than the game name because every
 * caller has already resolved one to get the units: an archive nobody found is
 * no sides, which is the honest answer for a game that is not installed.
 *
 * Empty is not a failure. A game whose sides cannot be told apart from their
 * start units offers no mapping, and the surfaces above ask the person instead
 * or say nothing at all.
 */

import { useMemo } from "react";
import { useUnitsyncGameInfo } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { type SideUnits, sideUnitPrefixes } from "./substitution";

export function useGameSides(gameArchive?: string): SideUnits[] {
  const { target } = usePreferredTarget();
  const { info } = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    gameArchive,
  );
  return useMemo(() => sideUnitPrefixes(info?.sides ?? []), [info]);
}
