/**
 * The grouped, collapsible field list (issue #1270).
 *
 * The headings and the order come from `unitSections.ts`. This only draws them,
 * and a section with nothing in it never reaches here, so an empty collapsible
 * is not a state that exists.
 *
 * Sections start open. In the relevant view they hold a handful of rows each,
 * and a page that opens with eight closed drawers makes the reader do the work
 * of finding out which one has anything in it. The count in each header is what
 * says whether opening one is worth it in the all view.
 *
 * A section is a {@link SectionPanel}, the same card the scenario editor's
 * panels are, because the two are the same thing and the thinner row this drew
 * before read as a table row (issue #2693). The group above them is not: a card
 * holding cards says nothing, so a group is a label and a rule over its stack.
 * The rows inside stay as tight as they were, which is why the panel takes its
 * content padding from the caller: a unit shows a few dozen of them at once and
 * 260 or so in the all view.
 */
import {
  Box,
  Braces,
  Coins,
  Crosshair,
  Gamepad2,
  Grid2x2,
  HeartPulse,
  type LucideIcon,
  Move,
  Package,
  Radar,
  Settings2,
  Skull,
  Swords,
  Tags,
} from "lucide-react";
import { SectionPanel } from "@/components/SectionPanel";
import type { CustomParamsResult } from "@/content/bindings";
import type { AssetBrowsing } from "../../assetFields";
import { consumerNote } from "../../customParamConsumers";
import type { FieldRow, UnitFieldView } from "../../unitSections";
import { type FieldChoices, UnitFieldRow } from "./UnitFieldRow";

/**
 * The icon on each section's header, keyed by the section id `unitSections.ts`
 * gives it. Kept here rather than in that module because it is how a section is
 * drawn, not what belongs in it, and a section whose id is missing from this
 * table gets the same icon a field row would: something the game declares and
 * nobody has classified.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  economy: Coins,
  durability: HeartPulse,
  classification: Tags,
  death: Skull,
  movement: Move,
  sensors: Radar,
  collision: Box,
  footprint: Grid2x2,
  weapons: Crosshair,
  combat: Swords,
  assets: Package,
  customParams: Braces,
  unplaced: Settings2,
  game: Gamepad2,
};

export function UnitFieldGroups({
  view,
  consumers,
  assets,
  choices,
  warnings,
  inheritedLabel,
  onChange,
  onReset,
}: {
  view: UnitFieldView;
  /** What a field is allowed to name, keyed by lowercased path, for the fields
   *  that name something the game declares rather than take free text (issue
   *  #2651). Lowercased because a path is the game's own spelling of a key, and
   *  the games do not agree on it: the registry says `movementClass` and
   *  Balanced Annihilation says `movementclass`. */
  choices?: Record<string, FieldChoices>;
  /** Something wrong with a field that only its neighbours reveal, keyed the
   *  same way (issue #2651). */
  warnings?: Record<string, string>;
  /** The game's archive, for the fields that name a file in it (issue #2648). */
  assets?: AssetBrowsing;
  /** The game's custom parameter consumer index, or `null` while it is still
   *  being read. Only custom parameter rows use it (issue #2661). */
  consumers: CustomParamsResult | null;
  /** What to call the value underneath an edit, for a unit whose definition is
   *  not the game's. */
  inheritedLabel?: string;
  onChange: (row: FieldRow, value: unknown) => void;
  onReset: (row: FieldRow) => void;
}) {
  if (view.groups.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        This unit's definition is empty.
      </p>
    );

  return (
    <div className="flex flex-col gap-8">
      {view.groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
            <span className="h-px flex-1 bg-border/50" />
          </h3>
          {group.sections.map((section) => {
            const changed = section.rows.filter(
              (r) => r.state === "overridden",
            ).length;
            return (
              <SectionPanel
                key={section.id}
                defaultOpen
                headingLevel={4}
                title={section.label}
                icon={SECTION_ICONS[section.id] ?? Settings2}
                contentClassName="flex flex-col gap-0.5 p-1"
                summary={
                  <>
                    <span>
                      {section.rows.length}{" "}
                      {section.rows.length === 1 ? "field" : "fields"}
                    </span>
                    {changed > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 text-primary">
                        {changed} changed
                      </span>
                    )}
                  </>
                }
              >
                {section.rows.map((row) => (
                  <UnitFieldRow
                    key={row.path}
                    row={row}
                    note={consumerNote(row.path, consumers) ?? undefined}
                    assets={assets}
                    choices={choices?.[row.path.toLowerCase()]}
                    warning={warnings?.[row.path.toLowerCase()]}
                    inheritedLabel={inheritedLabel}
                    onChange={(value) => onChange(row, value)}
                    onReset={() => onReset(row)}
                  />
                ))}
              </SectionPanel>
            );
          })}
        </section>
      ))}
    </div>
  );
}
