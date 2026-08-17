/**
 * What marks a selected unit that has no ground of its own (issue #1716).
 *
 * A building says it is selected with its footprint, because a building really
 * does stand on a patch of the map and that patch is the truth about it.
 * Everything else the pointer can pick up has no footprint at all: a tank is a
 * model at a point. So it gets a plate under it instead, which is the shape the
 * engine's own games draw under a selected unit.
 *
 * A hexagon rather than the circle that was here before. The circle was sized to
 * be seen at framing zoom rather than to fit the unit, so a scout came with a
 * ring wider than a factory, and at the zoom an author actually works at it
 * swallowed the ground around the unit and the squares of anything standing
 * near it. The plate hugs the model, and being a plate rather than an outline it
 * is still visible when the model is a few pixels across.
 *
 * The maths is here and the drawing is here too, but they are kept apart: the
 * shape is plain arithmetic and is tested, and the three.js below it only turns
 * points into meshes.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";

/** What the plate is drawn in: the colour the ring was, which is the colour a
 *  held building's squares take. One colour for "this is the one you have",
 *  whichever kind of thing it is. */
const PLATE_COLOR = 0x7dd3fc;

/** How far the plate stands out past the model, as a fraction of its size. Far
 *  enough that the plate is ground the unit is standing on rather than an
 *  outline traced round its feet, and nothing like the circle it replaces, which
 *  was wider than the unit by half again. */
const MARGIN = 1.3;

/** The smallest a plate is drawn, as a half-extent in elmos. A scout is a few
 *  pixels across at framing zoom (#830), so without a floor its plate would be
 *  a few pixels too. Well under the ring's old 56, which is the point. */
export const MIN_PLATE_ELMOS = 18;

/** How wide the plate's border is, as a fraction of the shorter half-extent. A
 *  third of the width the ring's border was. */
const BORDER = 0.06;

/** The narrowest that border may be, in elmos, so the plate under a small unit
 *  still has an edge rather than a suggestion of one. */
const MIN_BORDER_ELMOS = 1.2;

/** How much of the plate's length the flat sides take. The rest is the two
 *  points, one at each end, which is what makes it a hexagon rather than a
 *  rectangle with the corners knocked off. */
const FLAT = 0.5;

/** Half a plate, along the unit's own two axes. */
export interface PlateHalf {
  x: number;
  z: number;
}

/**
 * How big a plate goes under a model of this size.
 *
 * `size` is the model's own extent and `floor` the smallest half-extent worth
 * drawing, both in whatever units the caller is working in. The two axes are
 * sized separately, so a long thin unit gets a long thin plate rather than a
 * disc as wide as it is long.
 */
export function plateHalf(
  size: { x: number; z: number },
  floor: number,
): PlateHalf {
  return {
    x: Math.max((size.x / 2) * MARGIN, floor),
    z: Math.max((size.z / 2) * MARGIN, floor),
  };
}

/** How wide the border of a plate this size is drawn. */
export function plateBorder(half: PlateHalf, floor: number): number {
  return Math.max(Math.min(half.x, half.z) * BORDER, floor);
}

/**
 * The plate's outline, going round once.
 *
 * Six points: one at each end of the long axis and four at the corners of the
 * flat middle. Wound the same way whichever axis is longer, so a hole cut out of
 * it can be the same points scaled down.
 */
export function hexagon(half: PlateHalf): { x: number; z: number }[] {
  const flat = half.x * FLAT;
  return [
    { x: half.x, z: 0 },
    { x: flat, z: half.z },
    { x: -flat, z: half.z },
    { x: -half.x, z: 0 },
    { x: -flat, z: -half.z },
    { x: flat, z: -half.z },
  ];
}

/**
 * The same hexagon with `border` taken off each edge, which is the hole in the
 * border ring.
 *
 * Pulled in towards the middle rather than offset edge by edge. On a shape this
 * blunt the two agree everywhere but the two points, where a scaled inset leaves
 * the border a little thinner, and nothing about a selection marker turns on a
 * fraction of an elmo at the tip.
 *
 * Nothing is returned when the border would eat the whole plate, which is a
 * plate too small to have an inside.
 */
export function hexagonInset(
  half: PlateHalf,
  border: number,
): { x: number; z: number }[] | null {
  const inner = {
    x: half.x - border,
    z: half.z - border,
  };
  if (inner.x <= 0 || inner.z <= 0) return null;
  return hexagon(inner);
}

/** A shape in the ground plane, from points measured in x and z. */
function shapeOf(points: { x: number; z: number }[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].z);
  for (const point of points.slice(1)) shape.lineTo(point.x, point.z);
  shape.closePath();
  return shape;
}

/** The same points as a hole, which three wants wound the other way. */
function holeOf(points: { x: number; z: number }[]): THREE.Path {
  const path = new THREE.Path();
  const back = [...points].reverse();
  path.moveTo(back[0].x, back[0].z);
  for (const point of back.slice(1)) path.lineTo(point.x, point.z);
  path.closePath();
  return path;
}

/** A shape laid flat on the ground, y up. */
function flat(shape: THREE.Shape): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export interface SelectionPlate {
  /** Put the plate under an object, sized and turned to it. */
  show: (object: THREE.Object3D) => void;
  hide: () => void;
  dispose: () => void;
}

/**
 * The plate drawn under whatever is selected.
 *
 * Its own object rather than a change to the drawn unit, so a redraw of the
 * units layer cannot lose it, and depth tested so the unit standing on it hides
 * the half of it underneath: a plate drawn over the model it belongs to reads as
 * a sticker rather than as ground.
 *
 * The geometry is rebuilt only when the size changes, because a drag calls this
 * on every move and the unit being carried is the same size all the way.
 */
export function createSelectionPlate(handle: MapScene3D): SelectionPlate {
  const group = new THREE.Group();
  group.visible = false;
  // Under the models rather than over them, so the depth test decides what is
  // seen rather than the draw order.
  group.renderOrder = 1;
  handle.scene.add(group);

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: PLATE_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const borderMaterial = new THREE.MeshBasicMaterial({
    color: PLATE_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  let built: { x: number; z: number } | null = null;
  let geometries: THREE.BufferGeometry[] = [];

  const build = (half: PlateHalf) => {
    group.clear();
    for (const spent of geometries) spent.dispose();
    geometries = [];

    const fill = flat(shapeOf(hexagon(half)));
    group.add(new THREE.Mesh(fill, fillMaterial));
    geometries.push(fill);

    const inner = hexagonInset(half, plateBorder(half, MIN_BORDER_ELMOS));
    if (inner) {
      const ring = shapeOf(hexagon(half));
      ring.holes.push(holeOf(inner));
      const border = flat(ring);
      group.add(new THREE.Mesh(border, borderMaterial));
      geometries.push(border);
    }
    built = { x: half.x, z: half.z };
  };

  const show = (object: THREE.Object3D) => {
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    // The bounds are the model as it stands, turned and all, so a plate along
    // the map's own axes already fits it. Turning the plate with the unit would
    // want the box taken before the turn, and would buy nothing: what is under
    // a selected unit is ground rather than part of the unit.
    const half = plateHalf(size, MIN_PLATE_ELMOS * handle.scale);
    if (!built || built.x !== half.x || built.z !== half.z) build(half);
    // A hair of clearance, so the plate is not fighting the ground it lies on.
    group.position.set(
      object.position.x,
      object.position.y + handle.scale,
      object.position.z,
    );
    group.visible = true;
  };

  return {
    show,
    hide: () => {
      group.visible = false;
    },
    dispose: () => {
      group.clear();
      group.removeFromParent();
      for (const spent of geometries) spent.dispose();
      geometries = [];
      fillMaterial.dispose();
      borderMaterial.dispose();
    },
  };
}
