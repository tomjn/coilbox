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

import type { MapScene3D } from "@/lib/mapScene";

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
  /** Put a plate under each of these, sized to it. Everything else the plate was
   *  marking is taken away, so an empty list is the way to show nothing. */
  show: (objects: THREE.Object3D[]) => void;
  hide: () => void;
  dispose: () => void;
}

/** One plate, and the size it was last built at, so a drag that calls this on
 *  every move rebuilds nothing while the unit being carried stays the size it
 *  was. */
interface Plate {
  group: THREE.Group;
  built: { x: number; z: number } | null;
  geometries: THREE.BufferGeometry[];
}

/**
 * The plates drawn under whatever is selected.
 *
 * Their own objects rather than a change to the drawn units, so a redraw of the
 * units layer cannot lose them, and depth tested so the unit standing on one
 * hides the half of it underneath: a plate drawn over the model it belongs to
 * reads as a sticker rather than as ground.
 *
 * As many as the selection has units in it (issue #2279), from a pool that grows
 * to the largest selection of the session and is emptied when the scene goes. A
 * marquee round a base is a plate per building, which is what makes a selection
 * of twelve something an author can see rather than infer.
 */
export function createSelectionPlate(handle: MapScene3D): SelectionPlate {
  const root = new THREE.Group();
  // Under the models rather than over them, so the depth test decides what is
  // seen rather than the draw order.
  root.renderOrder = 1;
  handle.scene.add(root);

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

  const plates: Plate[] = [];

  const build = (plate: Plate, half: PlateHalf) => {
    plate.group.clear();
    for (const spent of plate.geometries) spent.dispose();
    plate.geometries = [];

    const fill = flat(shapeOf(hexagon(half)));
    plate.group.add(new THREE.Mesh(fill, fillMaterial));
    plate.geometries.push(fill);

    const inner = hexagonInset(half, plateBorder(half, MIN_BORDER_ELMOS));
    if (inner) {
      const ring = shapeOf(hexagon(half));
      ring.holes.push(holeOf(inner));
      const border = flat(ring);
      plate.group.add(new THREE.Mesh(border, borderMaterial));
      plate.geometries.push(border);
    }
    plate.built = { x: half.x, z: half.z };
  };

  /** The `at`th plate, made if the selection has never been this big before. */
  const plateAt = (at: number): Plate => {
    const held = plates[at];
    if (held) return held;
    const group = new THREE.Group();
    group.visible = false;
    root.add(group);
    const made: Plate = { group, built: null, geometries: [] };
    plates.push(made);
    return made;
  };

  const show = (objects: THREE.Object3D[]) => {
    objects.forEach((object, at) => {
      const plate = plateAt(at);
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      // The bounds are the model as it stands, turned and all, so a plate along
      // the map's own axes already fits it. Turning the plate with the unit
      // would want the box taken before the turn, and would buy nothing: what
      // is under a selected unit is ground rather than part of the unit.
      const half = plateHalf(size, MIN_PLATE_ELMOS * handle.scale);
      if (!plate.built || plate.built.x !== half.x || plate.built.z !== half.z)
        build(plate, half);
      // A hair of clearance, so the plate is not fighting the ground it lies on.
      plate.group.position.set(
        object.position.x,
        object.position.y + handle.scale,
        object.position.z,
      );
      plate.group.visible = true;
    });
    for (let at = objects.length; at < plates.length; at++)
      plates[at].group.visible = false;
  };

  return {
    show,
    hide: () => show([]),
    dispose: () => {
      for (const plate of plates) {
        plate.group.clear();
        for (const spent of plate.geometries) spent.dispose();
        plate.geometries = [];
      }
      plates.length = 0;
      root.clear();
      root.removeFromParent();
      fillMaterial.dispose();
      borderMaterial.dispose();
    },
  };
}
