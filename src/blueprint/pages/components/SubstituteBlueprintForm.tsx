/**
 * The conversion panel with this machine's answers in it (issue #1314).
 *
 * Three reads, all of the layout's own game: its units, which is where the
 * footprints and the check that a substitute exists come from, its sides, which
 * is what coilbox can read a suggested mapping out of, and its table, which is
 * what somebody already said about it (issue #1468). Only the table survives the
 * game not being installed, and a table with nothing to check against is no use,
 * so the panel says so rather than offering a conversion it cannot check.
 *
 * A fourth read is offered rather than done: the table the game itself publishes
 * (issue #1526), which one game in the world does.
 *
 * The panel itself is pure and tested. This is the half that cannot be.
 */

import { UnitGameProvider } from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import { useEquivalents } from "../../equivalentsStore";
import {
  libraryLayout,
  recordGameName,
  type StoredBlueprint,
} from "../../library";
import type { BaseBlueprint } from "../../model";
import { useGameSides } from "../../useGameSides";
import { useShippedEquivalents } from "../../useShippedEquivalents";
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
  const { table, remember } = useEquivalents(archive);
  const shipped = useShippedEquivalents(archive, sides);

  return (
    <UnitGameProvider gameArchive={archive}>
      <SubstitutionPanel
        layout={libraryLayout(record)}
        sides={sides}
        table={table}
        units={units}
        unitsLoading={loading}
        onApply={onApply}
        onRemember={remember}
        onReadShipped={shipped.read}
        readingShipped={shipped.reading}
        shippedNote={shipped.note}
      />
    </UnitGameProvider>
  );
}
