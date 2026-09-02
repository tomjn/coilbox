/**
 * Pointing at the map: what the pointer is over, what it picks up, and where it
 * puts things down.
 *
 * This is the three.js half of editing, the part that cannot be tested without a
 * GPU. The rules it applies are in `editing.ts`, which is tested.
 *
 * Two things shape the way it works.
 *
 * The terrain's relief lives in a `displacementMap` sampled by the vertex
 * shader, so the geometry three.js holds is a flat plane and raycasting it comes
 * back flat wherever the ground actually is. A pointer is turned into a map
 * position by crossing the camera's ray with a horizontal plane instead, once at
 * sea level and again at the height the first crossing found, so a click on a
 * hillside lands where it looks rather than at the foot of the hill.
 *
 * The camera pans on the left button, which is also the button that places and
 * drags. So nothing is decided on press: the press is remembered, and the
 * release decides whether it was a click or a drag. While a drag is moving
 * something the camera is switched off, and the drawn objects are moved
 * directly. The document is written once, on release, because writing it every
 * frame would rebuild the whole scene every frame.
 *
 * A mode that draws rather than places takes that button for the whole gesture:
 * a press, a drag and a release across bare ground is `onDragGround`, and the
 * camera pans on the middle button while such a mode is current.
 *
 * Not everything drawn on the map is picked up by pressing it. A zone is a sheet
 * of ground and can cover the whole view, so a press on one leaves the button
 * where it was, with the camera or with whatever the mode draws. It is selected
 * by a click and moved by the handle at its middle. Because sheets are passed
 * over that way, a press reaches a handle lying under one, which it has to: a
 * zone's own sheet, and every zone drawn over it, lie between the camera and
 * the handles.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { Rect } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "@/scenario/model";
import { dragKeys, type Placement } from "./placements";
import {
  clampToMap,
  holdCursor,
  isClick,
  onGround,
  type PointerPos,
  type PointerTargets,
  pointerNdc,
  pointerTargets,
  pressGesture,
} from "./pointer";
import { sceneToWorld, worldToScene } from "./scene";
import { createSelectionPlate, type SelectionPlate } from "./selectionPlate";
import type { UnitsLayer } from "./unitsLayer";

/**
 * Pickable things on the map that are not units: zones, and the waypoints of a
 * group's orders. Raycast alongside the units and sorted with them by distance,
 * so a unit standing inside a zone is still the nearer hit.
 *
 * An overlay owns how its objects are drawn, so a drag of one is handed back to
 * it rather than moved here: resizing a zone changes its shape, which is not
 * something moving an object can express.
 */
export interface OverlayLayer {
  /** The group its objects hang off. Every one carries a `placementKey`. */
  root: THREE.Object3D;
  /** Whether a picked key is one of this layer's. */
  has: (key: string) => boolean;
  /**
   * Whether a press on one of its keys picks that object up. Left out by a
   * layer whose objects are all grabbable.
   *
   * A zone's sheet says no: it lies over the ground and can cover the whole
   * view, so a press on it stays the camera's, or the mode's to draw with. Such
   * an object is still selected by a click, and moved by a handle of its own.
   */
  grabbable?: (key: string) => boolean;
  /** Show a drag in progress, without touching the document. The layer redraws
   *  and renders the scene itself. Undone by the layer's next draw. */
  drag: (key: string, delta: Point) => void;
}

/** How far a drag across bare ground has got: still moving, finished, or taken
 *  away by the browser before it finished. */
export type GroundDragPhase = "move" | "end" | "cancel";

/** What was held down while a gesture was made. Only Shift so far, which is what
 *  says "as well as what is already selected" rather than "instead of it"
 *  (issue #2279). */
export interface GestureKeys {
  add: boolean;
}

/** A drawn unit being dragged, and how far it has been carried, in elmos. */
export interface UnitDrag {
  key: string;
  delta: Point;
}

/** What the surface hands the pointer layer. Everything but `handle` and
 *  `layer` is read at the moment of a gesture rather than captured, so changing
 *  mode or document does not detach and reattach the listeners. */
export interface MapEditingDeps {
  handle: MapScene3D | null;
  layer: UnitsLayer | null;
  /** Every unit currently drawn, for resolving a hit and for dragging a whole
   *  group at once. */
  placements: Placement[];
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
  /** Placement key currently selected, so the plate can be drawn under it. */
  selected: string | null;
  /**
   * Everything selected, when the surface holds more than one (issue #2279).
   *
   * Two things read it. Every one of them gets a plate, not just `selected`. And
   * a press on something already in it leaves the selection alone, so a drag
   * carries the whole of it rather than collapsing it to whatever was pressed,
   * which is what every editor with a marquee does.
   *
   * Left out by a surface with one selection, and then it is `selected` alone.
   */
  selectedKeys?: readonly string[];
  /**
   * The ground the building a key names stands on, or null for anything that is
   * not a building (issue #1716).
   *
   * Two things read it. A building says it is selected with its own footprint,
   * so it needs no plate under it and gets none. And the selected building's
   * square is something the pointer can take hold of: the squares are drawn by
   * a layer nothing raycasts, so a press on one is answered by arithmetic
   * instead.
   *
   * Left out by a surface that draws no footprints, and then everything
   * selected gets a plate and only the models can be grabbed.
   */
  footprintAt?: ((key: string) => Rect | null) | null;
  /** A click on a drawn unit, or on empty ground with nothing to place. `add` is
   *  Shift held: this as well as what is already selected, rather than instead
   *  of it (issue #2279). */
  onSelect: (key: string | null, add?: boolean) => void;
  /** A click on empty ground in a mode that places something. Null in a mode
   *  that places nothing, which is what makes that mode read-only. */
  onPlace: ((pos: Point) => void) | null;
  /**
   * Where the pointer is over the map, for a mode that shows what a click
   * would put there (issue #1464). Null as the pointer leaves the map or takes
   * hold of something, so whatever was being shown is taken down.
   *
   * Called on every move, so whoever takes it decides how much work a move is
   * worth: nothing here throttles or compares. Left out by a mode that shows
   * nothing, and then no move costs anything at all.
   */
  onHover?: ((pos: Point | null) => void) | null;
  /**
   * A drag across bare ground, from where it was pressed to where the pointer
   * has got to, both in elmos.
   *
   * Called as the drag moves and once more when it ends, so a mode can show the
   * shape it is drawing and write the document only at the end. Null in a mode
   * that draws nothing, which is what leaves the left button panning the camera.
   *
   * `keys` is what was held when the drag began, which a marquee reads to decide
   * between growing the selection and replacing it (issue #2279).
   */
  onDragGround:
    | ((
        from: Point,
        to: Point,
        phase: GroundDragPhase,
        keys: GestureKeys,
      ) => void)
    | null;
  /**
   * A drag of a drawn unit, as it moves, and null the moment it ends
   * (issue #1512).
   *
   * For showing where the thing being dragged will land. The document is not
   * touched: this is called on every move and `onMove` once, so a drag is still
   * one edit.
   *
   * It answers whether it is showing the drag, and a drag it is showing loses
   * the selection plate: the plate is there to say which one is selected when
   * the model is a few pixels across, and a footprint drawn on the squares the
   * building will stand on says that and more. Nothing but a building has a
   * footprint, so a scout being dragged keeps its plate.
   */
  onDragUnit?: ((drag: UnitDrag | null) => boolean) | null;
  /**
   * Which drawn objects a drag of this one carries, when the surface has an
   * answer of its own (issue #1558).
   *
   * Left out wherever {@link dragKeys} is right, which is every surface where a
   * building is edited rather than the whole layout moved. The map check is the
   * one where it is not: the layout is the only thing on it and none of its
   * buildings can be edited there, so taking hold of one takes hold of all of
   * them.
   */
  carries?: ((key: string) => string[]) | null;
  /**
   * Anything pickable that is not a unit, nearest layer first.
   *
   * A list rather than one, because zones and order paths are pickable at the
   * same time and are drawn by layers of their own. A null entry is a layer that
   * is not built yet, or one a mode has stood down: a mode that places on the
   * ground hands the ground back by dropping the zones.
   */
  overlays?: (OverlayLayer | null)[];
  /** A drag that finished, in elmos moved. */
  onMove: (key: string, delta: Point) => void;
}

/** The placement a raycast hit belongs to. A hit is always a mesh somewhere
 *  inside the drawn model, so the owning object is found by walking up. */
function placementOf(object: THREE.Object3D): string | null {
  let at: THREE.Object3D | null = object;
  while (at) {
    const key = at.userData?.placementKey;
    if (typeof key === "string") return key;
    at = at.parent;
  }
  return null;
}

/** What the pointer looks like over bare ground: a crosshair wherever a gesture
 *  there would put something down or draw something, an arrow where it would
 *  not. */
function drawingCursor(
  deps: Pick<MapEditingDeps, "onPlace" | "onDragGround">,
): string {
  return deps.onPlace || deps.onDragGround ? "crosshair" : "";
}

/** What one drag is moving: the thing that was picked up, and where every
 *  object moving with it started. */
interface Drag {
  key: string;
  from: PointerPos;
  /** Where on the map the pointer was when the drag started. */
  origin: Point;
  /** The drawn units carried along, empty when an overlay owns the drag and
   *  redraws its own object. */
  members: { key: string; object: THREE.Object3D; pos: Point }[];
  /** The layer that owns this drag, or null when the units layer does. */
  overlay: OverlayLayer | null;
  moved: boolean;
  delta: Point;
  /** Whether the drag is being drawn as a footprint, which is what the plate
   *  stands down for (issue #1512). */
  held: boolean;
}

/** A drag across bare ground: where it began on the map, and where it has got
 *  to, so a release that lands off the map still ends where it was last seen. */
interface GroundDrag {
  from: PointerPos;
  origin: Point;
  to: Point;
  moved: boolean;
  /** What was held when the press landed, so a marquee released with Shift long
   *  since let go still means what the author asked for. */
  keys: GestureKeys;
}

/**
 * Wire clicking, dragging and selecting into a built map scene.
 *
 * Nothing is returned: the hook's whole effect is on the scene and on the
 * callbacks it is given. It attaches once per scene and per units layer.
 */
export function useMapEditing(deps: MapEditingDeps): void {
  const { handle, layer } = deps;
  // Read at gesture time, so a new document or a new mode does not mean new
  // listeners and a lost drag.
  const latest = useRef(deps);
  latest.current = deps;
  // Built with the listeners, so the effect that follows the selection can
  // reach it without owning its lifetime.
  const plateRef = useRef<SelectionPlate | null>(null);

  useEffect(() => {
    if (!handle || !layer) return;
    const dom = handle.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const plate = createSelectionPlate(handle);
    plateRef.current = plate;
    let drag: Drag | null = null;
    let band: GroundDrag | null = null;
    let pressed: PointerPos | null = null;
    /** What the press was over when it was not something to pick up, so a
     *  release that turns out to be a click can still select it. */
    let pressedKey: string | null = null;
    /** What was held when the press landed. Read on release, so a click that
     *  selects still knows whether Shift was down when it began. */
    let pressedKeys: GestureKeys = { add: false };

    /** The map position a pointer is over, or null when the ray misses the
     *  ground plane entirely, which only happens looking at the horizon. */
    const groundPoint = (event: PointerEvent): Point | null => {
      const { worldWidth, worldHeight, groundAt } = latest.current;
      const rect = dom.getBoundingClientRect();
      const ndc = pointerNdc({ x: event.clientX, y: event.clientY }, rect);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), handle.camera);
      const cross = (height: number): Point | null => {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
        const at = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (!at) return null;
        return sceneToWorld(
          { x: at.x, z: at.z },
          worldWidth,
          worldHeight,
          handle.scale,
        );
      };
      const flat = cross(0);
      if (!flat) return null;
      // A second crossing at the height of the first, so the point follows the
      // relief the shader draws rather than sea level.
      const relief = cross(
        groundAt(clampToMap(flat, worldWidth, worldHeight)) * handle.scale,
      );
      return clampToMap(relief ?? flat, worldWidth, worldHeight);
    };

    /** The overlay layers in play, in the order they were handed over. */
    const overlays = (): OverlayLayer[] =>
      (latest.current.overlays ?? []).filter(
        (one): one is OverlayLayer => !!one,
      );

    /** The overlay that owns a key, or null when no overlay drew it. */
    const overlayFor = (key: string): OverlayLayer | null =>
      overlays().find((one) => one.has(key)) ?? null;

    /** Whether a press on a key picks that object up. Only an overlay has a say:
     *  a drawn unit is always something to pick up. */
    const grabbable = (key: string): boolean =>
      overlayFor(key)?.grabbable?.(key) ?? true;

    /** Everything selected right now, which for a surface with one selection is
     *  that one thing. */
    const selectionNow = (): readonly string[] => {
      const { selectedKeys, selected } = latest.current;
      if (selectedKeys) return selectedKeys;
      return selected ? [selected] : [];
    };

    /** What the pointer is over. Only the drawn layers are raycast: the terrain
     *  would answer flat, and nothing else is pickable. */
    const pick = (event: PointerEvent): PointerTargets => {
      const rect = dom.getBoundingClientRect();
      const ndc = pointerNdc({ x: event.clientX, y: event.clientY }, rect);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), handle.camera);
      const roots = [layer.root, ...overlays().map((one) => one.root)];
      const keys: string[] = [];
      for (const hit of raycaster.intersectObjects(roots, true)) {
        const key = placementOf(hit.object);
        // The same object can be hit twice, front face and back.
        if (key && key !== keys[keys.length - 1]) keys.push(key);
      }
      return pointerTargets(keys, grabbable);
    };

    /** Whether the ray through the pointer passes through one object. Only ever
     *  asked about the selection, so it is one model rather than the scene. */
    const hits = (event: PointerEvent, object: THREE.Object3D): boolean => {
      const rect = dom.getBoundingClientRect();
      const ndc = pointerNdc({ x: event.clientX, y: event.clientY }, rect);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), handle.camera);
      return raycaster.intersectObject(object, true).length > 0;
    };

    /**
     * The selected building's own square, when the pointer is on it (issue
     * #1716).
     *
     * A handle in every mode, including the ones that place something. The
     * ground a building already stands on is ground the engine will not give to
     * a second building, so a click there was never going to put one down, and a
     * square that means "drag me" everywhere is one rule rather than a rule per
     * mode.
     */
    const squareHandle = (event: PointerEvent): string | null => {
      const keys = selectionNow();
      if (keys.length === 0) return null;
      const at = groundPoint(event);
      if (!at) return null;
      // Any of them, not only the primary: a marquee round a base selects a
      // dozen buildings and every one of their squares is a handle for the
      // whole selection (issue #2279). A rectangle test each, so this stays
      // arithmetic rather than a ray through the scene.
      return (
        keys.find((key) => {
          const rect = footprintOf(key);
          return !!rect && onGround(at, rect);
        }) ?? null
      );
    };

    /** Whether the pointer is over something selected, by its model or by the
     *  square it stands on. What the hand cursor is about. */
    const overSelection = (event: PointerEvent): boolean => {
      const keys = selectionNow();
      if (keys.length === 0) return false;
      if (squareHandle(event)) return true;
      return keys.some((key) => {
        const object = layer.objects.get(key);
        return !!object && grabbable(key) && hits(event, object);
      });
    };

    /** Move the objects a drag is carrying, without touching the document. */
    const carry = (delta: Point) => {
      const { worldWidth, worldHeight, groundAt } = latest.current;
      if (!drag) return;
      for (const member of drag.members) {
        const to = clampToMap(
          { x: member.pos.x + delta.x, z: member.pos.z + delta.z },
          worldWidth,
          worldHeight,
        );
        const at = worldToScene(to, worldWidth, worldHeight, handle.scale);
        member.object.position.set(at.x, groundAt(to) * handle.scale, at.z);
      }
      // The plates follow what is being dragged, unless a footprint is being
      // drawn for it, which says which one it is far better than a plate. Every
      // carried object rather than the one that was pressed, because a drag can
      // now be carrying a whole marquee's worth (issue #2279).
      if (!drag.held) plate.show(drag.members.map((one) => one.object));
      handle.render();
    };

    /** The ground a key's building stands on, when the surface knows and when
     *  it is a building at all. */
    const footprintOf = (key: string): Rect | null =>
      latest.current.footprintAt?.(key) ?? null;

    /**
     * Put the plate back under the selection, or take it away.
     *
     * A building has a footprint and its footprint says it is selected, so it
     * gets no plate: two things saying the same thing, one of them wider than
     * the ground the building actually has, is what issue #1716 is about.
     */
    const followSelection = () => {
      plate.show(platedObjects());
      handle.render();
    };

    /** The drawn objects a plate goes under: everything selected that the units
     *  layer drew and that has no footprint of its own. */
    const platedObjects = (): THREE.Object3D[] =>
      selectionNow().flatMap((key) => {
        const object = layer.objects.get(key);
        return object && !footprintOf(key) ? [object] : [];
      });

    // An edit redraws the units, and the object a key names afterwards is not
    // the one that was selected before it. The layer says when its new objects
    // are there, because it is the only thing that knows: it empties itself the
    // moment the edit lands and refills over the following frames, and a look
    // taken in between finds nothing (issue #1516). A drag drawing its own
    // footprint keeps the plate down until it lands.
    const unwatch = layer.onDrawn(() => {
      if (drag?.held) return;
      followSelection();
    });

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { x: event.clientX, y: event.clientY };
      pressedKeys = { add: event.shiftKey };
      const { select, grab } = pick(event);
      const origin = groundPoint(event);
      // Nothing drawn was hit, but the selected building's square is a handle
      // as much as its model is (issue #1716): a low building on a hillside can
      // be most of a square of ground with very little to aim at.
      const held = grab ?? squareHandle(event);
      const gesture = pressGesture({
        grab: held,
        draws: !!latest.current.onDragGround,
      });
      // The pointer is about to mean something else, so what it was showing
      // under it goes now rather than sitting there through the whole drag.
      if (gesture !== "camera") latest.current.onHover?.(null);
      // What a drag would carry, once there is somewhere on the map to carry it
      // from. The two are read together because a gesture needs both.
      const key = held;
      const owner = key ? overlayFor(key) : null;

      if (gesture !== "grab" || !key || !origin) {
        // Bare ground, or something lying over it that a press does not pick up.
        // In a mode that draws, this button is the drawing gesture rather than
        // the camera's pan, so the camera stands down for it. In a mode that
        // does not, the camera keeps the button and pans. Either way what was
        // under the press is remembered, so a click can still select it.
        pressedKey = select;
        if (gesture === "draw" && origin) {
          band = {
            from: pressed,
            origin,
            to: origin,
            moved: false,
            keys: pressedKeys,
          };
          handle.controls.enabled = false;
        }
        return;
      }

      // An overlay draws its own objects, so it is told about the drag rather
      // than having them moved out from under it.
      if (owner) {
        drag = {
          key,
          from: pressed,
          origin,
          members: [],
          overlay: owner,
          moved: false,
          delta: { x: 0, z: 0 },
          held: false,
        };
        handle.controls.enabled = false;
        takeHold(key);
        return;
      }

      const { placements, carries } = latest.current;
      const carried = carries?.(key) ?? dragKeys(placements, key);
      const members = carried.flatMap((member) => {
        const object = layer.objects.get(member);
        const placement = placements.find((p) => p.key === member);
        return object && placement
          ? [{ key: member, object, pos: placement.pos }]
          : [];
      });
      if (members.length === 0) return;

      drag = {
        key,
        from: pressed,
        origin,
        members,
        overlay: null,
        moved: false,
        delta: { x: 0, z: 0 },
        held: false,
      };
      // The camera pans on this button, so it has to stand down for the
      // duration or the map would slide out from under what is being dragged.
      handle.controls.enabled = false;
      takeHold(key);
    };

    /**
     * What a press on something it can pick up does to the selection.
     *
     * A press on something already selected leaves the selection alone, so a
     * drag carries the whole of it rather than collapsing a marquee down to
     * whichever unit the pointer happened to land on (issue #2279). Shift makes
     * the press a toggle, and a press on anything else replaces the selection
     * the way it always did.
     */
    const takeHold = (key: string) => {
      if (pressedKeys.add) {
        latest.current.onSelect(key, true);
        return;
      }
      if (selectionNow().includes(key)) return;
      latest.current.onSelect(key);
    };

    const onPointerMove = (event: PointerEvent) => {
      const now = { x: event.clientX, y: event.clientY };

      // What a click here would put down, shown while nothing is being
      // dragged or drawn: during either of those the pointer is busy saying
      // something else and a second thing following it would be noise. The
      // ray is only cast for a mode that asked, so a move costs nothing in the
      // modes that show nothing.
      const hover = latest.current.onHover;
      if (hover && !band && !drag) hover(groundPoint(event));

      // The hand that says the selected thing can be dragged (issue #1716).
      // Only the selection is asked about, so this is one object's bounds or one
      // rectangle rather than a ray through the whole scene on every move.
      if (!band && !drag) {
        dom.style.cursor = holdCursor({
          dragging: false,
          holding: overSelection(event),
          ground: drawingCursor(latest.current),
        });
      }

      if (band) {
        if (!band.moved && isClick(band.from, now)) return;
        band.moved = true;
        const at = groundPoint(event);
        if (!at) return;
        band.to = at;
        latest.current.onDragGround?.(band.origin, at, "move", band.keys);
        return;
      }

      if (!drag) return;
      if (!drag.moved && isClick(drag.from, now)) return;
      drag.moved = true;
      dom.style.cursor = "grabbing";
      const at = groundPoint(event);
      if (!at) return;
      drag.delta = { x: at.x - drag.origin.x, z: at.z - drag.origin.z };
      if (drag.overlay) {
        drag.overlay.drag(drag.key, drag.delta);
        return;
      }
      // Asked before the objects are moved, because the answer decides whether
      // the plate moves with them.
      drag.held =
        latest.current.onDragUnit?.({ key: drag.key, delta: drag.delta }) ??
        false;
      if (drag.held) plate.hide();
      carry(drag.delta);
    };

    const finish = (event: PointerEvent) => {
      const gesture = drag;
      const drawn = band;
      const from = pressed;
      const over = pressedKey;
      const held = pressedKeys;
      drag = null;
      band = null;
      pressed = null;
      pressedKey = null;
      pressedKeys = { add: false };
      handle.controls.enabled = true;
      dom.style.cursor = drawingCursor(latest.current);
      if (gesture) {
        if (gesture.moved) {
          // Down goes the footprint that was following the pointer: what is
          // drawn from here is the document's own, and the building's own square
          // is what says it is the selected one.
          if (gesture.held) latest.current.onDragUnit?.(null);
          latest.current.onMove(gesture.key, gesture.delta);
        }
        return;
      }
      if (drawn?.moved) {
        const at = groundPoint(event) ?? drawn.to;
        latest.current.onDragGround?.(drawn.origin, at, "end", drawn.keys);
        return;
      }
      // Nothing was picked up and nothing was drawn, so this was either a click
      // on empty ground or a pan of the camera.
      if (!from || !isClick(from, { x: event.clientX, y: event.clientY }))
        return;
      // A click on something a press does not pick up selects it, which is how
      // a zone is chosen: the press could not, because it might have been the
      // start of a pan or of a zone drawn inside this one.
      if (over) {
        latest.current.onSelect(over, held.add);
        return;
      }
      const place = latest.current.onPlace;
      const at = groundPoint(event);
      if (place && at) place(at);
      // Shift held is somebody building a selection, and a stray click on bare
      // ground in the middle of that should not throw the whole thing away
      // (issue #2279).
      else if (!held.add) latest.current.onSelect(null);
    };

    const onPointerCancel = () => {
      // Put back whatever the abandoned drag had moved. The next render of the
      // units layer would do it too, but only if the document changed.
      if (drag?.held) {
        drag.held = false;
        latest.current.onDragUnit?.(null);
      }
      if (drag && !drag.overlay) carry({ x: 0, z: 0 });
      if (drag?.overlay) drag.overlay.drag(drag.key, { x: 0, z: 0 });
      if (band?.moved)
        latest.current.onDragGround?.(
          band.origin,
          band.to,
          "cancel",
          band.keys,
        );
      drag = null;
      band = null;
      pressed = null;
      pressedKey = null;
      pressedKeys = { add: false };
      handle.controls.enabled = true;
    };

    /** The pointer has left the map, so anything drawn under it goes. */
    const onPointerLeave = () => latest.current.onHover?.(null);

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", finish);
    dom.addEventListener("pointercancel", onPointerCancel);
    dom.addEventListener("pointerleave", onPointerLeave);

    return () => {
      unwatch();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", finish);
      dom.removeEventListener("pointercancel", onPointerCancel);
      dom.removeEventListener("pointerleave", onPointerLeave);
      dom.style.cursor = "";
      handle.controls.enabled = true;
      plate.dispose();
      plateRef.current = null;
      handle.render();
    };
  }, [handle, layer]);

  // A selection made anywhere else, which is anything but a click on the map:
  // an object just placed, a delete that leaves nothing selected, a bar that
  // chose something. A redraw of the units is followed above, off the layer's
  // own signal rather than off a render.
  const { selected, selectedKeys, footprintAt } = deps;
  useEffect(() => {
    const plate = plateRef.current;
    if (!handle || !layer || !plate) return;
    const keys = selectedKeys ?? (selected ? [selected] : []);
    // A building has a footprint and its footprint says it is selected, so
    // nothing goes under it (issue #1716).
    plate.show(
      keys.flatMap((key) => {
        const object = layer.objects.get(key);
        return object && !footprintAt?.(key) ? [object] : [];
      }),
    );
    handle.render();
  }, [handle, layer, selected, selectedKeys, footprintAt]);

  // The cursor says whether a gesture on bare ground will make something.
  const { onPlace, onDragGround } = deps;
  useEffect(() => {
    if (!handle) return;
    handle.renderer.domElement.style.cursor = drawingCursor({
      onPlace,
      onDragGround,
    });
  }, [handle, onPlace, onDragGround]);
}
