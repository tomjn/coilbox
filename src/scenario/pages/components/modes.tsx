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
 * Every mode picks units the way the others do: `useGameUnits` for the
 * scenario's game, `UnitDefSelect` to pick one of them.
 */

import { Button, Input } from "@picoframe/frame";
import {
  Circle,
  Factory,
  type LucideIcon,
  MousePointer2,
  Plus,
  Square,
  User,
  Users,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { buildGridSnap } from "@/blueprint/footprint";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioZone,
} from "../../model";
import { addBase, addBuilding, buildingUnits, type LayoutEdit } from "./bases";
import { addActor, parsePlacementKey } from "./editing";
import type { ScenarioEdit } from "./edits";
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
  /**
   * Change the document. Saved by the page, so a mode never persists.
   *
   * An edit is written as what to make of the document handed to it rather than
   * of `scenario`, which is the document this render was given: two clicks can
   * both be handled before React renders either of them, and the second one
   * would otherwise be built on the state before the first (issue #904).
   */
  onChange: (edit: ScenarioEdit) => void;
  /**
   * What is selected across the whole surface, which for most modes is nothing
   * to do with placing. Bases read it: a click adds to the base already
   * selected rather than starting a second one-building base beside it.
   */
  selected: string | null;
  /** What is selected at the moment of a click rather than at the last render,
   *  which is what a mode acting on the selection has to go by. */
  selectedNow: () => string | null;
  /** Select what was just placed, so it can be turned or deleted straight
   *  away. Null clears the selection, which is how a mode lets go of it. */
  onSelect: (key: string | null) => void;
  /** Whether an edit to a base names the layout every base placed from it uses,
   *  or gives that base a copy of its own. Only bases read it. */
  layoutEdit: (baseId: string) => LayoutEdit;
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
  hint: "Drag a unit to move it. Click a zone, then drag its orange middle handle to move that. Click bare ground to deselect.",
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
  hint: "Drag anywhere to draw a zone, inside another one if you like. Click a zone to select it, then drag its orange middle handle to move it. Middle-drag pans while this mode is on.",
  use: ({ onChange, onSelect }) => {
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
        const id = crypto.randomUUID();
        // Named after the zones the document has when the zone lands, so two
        // drawn one after the other are not both "Zone 1".
        onChange((doc) =>
          addZone(
            doc,
            zoneFromDrag(shape, from, to, id, nextZoneName(doc.zones)),
          ),
        );
        onSelect(zoneKey(id));
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
            onChange((doc) =>
              addActor(doc, id, { unitDef, team: owner, pos, facing: 0 }),
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
            onChange((doc) =>
              addGroup(doc, id, {
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

/** The base a placement key belongs to, which is the base a click in Bases mode
 *  adds to. Null for a key that names anything else, and for no key at all. */
function selectedBase(scenario: Scenario, key: string | null) {
  const ref = key ? parsePlacementKey(key) : null;
  return (
    (ref?.kind === "base" && scenario.bases.find((b) => b.id === ref.id)) ||
    null
  );
}

/**
 * A pre-built base: several buildings put down as one cluster.
 *
 * Laying a base out is a run of clicks, so a click adds to the base that is
 * selected and only starts a new one when nothing is. Placing a building selects
 * it, which keeps that run going, and "New base" lets go of the selection so the
 * next click starts the next base. That is also why the team picker gives way to
 * that button: a building added to a base belongs to whoever the base does.
 *
 * The picker offers the game's static units only. The runtime puts a def through
 * the engine's build grid when the game calls it a building and not otherwise,
 * so a tank in a base would spawn wherever it was dropped, off the grid and
 * unable to be rebuilt where it stood. Mobile units are what actors and groups
 * are for.
 */
const basesMode: EditorMode = {
  id: "bases",
  label: "Bases",
  icon: Factory,
  hint: "Pick a building and click the map. Clicks add to the base you have selected.",
  use: ({
    scenario,
    onChange,
    onSelect,
    selected,
    selectedNow,
    layoutEdit,
  }) => {
    const [unitDef, setUnitDef] = useState("");
    const [team, setTeam] = useState("");
    const participants = scenario.setup.participants;
    const owner = participants.some((p) => p.id === team)
      ? team
      : (participants[0]?.id ?? "");
    const { units, loading } = useGameUnits(scenario.setup.gameName);
    const options = useMemo(() => buildingUnits(units), [units]);
    // Where the engine would put what is about to be placed. Until the game's
    // units are read this is the click itself, which is the same answer for a
    // one-square building and the nearest the editor can get for any other.
    const snap = useMemo(() => buildGridSnap(units), [units]);

    // Which base the controls are for, which is whichever the selection belongs
    // to. A click works it out again from the document it is given.
    const base = selectedBase(scenario, selected);

    return {
      place: unitDef
        ? (pos: Point) => {
            // Where the click lands is decided against the document and the
            // selection as they stand: the click before this one can have made
            // the base and selected it with neither yet rendered (#904).
            const chosen = { key: "" };
            // A building goes where the engine will stand it rather than where
            // the pointer was, so what the author sees is what they will get.
            const stand = snap(pos, unitDef, 0);
            onChange((doc) => {
              const to = selectedBase(doc, selectedNow());
              if (to) {
                const at = baseBuildings(doc.blueprints, to).length;
                chosen.key = placementKey("base", to.id, at);
                return addBuilding(
                  doc,
                  to.id,
                  {
                    // Minted here rather than when a trigger first wants one,
                    // so every building the editor puts down can be named after
                    // the fact without moving the base's ids around.
                    id: crypto.randomUUID(),
                    def: unitDef,
                    // Offsets are measured from the base's origin, so what the
                    // document gets is the snapped point less that.
                    offset: {
                      x: stand.x - to.origin.x,
                      z: stand.z - to.origin.z,
                    },
                    facing: 0,
                  },
                  layoutEdit(to.id),
                );
              }
              const id = crypto.randomUUID();
              chosen.key = placementKey("base", id, 0);
              return addBase(doc, id, crypto.randomUUID(), {
                team: owner,
                origin: stand,
                buildings: [
                  {
                    id: crypto.randomUUID(),
                    def: unitDef,
                    offset: { x: 0, z: 0 },
                    facing: 0,
                  },
                ],
              });
            });
            if (chosen.key) onSelect(chosen.key);
          }
        : null,
      controls: (
        <>
          <UnitDefSelect
            units={options}
            value={unitDef}
            onValueChange={setUnitDef}
            loading={loading}
            size="sm"
            className="w-48"
          />
          {base ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-card/80 text-xs backdrop-blur"
              onClick={() => onSelect(null)}
            >
              <Plus className="size-3.5" /> New base
            </Button>
          ) : (
            <TeamSelect
              participants={participants}
              value={owner}
              onValueChange={setTeam}
            />
          )}
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
  basesMode,
];
