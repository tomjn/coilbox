import { Button } from "@picoframe/frame";
import { List } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { FootprintMark } from "@/blueprint/footprint";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { removeBlueprint } from "@/lib/scenarioEditing/bases";
import type { LayoutChoice } from "@/lib/scenarioEditing/layoutPlacing";
import { UncheckedNote, WaterlessNote } from "@/placement/LayoutControls";
import { sceneUnchecked } from "@/placement/placements";
import { HistoryControls, SelectionTools } from "@/placement/SurfaceBars";
import type { ScenarioUnitsState } from "@/placement/useScenarioUnits";
import type { Participant } from "@/play/config";
import type { Scenario } from "../../model";
import { ContentsList } from "./ContentsList";
import type { ContentEntry, LayoutEntry } from "./contents";
import type { ScenarioEdit } from "./edits";
import { EDITOR_MODES, LAYOUTS_MODE_ID } from "./modes";
import { UnitsNote } from "./ScenarioMapBars";

/**
 * The three surface regions `ScenarioMapScene.tsx` builds outside its `bars`
 * column: the rail down the left, the Contents popover in the corner, and the
 * notes about the whole scene (issue #2515's third boundary).
 *
 * Grouped by where each sits on the surface rather than by whether it calls
 * `onChange`, unlike `ScenarioMapSceneBars.tsx`'s split: `ScenarioModeRail` and
 * `MapFootnotes` read only the props they are given, but `ScenarioContentsPopover`
 * deletes a layout through `onChange` the same way a bar does. A reviewer
 * reading the rail, the popover or the notes is reading one region of the
 * screen, and that is the reason to find them together here.
 */

/**
 * The modes as a rail down the left, with undo and redo above them and Turn
 * and delete below, while there is something to act on.
 *
 * One segmented group, the way the unit builder's viewport draws its handles,
 * and opaque: a translucent button on terrain takes whatever is under it, so
 * the same control reads differently over grass and over snow. The tooltip is
 * where each mode says its name, what it makes and the key that reaches it.
 */
export function ScenarioModeRail({
  history,
  modeId,
  onModeChange,
  tools,
}: {
  history?: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
  };
  modeId: string;
  onModeChange: (id: string) => void;
  tools: ComponentProps<typeof SelectionTools> | null;
}) {
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        {history && <HistoryControls {...history} vertical />}
        <ButtonGroup orientation="vertical">
          {EDITOR_MODES.map((m, i) => (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  // The pair the unit builder's viewport uses for the handle
                  // it is on. `bg-card` only on the ones that are off: an
                  // outline button has no fill of its own, and a see-through
                  // control on terrain takes whatever is under it.
                  variant={modeId === m.id ? "default" : "outline"}
                  className={modeId === m.id ? undefined : "bg-card"}
                  onClick={() => onModeChange(m.id)}
                  // The name is in the tooltip, which a pointer reaches and a
                  // screen reader does not, so the button carries it as its
                  // accessible name as well.
                  aria-label={m.label}
                  aria-pressed={modeId === m.id}
                >
                  <m.icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-56">
                <p className="font-medium">{m.label}</p>
                <p className="opacity-80">{m.what}</p>
                <p className="opacity-60">Key {i + 1}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </ButtonGroup>
        {tools && <SelectionTools {...tools} />}
      </div>
    </TooltipProvider>
  );
}

/** Everything the document holds, placed or not, behind the corner button
 *  that opens it (issue #1450). */
export function ScenarioContentsPopover({
  open,
  onOpenChange,
  entries,
  layouts,
  selected,
  participants,
  onPick,
  onToggle,
  onChange,
  setLayoutChoice,
  setModeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ContentEntry[];
  layouts: LayoutEntry[];
  selected: ReadonlySet<string>;
  participants: Participant[];
  onPick: (entry: ContentEntry) => void;
  onToggle: (entry: ContentEntry) => void;
  onChange: (edit: ScenarioEdit) => void;
  setLayoutChoice: (choice: LayoutChoice | null) => void;
  setModeId: (id: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 bg-card"
          title="Everything this scenario holds, placed or not"
        >
          <List className="size-3.5" /> Contents
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <ContentsList
          entries={entries}
          layouts={layouts}
          selected={selected}
          participants={participants}
          onPick={onPick}
          onToggle={onToggle}
          // Armed rather than placed. Where a base stands is the reason the
          // author deleted it, so the next click on the map is the placement
          // and this only gets them ready to make it (#1450).
          onPlaceLayout={(layout) => {
            setLayoutChoice({ from: "scenario", id: layout.id });
            setModeId(LAYOUTS_MODE_ID);
            onOpenChange(false);
          }}
          onDeleteLayout={(layout) =>
            onChange((doc) => removeBlueprint(doc, layout.id))
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/** What is true of the whole map at once, said once rather than per base in a
 *  popover two clicks away (issue #1496), plus what was drawn and what could
 *  not be (issue #1552). Held back until the reads have settled, so an editor
 *  opening does not greet anybody with a warning that clears itself. */
export function MapFootnotes({
  scenario,
  units,
  footprints,
  waterless,
}: {
  scenario: Scenario;
  units: ScenarioUnitsState;
  footprints: FootprintMark[];
  waterless: number | null;
}): ReactNode {
  return (
    <>
      {/* Down here with the count of what was drawn rather than over the
          ground the author is working on (issue #2285): all three are
          statements about how far the whole scene can be trusted, none of
          them changes while anybody works, and none is answered by doing
          anything to the spot under the pointer. Left-aligned inside a corner
          that otherwise right-aligns, because these are sentences rather
          than the tally under them. */}
      <div className="flex max-w-full flex-col items-end gap-1 text-left">
        <UncheckedNote
          unchecked={units.settled ? sceneUnchecked(footprints) : null}
          flattened={units.heightsUnread}
        />
        <WaterlessNote floor={waterless} />
      </div>
      <UnitsNote
        units={units}
        gameName={scenario.setup.gameName}
        drawing={units.drawing}
      />
    </>
  );
}
