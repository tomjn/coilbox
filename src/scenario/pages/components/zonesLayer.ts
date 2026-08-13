/**
 * A scenario's zones, drawn on the editor's map as ground overlays.
 *
 * A zone is a footprint, not a solid: it has no height anywhere in the document
 * and the runtime tests it flat. So it is drawn as a translucent sheet lying on
 * the terrain, with an outline that shows through hills so a zone behind a ridge
 * can still be found.
 *
 * The sheet is draped rather than laid flat: the geometry is built in elmos
 * around the zone's centre and every vertex is lifted to the ground height under
 * it. A flat quad on a hilly map cuts into the hillside and reads as a floating
 * card, which is exactly the wrong shape for something that means "this piece of
 * ground".
 *
 * Everything drawn here carries a `placementKey`, so the shared picking in
 * `useMapEditing` sees zones and their handles the same way it sees units. The
 * sheet is selected by a click but never dragged, because it is ground: a zone
 * filling the view would otherwise take every drag meant for the camera or for
 * the next zone drawn inside it. What moves a zone is the handle at its middle,
 * drawn with the corner handles on whichever zone is selected.
 *
 * The arithmetic, what a drag does to a zone, is in `zones.ts`.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { worldToScene } from "@/placement/scene";
import type { Point, ScenarioZone } from "../../model";
import {
  dragZone,
  parseZoneKey,
  zoneCenter,
  zoneExtent,
  zoneHandleOffset,
  zoneHandles,
  zoneKey,
} from "./zones";

/** What a scenario's zones are drawn under, so the layer can be found and
 *  removed as one thing. */
const ROOT_NAME = "scenario-zones";

/** How far above the ground a zone's sheet sits, in elmos. Enough to clear the
 *  terrain the shader draws, which the drape only samples, and far below
 *  anything standing on it. */
const LIFT_ELMOS = 6;

/** How many pieces each axis of a drape is cut into. Enough to follow a ridge
 *  crossing a zone, few enough that a dozen zones cost nothing. */
const DRAPE_SEGMENTS = 24;

/** How wide a resize handle is drawn, in elmos. Big enough to hit at the zoom
 *  the whole map is framed at, which is the zoom most authoring happens at. */
const HANDLE_ELMOS = 88;

/** What a zone is drawn in, and what it turns when it is the selection. */
const ZONE_COLOR = 0x38bdf8;
const SELECTED_COLOR = 0xfacc15;

/** What the handle that moves a whole zone is drawn in. Neither the white of
 *  the corners that resize it nor the yellow of the zone it sits on. */
const MOVE_HANDLE_COLOR = 0xf97316;

export interface ZonesLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
}

export interface ZonesLayer {
  /** The group every drawn zone hangs off, for raycasting against. */
  root: THREE.Group;
  /** Whether this layer owns a picked key, which is what tells the pointer
   *  layer that a hit was a zone rather than a unit. */
  has: (key: string) => boolean;
  /** Whether a press on a key picks it up. Only a handle does: a zone's sheet
   *  is ground, so pressing it belongs to the camera or to the mode. */
  grabbable: (key: string) => boolean;
  /** Draw this list, replacing whatever was drawn before. `selectedId` gets the
   *  brighter outline and the resize handles. */
  draw: (zones: ScenarioZone[], selectedId: string | null) => void;
  /** Show a drag in progress: the zone this key names, moved or resized by
   *  `delta`, without touching the document. Undone by the next `draw`. */
  drag: (key: string, delta: Point) => void;
  dispose: () => void;
}

/** A ring of points around a zone's edge, in elmos relative to its centre, one
 *  per step of the outline. */
function outlinePoints(zone: ScenarioZone): Point[] {
  const { halfX, halfZ } = zoneExtent(zone);
  if (zone.shape === "circle") {
    return Array.from({ length: DRAPE_SEGMENTS * 2 }, (_, i) => {
      const angle = (i / (DRAPE_SEGMENTS * 2)) * Math.PI * 2;
      return { x: Math.cos(angle) * halfX, z: Math.sin(angle) * halfX };
    });
  }
  const corners: Point[] = [
    { x: -halfX, z: -halfZ },
    { x: halfX, z: -halfZ },
    { x: halfX, z: halfZ },
    { x: -halfX, z: halfZ },
  ];
  const out: Point[] = [];
  for (let side = 0; side < 4; side++) {
    const from = corners[side];
    const to = corners[(side + 1) % 4];
    for (let step = 0; step < DRAPE_SEGMENTS; step++) {
      const t = step / DRAPE_SEGMENTS;
      out.push({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      });
    }
  }
  return out;
}

/** The flat footprint of a zone, in elmos relative to its centre, before it is
 *  draped. */
function footprintGeometry(zone: ScenarioZone): THREE.BufferGeometry {
  const { halfX, halfZ } = zoneExtent(zone);
  const geometry =
    zone.shape === "circle"
      ? new THREE.CircleGeometry(halfX, DRAPE_SEGMENTS * 2)
      : new THREE.PlaneGeometry(
          halfX * 2,
          halfZ * 2,
          DRAPE_SEGMENTS,
          DRAPE_SEGMENTS,
        );
  // Both are built in XY. Lying them down puts them in the scene's ground
  // plane, so a vertex's y is a height and can be lifted to the terrain.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createZonesLayer(deps: ZonesLayerDeps): ZonesLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** What is on screen, so a drag can redraw one zone against what it started
   *  as rather than accumulating. */
  let drawn: ScenarioZone[] = [];
  let selectedId: string | null = null;
  const keys = new Set<string>();
  /** Everything one pass allocated, so the next pass can free it. Geometries
   *  and materials are per zone here: a zone's size is in its geometry, so
   *  there is nothing to share between two of them. */
  let owned: { dispose: () => void }[] = [];

  /** The height in elmos at a point `offset` elmos from `centre`, relative to
   *  the height at the centre, which is where the zone's group stands. */
  const relief = (centre: Point, offset: Point): number =>
    deps.groundAt({ x: centre.x + offset.x, z: centre.z + offset.z }) -
    deps.groundAt(centre) +
    LIFT_ELMOS;

  /** Lift every vertex of a footprint onto the ground under it. */
  const drape = (geometry: THREE.BufferGeometry, centre: Point) => {
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      position.setY(i, relief(centre, { x, z }));
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  };

  const buildZone = (zone: ScenarioZone, selected: boolean): THREE.Group => {
    const centre = zoneCenter(zone);
    const colour = selected ? SELECTED_COLOR : ZONE_COLOR;
    const group = new THREE.Group();
    const at = worldToScene(
      centre,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    group.position.set(at.x, deps.groundAt(centre) * handle.scale, at.z);
    // The geometry is in elmos, so the whole zone takes the scene's elmo scale.
    group.scale.setScalar(handle.scale);
    group.userData = { placementKey: zoneKey(zone.id) };

    const fillGeometry = footprintGeometry(zone);
    drape(fillGeometry, centre);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: selected ? 0.22 : 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(fillGeometry, fillMaterial));

    // The outline ignores depth, so a zone behind a ridge is still findable.
    const ring = outlinePoints(zone).map((offset) => {
      return new THREE.Vector3(offset.x, relief(centre, offset), offset.z);
    });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(ring);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const line = new THREE.LineLoop(lineGeometry, lineMaterial);
    line.renderOrder = 3;
    group.add(line);

    owned.push(fillGeometry, fillMaterial, lineGeometry, lineMaterial);

    if (selected) {
      const handleGeometry = new THREE.SphereGeometry(HANDLE_ELMOS / 2, 12, 8);
      const handleMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
      });
      // The move handle is a diamond rather than a ball, and its own colour, so
      // the one knob that moves the whole zone is not mistaken for the corners
      // that resize it.
      const moveGeometry = new THREE.OctahedronGeometry(HANDLE_ELMOS * 0.7);
      const moveMaterial = new THREE.MeshBasicMaterial({
        color: MOVE_HANDLE_COLOR,
        depthTest: false,
      });
      owned.push(handleGeometry, handleMaterial, moveGeometry, moveMaterial);
      for (const name of zoneHandles(zone)) {
        const offset = zoneHandleOffset(zone, name);
        if (!offset) continue;
        const move = name === "move";
        const knob = new THREE.Mesh(
          move ? moveGeometry : handleGeometry,
          move ? moveMaterial : handleMaterial,
        );
        knob.position.set(offset.x, relief(centre, offset), offset.z);
        knob.renderOrder = 4;
        knob.userData = { placementKey: zoneKey(zone.id, name) };
        group.add(knob);
      }
    }

    return group;
  };

  const render = (zones: ScenarioZone[], selected: string | null) => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
    keys.clear();
    for (const zone of zones) {
      root.add(buildZone(zone, zone.id === selected));
      keys.add(zoneKey(zone.id));
      for (const name of zoneHandles(zone)) keys.add(zoneKey(zone.id, name));
    }
    handle.render();
  };

  return {
    root,
    has: (key: string) => keys.has(key),
    grabbable: (key: string) => !!parseZoneKey(key)?.handle,
    draw: (zones, selected) => {
      drawn = zones;
      selectedId = selected;
      render(zones, selected);
    },
    drag: (key, delta) => {
      const ref = parseZoneKey(key);
      if (!ref) return;
      render(
        drawn.map((zone) =>
          zone.id === ref.id ? dragZone(zone, ref.handle, delta) : zone,
        ),
        selectedId,
      );
    },
    dispose: () => {
      root.clear();
      for (const spent of owned) spent.dispose();
      owned = [];
      keys.clear();
      root.removeFromParent();
    },
  };
}
