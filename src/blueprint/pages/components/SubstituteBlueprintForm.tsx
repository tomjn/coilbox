/**
 * The conversion panel with this machine's answers in it (issue #1314).
 *
 * Two reads, both of the layout's own game: its units, which is where the
 * footprints and the check that a substitute exists come from, and its sides,
 * which is the only thing coilbox can read a suggested mapping out of. Neither
 * is available for a game that is not installed, and the panel says so rather
 * than offering a conversion it cannot check.
 *
 * The panel itself is pure and tested. This is the half that cannot be.
 */

import { useGameUnits } from "@/content/useGameUnits";
import {
  libraryLayout,
  recordGameName,
  type StoredBlueprint,
} from "../../library";
import type { BaseBlueprint } from "../../model";
import { useGameSides } from "../../useGameSides";
import { SubstitutionPanel } from "./SubstitutionPanel";

export function SubstituteBlueprintForm({
  record,
  onApply,
}: {
  record: StoredBlueprint;
  onApply: (layout: BaseBlueprint) => void;
}) {
  const gameName = recordGameName(record);
  const { units, loading, archive } = useGameUnits(gameName);
  const sides = useGameSides(archive);

  return (
    <SubstitutionPanel
      layout={libraryLayout(record)}
      sides={sides}
      units={units}
      unitsLoading={loading}
      onApply={onApply}
    />
  );
}
