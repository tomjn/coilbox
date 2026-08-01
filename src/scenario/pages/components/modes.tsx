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
 * Prefab bases (#762) are added by pushing an entry onto {@link EDITOR_MODES}.
 * They pick units the way actors and groups do: `useGameUnits` for the
 * scenario's game, `UnitDefSelect` to pick one of them.
 */

import { Input } from "@picoframe/frame";
import {
  Circle,
  type LucideIcon,
  MousePointer2,
  Square,
  User,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Point, Scenario, ScenarioZone } from "../../model";
import { addActor } from "./editing";
import {
  addGroup,
  clampCount,
  DEFAULT_GROUP_COUNT,
  MAX_GROUP_COUNT,
} from "./groups";
import { placementKey } from "./placements";
import { TeamSelect } from "./TeamSelect";
import { useGameUnits } from "./useGameUnits";
import type { GroundDragPhase } from "./useMapEditing";
import {
  addZone,
  nextZoneName,
  type ZoneShape,
  zoneFromDrag,
  zoneKey,
} from "./zones";

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
   * nothing. Null is also what makes a click on bare ground clear the
   * selection.
   */
  place: ((pos: Point) => void) | null;
  /**
   * What a drag across bare ground draws, or null for a mode that draws
   * nothing. Called as the drag moves and once more when it ends or is taken
   * away, so a mode can show what it is about to make and write the document
   * only on "end". A mode that sets this takes the left button off the camera,
   * which pans on the middle button instead while the mode is current.
   */
  draw?: ((from: Point, to: Point, phase: GroundDragPhase) => void) | null;
  /**
   * Zones the mode is part way through drawing, shown alongside the document's
   * own. A half-drawn zone lives here rather than in the document, so a drag
   * never writes to disk.
   */
  draftZones?: ScenarioZone[];
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

/** The id a half-drawn zone carries. Never written to the document, and not a
 *  UUID, so it cannot collide with one that is. */
const DRAFT_ZONE_ID = "draft-zone";

/**
 * An area of the map, drawn by dragging one out.
 *
 * A box goes corner to corner and a circle out from its centre, so the gesture
 * matches the shape rather than the other way round. The zone being dragged out
 * is held here until the pointer comes up, because every change to the document
 * is saved and a drag would otherwise write a file per frame.
 */
const zonesMode: EditorMode = {
  id: "zones",
  label: "Zones",
  icon: Square,
  hint: "Drag on the map to draw a zone. Middle-drag pans while this mode is on.",
  use: ({ scenario, onChange, onSelect }) => {
    const [shape, setShape] = useState<ZoneShape>("box");
    const [draft, setDraft] = useState<ScenarioZone | null>(null);

    return {
      place: null,
      // Left undefined rather than empty when there is no draft, so the surface
      // is handed the same list twice running and does not redraw for nothing.
      draftZones: draft ? [draft] : undefined,
      draw: (from, to, phase) => {
        if (phase === "cancel") {
          setDraft(null);
          return;
        }
        if (phase === "move") {
          setDraft(zoneFromDrag(shape, from, to, DRAFT_ZONE_ID, "New zone"));
          return;
        }
        setDraft(null);
        const zone = zoneFromDrag(
          shape,
          from,
          to,
          crypto.randomUUID(),
          nextZoneName(scenario.zones),
        );
        onChange(addZone(scenario, zone));
        onSelect(zoneKey(zone.id));
      },
      controls: (
        <OptionSelect
          size="sm"
          className="w-32"
          value={shape}
          onValueChange={(next) => setShape(next as ZoneShape)}
          options={[
            { value: "box", label: "Box", icon: <Square className="size-3" /> },
            {
              value: "circle",
              label: "Circle",
              icon: <Circle className="size-3" />,
            },
          ]}
        />
      ),
    };
  },
};

/**
 * One unit at one point, which is what an actor is.
 *
 * The unit is picked from the game's own unit list, the same picker the lego
 * builder stands its reference figure with, so an author places what the game
 * has rather than what they can spell. Nothing is placed until a unit is picked:
 * an actor naming a def the game does not have draws as a marker box and spawns
 * nothing, which is not a thing a click should be able to make by accident.
 */
const actorsMode: EditorMode = {
  id: "actors",
  label: "Actors",
  icon: User,
  hint: "Pick a unit, then click the map to place one.",
  use: ({ scenario, onChange, onSelect }) => {
    const [unitDef, setUnitDef] = useState("");
    const [team, setTeam] = useState("");
    const participants = scenario.setup.participants;
    const owner = participants.some((p) => p.id === team)
      ? team
      : (participants[0]?.id ?? "");
    const { units, loading } = useGameUnits(scenario.setup.gameName);

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
          <UnitDefSelect
            units={units}
            value={unitDef}
            onValueChange={setUnitDef}
            loading={loading}
            size="sm"
            className="w-48"
          />
          <TeamSelect
            participants={participants}
            value={owner}
            onValueChange={setTeam}
          />
        </>
      ),
    };
  },
};

/**
 * A block of units at one point, which is what a group is.
 *
 * A group holds counts rather than positions, so what is placed is a number of
 * one unit type and the rest is added to it from the selection bar. The runtime
 * lays the counts out in a formation around the point, which is what the editor
 * draws, so the click puts down the middle of the block rather than its first
 * unit.
 */
const groupsMode: EditorMode = {
  id: "groups",
  label: "Groups",
  icon: Users,
  hint: "Pick a unit and a count, then click the map to place a group.",
  use: ({ scenario, onChange, onSelect }) => {
    const [unitDef, setUnitDef] = useState("");
    const [count, setCount] = useState(DEFAULT_GROUP_COUNT);
    const [team, setTeam] = useState("");
    const participants = scenario.setup.participants;
    const owner = participants.some((p) => p.id === team)
      ? team
      : (participants[0]?.id ?? "");
    const { units, loading } = useGameUnits(scenario.setup.gameName);

    return {
      place: unitDef
        ? (pos: Point) => {
            const id = crypto.randomUUID();
            onChange(
              addGroup(scenario, id, {
                team: owner,
                units: [{ def: unitDef, count }],
                pos,
                orders: [],
                dormant: false,
              }),
            );
            onSelect(placementKey("group", id, 0));
          }
        : null,
      controls: (
        <>
          <UnitDefSelect
            units={units}
            value={unitDef}
            onValueChange={setUnitDef}
            loading={loading}
            size="sm"
            className="w-48"
          />
          <Input
            aria-label="How many units"
            type="number"
            min={1}
            max={MAX_GROUP_COUNT}
            value={count}
            onChange={(e) => setCount(clampCount(Number(e.target.value)))}
            className="h-8 w-16 bg-card/80 text-xs backdrop-blur"
          />
          <TeamSelect
            participants={participants}
            value={owner}
            onValueChange={setTeam}
          />
        </>
      ),
    };
  },
};

/** Every mode the editor offers, in the order the strip shows them. */
export const EDITOR_MODES: EditorMode[] = [
  selectMode,
  zonesMode,
  actorsMode,
  groupsMode,
];
