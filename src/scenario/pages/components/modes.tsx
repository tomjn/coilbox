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
 * scenario's game, `UnitPickerButton` to pick one of them.
 */

import { Button, Input } from "@picoframe/frame";
import {
  Blocks,
  Circle,
  Factory,
  type LucideIcon,
  MousePointer2,
  Plus,
  Square,
  User,
  Users,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildGridSnap } from "@/blueprint/footprint";
import { useBlueprintLibrary } from "@/blueprint/store";
import { blueprintFromPayload } from "@/blueprint/transfer";
import { knownUnits } from "@/blueprint/units";
import { useUnitsyncScan } from "@/content/config";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import {
  type Placement,
  parsePlacementKey,
  placementKey,
} from "@/placement/placements";
import type { PreviewBuilding } from "@/placement/preview";
import type { GestureKeys, GroundDragPhase } from "@/placement/useMapEditing";
import { usePreferredTarget } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioZone,
} from "../../model";
import {
  addBase,
  addBuilding,
  buildingUnits,
  type LayoutEdit,
  placeBlueprint,
} from "./bases";
import { takeBlueprint } from "./blueprintImport";
import { addActor } from "./editing";
import type { ScenarioEdit } from "./edits";
import {
  addGroup,
  clampCount,
  DEFAULT_GROUP_COUNT,
  MAX_GROUP_COUNT,
} from "./groups";
import { isTypingTarget } from "./history";
import { LayoutPlacer, layoutPlacement } from "./LayoutPlacer";
import { type LayoutChoice, layoutGhost, layoutOrigin } from "./layoutPlacing";
import type { PathSource } from "./orderPaths";
import { boxFromDrag, keysInBox } from "./selection";
import { TeamSelect } from "./TeamSelect";
import {
  addZone,
  MARQUEE_ZONE_ID,
  nextZoneName,
  type ZoneShape,
  zoneFromDrag,
  zoneFromPoint,
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
  /**
   * Every unit the map is currently drawing. Only the marquee reads it, to work
   * out what is standing inside the box it was dragged out over (issue #2279).
   */
  placements: Placement[];
  /**
   * Every path the document draws, a group's own and the ones its triggers
   * hand out. Only the marquee reads it, to work out which waypoints stand
   * inside the box it was dragged out over (issue #2355).
   */
  paths: PathSource[];
  /** Select several things at once: instead of what is selected, or as well as
   *  it when `add` (issue #2279). Only the marquee uses it. */
  onSelectMany: (keys: string[], add: boolean) => void;
  /** Whether an edit to a base names the layout every base placed from it uses,
   *  or gives that base a copy of its own. Only bases read it. */
  layoutEdit: (baseId: string) => LayoutEdit;
  /**
   * The layout the Layouts mode is about to place, and the way to change it.
   * Only that mode reads it.
   *
   * Held by the surface rather than inside the mode, because something else
   * arms it: the row for an unplaced layout in the contents list is where an
   * author goes to put a deleted base back, and pressing it has to reach into
   * the mode it switches to (issue #1450).
   */
  layout: LayoutChoice | null;
  onLayout: (choice: LayoutChoice | null) => void;
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
   *
   * `keys` is what was held when the drag began, which the marquee reads to tell
   * a new selection from one being added to (issue #2279).
   */
  draw?:
    | ((
        from: Point,
        to: Point,
        phase: GroundDragPhase,
        keys: GestureKeys,
      ) => void)
    | null;
  /**
   * What a click at a point would put on the ground, shown under the pointer
   * before the click (issue #1464). Null in a mode that has nothing worth
   * showing, and then a pointer move over the map does no work at all.
   *
   * Every mode that places a building sets this, whether it places one or a
   * dozen (issue #1716): a building is snapped to the build grid and given as
   * much ground as its footprint asks for, so where the pointer is and where the
   * building will stand are two different squares. A mode placing a unit that is
   * not a building leaves it null, because a tank really does go where it is
   * dropped and drawing that twice says nothing.
   */
  ghost?: ((pos: Point) => PreviewBuilding[]) | null;
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
  /** What a click will do, said in the strip under the map alongside the
   *  gestures that are true whatever the mode (issue #2285). */
  hint: string;
  /** Resolve the mode against the current document. A hook. */
  use: (ctx: ModeContext) => ModeBehaviour;
}

/**
 * Looking without touching: pick things up, move them, turn them, put nothing
 * new down, and take hold of several at once (issue #2279).
 *
 * Where the editor opens, so a stray click on a scenario you are only reading
 * cannot add to it. It is also the one mode with a spare gesture to give a
 * marquee: a drag across bare ground here was a pan, and the middle button pans
 * anyway, which is the same trade Zones mode already makes for the drag that
 * draws a zone.
 *
 * The box is dragged out on the ground rather than across the screen, and what
 * it selects is what is standing inside that ground. Under a camera anybody has
 * turned the two are not the same rectangle, and drawing one while selecting by
 * the other would be a picture that lies about what is about to happen.
 */
const selectMode: EditorMode = {
  id: "select",
  label: "Select",
  icon: MousePointer2,
  // Dragging a unit and dragging a zone's handle are true in every mode, so the
  // strip under the map says both for all of them. This says the ones that are
  // only true here (issue #2285).
  hint: "Drag a box round things to select them all, Shift-click to add one, and click bare ground to let go. Middle-drag pans while this mode is on.",
  use: ({ scenario, placements, paths, onSelectMany }) => {
    const [band, setBand] = useState<ScenarioZone | null>(null);
    // The box is redrawn on the next frame rather than on every pointer move.
    // Drawing it rebuilds the zones layer, and a burst of moves between two
    // frames should cost one rebuild rather than twenty, which is the trade
    // issue #2348 made for the wheel.
    const pending = useRef<ScenarioZone | null>(null);
    const frame = useRef<number | null>(null);
    useEffect(
      () => () => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
      },
      [],
    );
    const queue = useCallback((next: ScenarioZone | null) => {
      pending.current = next;
      if (next === null) {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        setBand(null);
        return;
      }
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setBand(pending.current);
      });
    }, []);

    return {
      place: null,
      // Left undefined rather than empty when there is no box, so the surface is
      // handed the same list twice running and does not redraw for nothing.
      draftZones: band ? [band] : undefined,
      draw: (from, to, phase, keys) => {
        if (phase === "cancel") {
          queue(null);
          return;
        }
        const box = boxFromDrag(from, to);
        if (phase === "move") {
          // Built here rather than through `zoneFromDrag`, which holds a zone to
          // a minimum size. A marquee has no minimum: a box drawn smaller than
          // that would select what was inside the box the author was shown
          // rather than the one they drew.
          queue({
            id: MARQUEE_ZONE_ID,
            name: "Selecting",
            shape: "box",
            min: { x: box.minX, z: box.minZ },
            max: { x: box.maxX, z: box.maxZ },
          });
          return;
        }
        queue(null);
        onSelectMany(
          keysInBox(placements, scenario.zones, paths, box),
          keys.add,
        );
      },
    };
  },
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
  hint: "Drag anywhere to draw a zone, inside another one if you like, or click once for one at the default size. Click a zone to select it, then drag its orange middle handle to move it. Middle-drag pans while this mode is on.",
  use: ({ onChange, onSelect }) => {
    const [shape, setShape] = useState<ZoneShape>("box");
    const [draft, setDraft] = useState<ScenarioZone | null>(null);

    return {
      // A keyboard press has one point, not two, so Enter cannot draw a zone
      // corner to corner the way a drag does. It puts one down at the default
      // size instead, selected straight away so an author can size it with
      // the S key and the arrows (issue #2313).
      place: (pos: Point) => {
        const id = crypto.randomUUID();
        onChange((doc) =>
          addZone(doc, zoneFromPoint(shape, pos, id, nextZoneName(doc.zones))),
        );
        onSelect(zoneKey(id));
      },
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
          <UnitPickerButton
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
          <UnitPickerButton
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
  hint: "Pick a building and click the map. Clicks add to the base you have selected. Stop placing with the button beside the picker, or Escape.",
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

    // Escape puts the building down (issue #1716). Only while one is picked, so
    // Escape keeps whatever it means everywhere else, and only outside a field,
    // so it can still leave one.
    useEffect(() => {
      if (!unitDef) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        if (isTypingTarget(event.target as HTMLElement | null)) return;
        setUnitDef("");
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [unitDef]);

    // The square the click will use, drawn under the pointer before the click
    // (issue #1716). A building does not go where it is dropped: the engine
    // snaps it to the build grid and gives it as much ground as its footprint
    // asks for, so the pointer alone says neither where it will stand nor how
    // much room it wants.
    const ghost = useMemo(
      () =>
        unitDef
          ? (pos: Point) => [
              { def: unitDef, pos: snap(pos, unitDef, 0), facing: 0 as const },
            ]
          : null,
      [unitDef, snap],
    );

    return {
      ghost,
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
                // The layout is being shaped around this map's terrain, so the
                // map goes on it (issue #1315).
                designedFor: doc.setup.mapName,
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
          <UnitPickerButton
            units={options}
            value={unitDef}
            onValueChange={setUnitDef}
            onClear={() => setUnitDef("")}
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

/**
 * A whole base at once, from a layout somebody already drew (issues #1327,
 * #1450).
 *
 * The other half of Bases. That mode builds a base a click at a time, which is
 * how a layout gets made. This one places a layout that exists, which is what
 * makes having made one worth anything. The two things it reaches are the
 * scenario's own layouts, including the ones no base is currently placed from,
 * and the blueprint library, which is where a base saved out of another mission
 * or taken off the hub lives.
 *
 * A library layout is copied into the document as it is placed. A scenario is
 * shared as one self-contained payload, so a base pointing at a layout outside
 * the document would work for its author and for nobody they send it to. Having
 * copied it, the picker moves to the copy, so placing the same layout a second
 * time is one shape in two places rather than two layouts of one name.
 *
 * What a base placed here does not get is anything a mission adds on top: no
 * trigger addressable ids and no factory queues. Those belong to a placement
 * rather than to a shape and are added afterwards, from the base's own bar.
 */
const layoutsMode: EditorMode = {
  id: "layouts",
  label: "Blueprints",
  icon: Blocks,
  hint: "Pick a blueprint and a team, then click the map to place the whole base.",
  use: ({ scenario, onChange, onSelect, layout: choice, onLayout }) => {
    const [team, setTeam] = useState("");
    const participants = scenario.setup.participants;
    const owner = participants.some((p) => p.id === team)
      ? team
      : (participants[0]?.id ?? "");

    const { records } = useBlueprintLibrary();
    const { target } = usePreferredTarget();
    const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
    // Null only while the scan is still running, the same rule the library's
    // own import follows: a scan that failed answers with no games.
    const installed = scan.data?.games ?? (scan.loading ? null : []);
    const { units } = useGameUnits(scenario.setup.gameName);
    const known = useMemo(
      () => (units.length > 0 ? knownUnits(units) : undefined),
      [units],
    );
    // Undefined until the game's units are read, which is what stops a layout
    // of even-footprint buildings being snapped onto the wrong half of the
    // grid by a fallback that calls everything one square.
    const snap = useMemo(
      () => (units.length > 0 ? buildGridSnap(units) : undefined),
      [units],
    );

    const placement = layoutPlacement(
      scenario,
      choice,
      records,
      installed,
      known,
    );

    // The shape the pointer is carrying, wherever it is being carried from, so
    // what is shown under the pointer is what the click would put there
    // (issue #1464). Nothing while a click would do nothing, which is a layout
    // nobody has chosen and a scenario with nobody to own the base.
    const carrying =
      choice && owner && placement
        ? choice.from === "scenario"
          ? scenario.blueprints.find((b) => b.id === choice.id)?.buildings
          : records.find((one) => one.id === choice.id)?.layout.buildings
        : undefined;
    // Held steady between renders, because the surface redraws what it shows
    // whenever this changes identity.
    const ghost = useMemo(
      () =>
        carrying && carrying.length > 0
          ? (pos: Point) => layoutGhost(pos, carrying, snap)
          : null,
      [carrying, snap],
    );

    return {
      ghost,
      place:
        choice && owner && placement
          ? (pos: Point) => {
              const id = crypto.randomUUID();
              if (choice.from === "scenario") {
                onChange((doc) => {
                  const layout = doc.blueprints.find((b) => b.id === choice.id);
                  return placeBlueprint(doc, id, choice.id, {
                    team: owner,
                    origin: layoutOrigin(pos, layout?.buildings ?? [], snap),
                  });
                });
                onSelect(placementKey("base", id, 0));
                return;
              }
              const record = records.find((one) => one.id === choice.id);
              if (!record) return;
              const blueprint = crypto.randomUUID();
              const layout = {
                ...blueprintFromPayload(record.layout),
                name: placement.name,
              };
              onChange((doc) =>
                takeBlueprint(
                  doc,
                  layout,
                  owner,
                  { base: id, blueprint },
                  layoutOrigin(pos, layout.buildings, snap),
                ),
              );
              onSelect(placementKey("base", id, 0));
              // The library entry is a layout of this scenario's now, so the
              // next click places that rather than copying the same shape in
              // again under a counted-up name.
              onLayout({ from: "scenario", id: blueprint });
            }
          : null,
      controls: (
        <LayoutPlacer
          scenario={scenario}
          records={records}
          choice={choice}
          onChoice={onLayout}
          placement={placement}
          team={owner}
          onTeam={setTeam}
        />
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
  layoutsMode,
];

/** The mode that places a whole layout, which the contents list switches to
 *  when an author asks to put an unplaced one back (issue #1450). */
export const LAYOUTS_MODE_ID = layoutsMode.id;

/** The mode that draws zones, which the surface has to know apart from the
 *  others now that it places as well as draws (issue #2313): a zone's own
 *  handles have to stay pickable by pointer even while a click on bare ground
 *  places one, which is not true of the other modes that place something. */
export const ZONES_MODE_ID = zonesMode.id;
