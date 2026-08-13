/**
 * Converting a base in a mission, with this game's answers in it (issue #1525).
 *
 * The same three reads the library's own conversion does, over the same panel:
 * the game's units and sides come down from the scene, which resolved them to
 * draw the map, and the table is read here from the archive they were resolved
 * against (issue #1468). What this surface adds is the factory queues, which are
 * the half no naming route ever reaches, so the table is worth more here than
 * anywhere else and this was the one surface without it.
 *
 * A component rather than props built where the drawer is opened, because the
 * drawer holds the element it was given. A table that grew while the drawer is
 * open, which is what reading the game's own file does (issue #1526), only
 * reaches the panel if the read that feeds it is inside the drawer's own tree.
 */

import { useEquivalents } from "@/blueprint/equivalentsStore";
import type { BaseBlueprint } from "@/blueprint/model";
import { SubstitutionPanel } from "@/blueprint/pages/components/SubstitutionPanel";
import type { SideUnits, SubstitutionPlan } from "@/blueprint/substitution";
import { useShippedEquivalents } from "@/blueprint/useShippedEquivalents";
import type { UnitDatasetEntry } from "@/content/bindings";

export function SubstituteBaseForm({
  layout,
  queued,
  gameArchive,
  sides,
  units,
  unitsLoading,
  onApply,
}: {
  /** The layout this base is placed from, which is what a conversion converts. */
  layout: BaseBlueprint;
  /** Every unit this base's factories are told to build (issue #1493). */
  queued: readonly string[];
  /** The game this mission is on, as the archive its units were read out of.
   *  Undefined for a game that is not installed, which is a panel with nothing
   *  to check a substitute against and no table to key. */
  gameArchive: string | undefined;
  /** What this game calls each side's units, already read by the scene. */
  sides: readonly SideUnits[];
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** The converted layout and the plan that converted it, for the document to
   *  take through the same layout edit as a drag. */
  onApply: (layout: BaseBlueprint, plan: SubstitutionPlan) => void;
}) {
  const { table, remember } = useEquivalents(gameArchive);
  const shipped = useShippedEquivalents(gameArchive, sides);

  return (
    <SubstitutionPanel
      layout={layout}
      queued={queued}
      sides={sides}
      table={table}
      units={units}
      unitsLoading={unitsLoading}
      onApply={onApply}
      onRemember={remember}
      onReadShipped={shipped.read}
      readingShipped={shipped.reading}
      shippedNote={shipped.note}
    />
  );
}
