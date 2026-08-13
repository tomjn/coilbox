/**
 * The units of the game a document is written for.
 *
 * A mode that puts units on the map has to offer the units that game has,
 * resolved the same way the scene resolves the models it draws them with: the
 * scan the launcher uses, keyed by the game name the document carries. It is a
 * hook of its own rather than part of `useScenarioUnits` because a picker needs
 * the list and not the layer, and because groups (#761) and base bases (#762)
 * ask the same question.
 *
 * Both reads are cached per target for the session, so every mode asking is one
 * read rather than one each.
 */

import { usePreferredTarget } from "@/play/config";
import type { UnitDatasetEntry } from "./bindings";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "./config";

export interface GameUnits {
  /** Every unit the game has, unsorted. Empty until it has been read. */
  units: UnitDatasetEntry[];
  /** A read is in flight, so an empty list is not yet an answer. */
  loading: boolean;
  /** The game is not among the installed content, so there are no units to
   *  offer and there never will be until it is installed. */
  gameMissing: boolean;
  /** The archive the units came out of, which is also what a model read of one
   *  of them has to be made against. Undefined until the game is found. */
  archive?: string;
}

export function useGameUnits(gameName: string): GameUnits {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game = scan.data?.games.find((g) => g.name === gameName);
  const { dataset, status } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );

  return {
    units: dataset?.units ?? [],
    loading: scan.loading || status === "loading",
    gameMissing: !!gameName && !!scan.data && !game,
    archive: game?.primaryArchive.name,
  };
}
