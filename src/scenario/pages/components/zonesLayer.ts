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
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { worldToScene } from "@/placement/scene";
import type { Point, ScenarioZone } from "../../model";
import {
  dragZone,
  isMarqueeZone,
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

/**
 * What a selection marquee is drawn in (issue #2279).
 *
 * Black and white alternating, which is what a selection marquee has looked like
 * since before any of this, and the reason it looks like that is the reason it
 * is used here: the two colours are drawn on top of each other, so whichever one
 * the ground underneath washes out, the other one is still there. That matters
 * on a map, where the same box is dragged over dark grass, pale sand and snow in
 * one gesture.
 *
 * Not green. A path is `0x86efac` and is drawn as a line lying on the ground,
 * which is exactly what a marquee is, so a green box would read as somebody's
 * order path. Not the zone's own sky blue for the same reason in reverse: that
 * is the thing a marquee was being mistaken for.
 */
const MARQUEE_COLOR = 0xffffff;
const MARQUEE_BACKING_COLOR = 0x0f172a;

/**
 * How wide the marquee is drawn, in pixels, white over dark.
 *
 * `LineBasicMaterial.linewidth` is ignored by every WebGL driver, so a marquee
 * asking for a wide line got a one pixel one and read as a hairline over
 * terrain. `Line2` builds each segment as screen-space geometry instead, which
 * is what the lego builder's edit box already does
 * (`PIECE_EDIT_LINE_WIDTH` in `src/lego/pages/components/ModelViewport.tsx`).
 *
 * The dark line is wider so it shows either side of the white one as well as
 * through its gaps, which is what keeps the box readable over snow and sand.
 */
const MARQUEE_LINE_WIDTH = 3;
const MARQUEE_BACKING_WIDTH = 5;

/** How many dashes go round a marquee, however big it is or how far away the
 *  camera is. A dash measured in elmos would be a solid line on a box drawn
 *  round two units and a dotted one round half the map. */
const MARQUEE_DASHES = 32;

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

  /**
   * The selection marquee: a box round what a drag is about to select
   * (issue #2279).
   *
   * An outline and nothing else. A zone is a piece of ground and is drawn as
   * one, a translucent sheet with a solid edge, and a marquee that borrowed
   * that read as a zone being drawn - which is the one thing it must not,
   * because both gestures are a left-drag on bare ground and only the mode
   * tells them apart. So the two are as different as they can be: no fill at
   * all, and a dashed edge rather than a solid one.
   *
   * Two lines on the same points, a solid dark one under a dashed white one, so
   * the white shows over dark ground and the dark shows through the gaps over
   * pale ground. Neither is depth tested, the same as a zone's outline, so a
   * box drawn across a ridge is a box rather than two halves.
   *
   * Both are `Line2` rather than `THREE.Line`, which is what gives them a width
   * a driver honours: see {@link MARQUEE_LINE_WIDTH}.
   */
  const buildMarquee = (zone: ScenarioZone): THREE.Group => {
    const centre = zoneCenter(zone);
    const group = new THREE.Group();
    const at = worldToScene(
      centre,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    group.position.set(at.x, deps.groundAt(centre) * handle.scale, at.z);
    group.scale.setScalar(handle.scale);

    const ring = outlinePoints(zone).map(
      (offset) => new THREE.Vector3(offset.x, relief(centre, offset), offset.z),
    );
    // Closed by hand rather than drawn as a loop, because the dashes are
    // measured along the line and the closing side has to be measured with it.
    const closed = [...ring, ring[0]];
    const flat = closed.flatMap((point) => [point.x, point.y, point.z]);

    // A dash is measured in the geometry's own units, which are elmos here, so
    // the perimeter is walked before a dash length can be chosen.
    let perimeter = 0;
    for (let i = 1; i < closed.length; i++) {
      perimeter += closed[i].distanceTo(closed[i - 1]);
    }
    const dash = perimeter / (MARQUEE_DASHES * 2);

    // Screen-space widths need the viewport size. The marquee is rebuilt on
    // every frame of the drag it exists for, so reading it here is enough: a
    // window resized mid-drag is one frame behind and then right again.
    const viewport = new THREE.Vector2();
    handle.renderer.getSize(viewport);

    const backingGeometry = new LineGeometry();
    backingGeometry.setPositions(flat);
    const backingMaterial = new LineMaterial({
      color: MARQUEE_BACKING_COLOR,
      linewidth: MARQUEE_BACKING_WIDTH,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    backingMaterial.resolution.copy(viewport);
    const backing = new Line2(backingGeometry, backingMaterial);
    backing.renderOrder = 3;
    group.add(backing);

    const dashGeometry = new LineGeometry();
    dashGeometry.setPositions(flat);
    const dashMaterial = new LineMaterial({
      color: MARQUEE_COLOR,
      linewidth: MARQUEE_LINE_WIDTH,
      dashed: true,
      dashSize: dash,
      gapSize: dash,
      depthTest: false,
    });
    dashMaterial.resolution.copy(viewport);
    const dashes = new Line2(dashGeometry, dashMaterial);
    // What the dash shader measures against `dashSize`, in the geometry's own
    // units. Nothing is dashed without it.
    dashes.computeLineDistances();
    dashes.renderOrder = 4;
    group.add(dashes);

    owned.push(backingGeometry, backingMaterial, dashGeometry, dashMaterial);
    return group;
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
      // A marquee is a box being dragged out, not a thing on the map, so it is
      // drawn and nothing more: no key, so nothing can pick it, select it or
      // take hold of it (issue #2279).
      if (isMarqueeZone(zone)) {
        root.add(buildMarquee(zone));
        continue;
      }
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
