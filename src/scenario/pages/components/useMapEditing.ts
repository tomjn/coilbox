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
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "../../model";
import {
  clampToMap,
  dragKeys,
  isClick,
  type PointerPos,
  pointerNdc,
} from "./editing";
import type { Placement } from "./placements";
import { sceneToWorld, worldToScene } from "./scene";
import type { UnitsLayer } from "./unitsLayer";

/**
 * Pickable things on the map that are not units: zones today, patrol paths
 * later. Raycast alongside the units and sorted with them by distance, so a
 * unit standing inside a zone is still the nearer hit.
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
  /** Show a drag in progress, without touching the document. The layer redraws
   *  and renders the scene itself. Undone by the layer's next draw. */
  drag: (key: string, delta: Point) => void;
}

/** How far a drag across bare ground has got: still moving, finished, or taken
 *  away by the browser before it finished. */
export type GroundDragPhase = "move" | "end" | "cancel";

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
  /** Placement key currently selected, so the ring can be drawn on it. */
  selected: string | null;
  /** Whether the units layer is part way through a redraw. The layer empties
   *  itself before it refills, so the ring waits for this to fall before it
   *  looks for the object it belongs under. */
  drawing: boolean;
  /** A click on a drawn unit, or on empty ground with nothing to place. */
  onSelect: (key: string | null) => void;
  /** A click on empty ground in a mode that places something. Null in a mode
   *  that places nothing, which is what makes that mode read-only. */
  onPlace: ((pos: Point) => void) | null;
  /**
   * A drag across bare ground, from where it was pressed to where the pointer
   * has got to, both in elmos.
   *
   * Called as the drag moves and once more when it ends, so a mode can show the
   * shape it is drawing and write the document only at the end. Null in a mode
   * that draws nothing, which is what leaves the left button panning the camera.
   */
  onDragGround:
    | ((from: Point, to: Point, phase: GroundDragPhase) => void)
    | null;
  /** Anything pickable that is not a unit. */
  overlay?: OverlayLayer | null;
  /** A drag that finished, in elmos moved. */
  onMove: (key: string, delta: Point) => void;
}

/** How wide the selection ring is drawn around the smallest units, in elmos. A
 *  scout is a few pixels across at framing zoom (#830), so the ring is what is
 *  actually visible at that distance. */
const MIN_RING_ELMOS = 56;

/** The ring drawn under whatever is selected. Its own object rather than a
 *  change to the drawn unit, so a redraw of the units layer cannot lose it. */
function createSelectionRing(handle: MapScene3D) {
  const geometry = new THREE.RingGeometry(0.82, 1, 48);
  const material = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  ring.visible = false;
  handle.scene.add(ring);

  /** Put the ring under an object, sized to it. */
  const show = (object: THREE.Object3D) => {
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(
      Math.max(size.x, size.z) * 0.8,
      MIN_RING_ELMOS * handle.scale,
    );
    // Two elmos clear of the ground, which is a hand's breadth on a map, not a
    // scene unit, which on a 12km map is the height of a tall building.
    ring.position.set(
      object.position.x,
      object.position.y + 2 * handle.scale,
      object.position.z,
    );
    ring.scale.set(radius, radius, 1);
    ring.visible = true;
  };

  return {
    show,
    hide: () => {
      ring.visible = false;
    },
    dispose: () => {
      ring.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

type SelectionRing = ReturnType<typeof createSelectionRing>;

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

/** What the pointer looks like: a crosshair wherever a gesture on bare ground
 *  would put something down or draw something, an arrow where it would not. */
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
  overlay: boolean;
  moved: boolean;
  delta: Point;
}

/** A drag across bare ground: where it began on the map, and where it has got
 *  to, so a release that lands off the map still ends where it was last seen. */
interface GroundDrag {
  from: PointerPos;
  origin: Point;
  to: Point;
  moved: boolean;
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
  const ringRef = useRef<SelectionRing | null>(null);

  useEffect(() => {
    if (!handle || !layer) return;
    const dom = handle.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ring = createSelectionRing(handle);
    ringRef.current = ring;
    let drag: Drag | null = null;
    let band: GroundDrag | null = null;
    let pressed: PointerPos | null = null;

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

    /** The placement key under the pointer, if any. Only the drawn layers are
     *  raycast: the terrain would answer flat, and nothing else is pickable. */
    const pick = (event: PointerEvent): string | null => {
      const rect = dom.getBoundingClientRect();
      const ndc = pointerNdc({ x: event.clientX, y: event.clientY }, rect);
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), handle.camera);
      const overlay = latest.current.overlay;
      const roots = overlay ? [layer.root, overlay.root] : [layer.root];
      for (const hit of raycaster.intersectObjects(roots, true)) {
        const key = placementOf(hit.object);
        if (key) return key;
      }
      return null;
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
        if (member.key === drag.key) ring.show(member.object);
      }
      handle.render();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { x: event.clientX, y: event.clientY };
      const key = pick(event);
      const origin = groundPoint(event);

      if (!key) {
        // Bare ground. In a mode that draws, this button is the drawing gesture
        // rather than the camera's pan, so the camera stands down for it.
        if (latest.current.onDragGround && origin) {
          band = { from: pressed, origin, to: origin, moved: false };
          handle.controls.enabled = false;
        }
        return;
      }
      if (!origin) return;

      // An overlay draws its own objects, so it is told about the drag rather
      // than having them moved out from under it.
      if (latest.current.overlay?.has(key)) {
        drag = {
          key,
          from: pressed,
          origin,
          members: [],
          overlay: true,
          moved: false,
          delta: { x: 0, z: 0 },
        };
        handle.controls.enabled = false;
        latest.current.onSelect(key);
        return;
      }

      const { placements } = latest.current;
      const members = dragKeys(placements, key).flatMap((member) => {
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
        overlay: false,
        moved: false,
        delta: { x: 0, z: 0 },
      };
      // The camera pans on this button, so it has to stand down for the
      // duration or the map would slide out from under what is being dragged.
      handle.controls.enabled = false;
      latest.current.onSelect(key);
    };

    const onPointerMove = (event: PointerEvent) => {
      const now = { x: event.clientX, y: event.clientY };

      if (band) {
        if (!band.moved && isClick(band.from, now)) return;
        band.moved = true;
        const at = groundPoint(event);
        if (!at) return;
        band.to = at;
        latest.current.onDragGround?.(band.origin, at, "move");
        return;
      }

      if (!drag) return;
      if (!drag.moved && isClick(drag.from, now)) return;
      drag.moved = true;
      dom.style.cursor = "grabbing";
      const at = groundPoint(event);
      if (!at) return;
      drag.delta = { x: at.x - drag.origin.x, z: at.z - drag.origin.z };
      if (drag.overlay) latest.current.overlay?.drag(drag.key, drag.delta);
      else carry(drag.delta);
    };

    const finish = (event: PointerEvent) => {
      const gesture = drag;
      const drawn = band;
      const from = pressed;
      drag = null;
      band = null;
      pressed = null;
      handle.controls.enabled = true;
      dom.style.cursor = drawingCursor(latest.current);
      if (gesture) {
        if (gesture.moved) latest.current.onMove(gesture.key, gesture.delta);
        return;
      }
      if (drawn?.moved) {
        const at = groundPoint(event) ?? drawn.to;
        latest.current.onDragGround?.(drawn.origin, at, "end");
        return;
      }
      // Nothing was picked up and nothing was drawn, so this was either a click
      // on empty ground or a pan of the camera.
      if (!from || !isClick(from, { x: event.clientX, y: event.clientY }))
        return;
      const place = latest.current.onPlace;
      const at = groundPoint(event);
      if (place && at) place(at);
      else latest.current.onSelect(null);
    };

    const onPointerCancel = () => {
      // Put back whatever the abandoned drag had moved. The next render of the
      // units layer would do it too, but only if the document changed.
      if (drag && !drag.overlay) carry({ x: 0, z: 0 });
      if (drag?.overlay) latest.current.overlay?.drag(drag.key, { x: 0, z: 0 });
      if (band?.moved)
        latest.current.onDragGround?.(band.origin, band.to, "cancel");
      drag = null;
      band = null;
      pressed = null;
      handle.controls.enabled = true;
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", finish);
    dom.addEventListener("pointercancel", onPointerCancel);

    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", finish);
      dom.removeEventListener("pointercancel", onPointerCancel);
      dom.style.cursor = "";
      handle.controls.enabled = true;
      ring.dispose();
      ringRef.current = null;
      handle.render();
    };
  }, [handle, layer]);

  // The ring is put where the selection is whenever either the selection or the
  // objects under it change: the units layer redraws wholesale, so the object a
  // key names after an edit is not the one that was selected before it.
  const { selected, placements, drawing } = deps;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `drawing` is not read here, it is the signal that the objects this reads have been replaced
  useEffect(() => {
    const ring = ringRef.current;
    if (!handle || !layer || !ring) return;
    const object = selected ? layer.objects.get(selected) : undefined;
    if (object) ring.show(object);
    else ring.hide();
    handle.render();
  }, [handle, layer, selected, placements, drawing]);

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
