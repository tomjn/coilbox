/**
 * The editor's placement modes, and the seam each one is added through.
 *
 * A mode decides one thing: what a click on empty ground does. Everything else
 * about pointing at the map, picking a drawn unit up, dragging it, turning it
 * and deleting it, is shared and lives in `useMapEditing.ts` and `editing.ts`,
 * so a mode is only ever the part that is different.
 *
 * A mode is resolved by calling its `use`, which is a hook: it may hold the
 * mode's own state, such as the unit type it is about to place. The list is
 * static and every entry is resolved on every render, in order, so that is safe.
 *
 * Zones (#759), groups (#761) and prefab bases (#762) are added by pushing an
 * entry onto {@link EDITOR_MODES}. Actors is here already because the shared
 * interaction needs one real mode to be worth anything, and it is deliberately
 * thin: #760 replaces its unit def field with the game unit browser from lego,
 * and takes over what an actor is placed with.
 */

import { Input } from "@picoframe/frame";
import { type LucideIcon, MousePointer2, User } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Participant } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Point, Scenario } from "../../model";
import { addActor } from "./editing";
import { placementKey } from "./placements";

/** What a mode is given: the document as it stands, and the way to change it. */
export interface ModeContext {
  scenario: Scenario;
  /** Write a new document. Saved by the page, so a mode never persists. */
  onChange: (next: Scenario) => void;
  /** Select what was just placed, so it can be turned or deleted straight
   *  away. */
  onSelect: (key: string) => void;
}

/** What a resolved mode contributes to the surface. */
export interface ModeBehaviour {
  /**
   * What a click on empty ground puts down, or null for a mode that places
   * nothing. Null is also what makes the pointer an arrow rather than a
   * crosshair, and what makes a click on bare ground clear the selection.
   */
  place: ((pos: Point) => void) | null;
  /** The mode's own controls, shown beside the mode strip. */
  controls?: ReactNode;
}

export interface EditorMode {
  id: string;
  label: string;
  icon: LucideIcon;
  /** One line under the strip saying what a click will do. */
  hint: string;
  /** Resolve the mode against the current document. A hook. */
  use: (ctx: ModeContext) => ModeBehaviour;
}

/** Looking without touching: pick things up, move them, turn them, but put
 *  nothing new down. Where the editor opens, so a stray click on a scenario you
 *  are only reading cannot add to it. */
const selectMode: EditorMode = {
  id: "select",
  label: "Select",
  icon: MousePointer2,
  hint: "Drag a unit to move it. Click bare ground to deselect.",
  use: () => ({ place: null }),
};

/** One unit at one point, which is what an actor is. */
const actorsMode: EditorMode = {
  id: "actors",
  label: "Actors",
  icon: User,
  hint: "Click the map to place one unit.",
  use: ({ scenario, onChange, onSelect }) => {
    const [def, setDef] = useState("");
    const [team, setTeam] = useState("");
    const participants = scenario.setup.participants;
    const owner = participants.some((p) => p.id === team)
      ? team
      : (participants[0]?.id ?? "");
    const unitDef = def.trim();

    return {
      place: unitDef
        ? (pos: Point) => {
            const id = crypto.randomUUID();
            onChange(
              addActor(scenario, id, { unitDef, team: owner, pos, facing: 0 }),
            );
            onSelect(placementKey("actor", id));
          }
        : null,
      controls: (
        <>
          <Input
            aria-label="Unit to place"
            placeholder="Unit def, e.g. armpw"
            value={def}
            onChange={(e) => setDef(e.target.value)}
            className="h-8 w-44 text-xs"
          />
          <OptionSelect
            size="sm"
            className="w-36"
            value={owner}
            onValueChange={setTeam}
            placeholder="Team"
            options={participants.map((p) => ({
              value: p.id,
              label: p.name,
              icon: <Swatch participant={p} />,
            }))}
          />
        </>
      ),
    };
  },
};

/** A participant's colour, so a team is picked by the colour its units are
 *  drawn in rather than by a name that is often just "AI 1". */
function Swatch({ participant }: { participant: Participant }) {
  const [r, g, b] = participant.color;
  return (
    <span
      className="size-3 shrink-0 rounded-sm border border-border/60"
      style={{
        backgroundColor: `rgb(${r * 255} ${g * 255} ${b * 255})`,
      }}
    />
  );
}

/** Every mode the editor offers, in the order the strip shows them. */
export const EDITOR_MODES: EditorMode[] = [selectMode, actorsMode];
