/**
 * Where a generated shape joins other parts (#3334).
 *
 * A shape's connectors are worked out from its kind and numbers each time they
 * are asked for, never stored, so they follow the shape when it is resized,
 * flipped or reshaped. `connectors.ts` asks for them through `pieceConnectors`,
 * which is why hover and click placement, saved joins and module mounts take
 * them with no code of their own.
 *
 * Ids are the ones a box uses for the face that points the same way, so a join
 * to the top of a part survives the part being swapped for a shape. A kind with
 * a face a box has no equivalent for names it by what it is.
 *
 * A kind adds its own by putting a function in `CONNECTORS`. A kind without one
 * has none, and `shapeConnectors.test.ts` fails for it.
 */

import type { LegoConnector } from "./connectors";
import {
  coneTopRadius,
  type LegoShape,
  SPHERE_WHOLE,
  shapeAxis,
  shapeBox,
  sphereProfile,
  wallReach,
  wedgeProfile,
} from "./shapes";
import type { Vec3 } from "./snapping";

/** The order `boxConnectors` lists its faces in, which a shape keeps so a face
 *  is in the same place in the list whatever the part. */
const BOX_ORDER = ["+x", "-x", "+y", "-y", "+z", "-z"];

function idOf(axis: number, sign: number): string {
  return `${sign > 0 ? "+" : "-"}${"xyz"[axis]}`;
}

/** The up direction a box gives a face: +y, or +z on a face that points along
 *  y. See `boxConnectors`. */
function upFor(facing: Vec3): Vec3 {
  const base: Vec3 = Math.abs(facing[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const dot = base[0] * facing[0] + base[1] * facing[1] + base[2] * facing[2];
  const up: Vec3 = [
    base[0] - dot * facing[0],
    base[1] - dot * facing[1],
    base[2] - dot * facing[2],
  ];
  const length = Math.hypot(...up);
  return [up[0] / length, up[1] / length, up[2] / length];
}

function connector(id: string, position: Vec3, facing: Vec3): LegoConnector {
  const length = Math.hypot(...facing);
  const unit: Vec3 = [
    facing[0] / length,
    facing[1] / length,
    facing[2] / length,
  ];
  return { id, position, facing: unit, up: upFor(unit) };
}

/**
 * A cylinder or a tube: the middle of each end, facing along the axis, and the
 * point on the wall at each of four places round it, facing straight out. The
 * wall points are where the wall is met going out from the middle along the
 * two axes across the shape, so each is on the surface and, for a ring whose
 * side count is a multiple of 4, on the box face.
 */
function roundConnectors(shape: LegoShape): LegoConnector[] {
  const axis = shapeAxis(shape);
  const across = [(axis + 1) % 3, (axis + 2) % 3] as const;
  const connectors: LegoConnector[] = [];
  for (const sign of [1, -1]) {
    const position: Vec3 = [0, 0, 0];
    position[axis] = (sign * shape.size[axis]) / 2;
    const facing: Vec3 = [0, 0, 0];
    facing[axis] = sign;
    connectors.push(connector(idOf(axis, sign), position, facing));
  }
  for (const [which, other] of across.entries()) {
    for (const sign of [1, -1] as const) {
      const position: Vec3 = [0, 0, 0];
      position[other] = sign * wallReach(shape, which as 0 | 1, sign);
      const facing: Vec3 = [0, 0, 0];
      facing[other] = sign;
      connectors.push(connector(idOf(other, sign), position, facing));
    }
  }
  return connectors.sort(
    (a, b) => BOX_ORDER.indexOf(a.id) - BOX_ORDER.indexOf(b.id),
  );
}

/**
 * A cone: the middle of the flat bottom, at the low end of the axis, and for a
 * cut cone the middle of the flat top. A cone's tip is a point with no face to
 * join, so it has none. There is none on the slanted side either: a join there
 * could not sit flush against a surface that leans.
 */
function coneConnectors(shape: LegoShape): LegoConnector[] {
  const axis = shapeAxis(shape);
  const ends = coneTopRadius(shape) > 0 ? [1, -1] : [-1];
  return ends.map((sign) => {
    const position: Vec3 = [0, 0, 0];
    position[axis] = (sign * shape.size[axis]) / 2;
    const facing: Vec3 = [0, 0, 0];
    facing[axis] = sign;
    return connector(idOf(axis, sign), position, facing);
  });
}

/**
 * A sphere, dome or bowl. A dome or a bowl has its flat base and its apex, one
 * at each end of its height and facing along y. Its sides are a curve that
 * leaves the box at mid height, so it has none there. A whole sphere has those
 * two as its poles and the four points of its equator as well, as a cylinder
 * has round its side.
 */
function sphereConnectors(shape: LegoShape): LegoConnector[] {
  const all = roundConnectors({
    ...shape,
    options: { ...shape.options, axis: 1 },
  });
  return sphereProfile(shape).keep === SPHERE_WHOLE
    ? all
    : all.filter((c) => c.id === "+y" || c.id === "-y");
}

/** The centre of a flat polygon, from the area it covers. */
function centroid(points: [number, number][]): [number, number] {
  let area = 0;
  let x = 0;
  let y = 0;
  for (const [i, p] of points.entries()) {
    const q = points[(i + 1) % points.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross;
    x += (p[0] + q[0]) * cross;
    y += (p[1] + q[1]) * cross;
  }
  return [x / (3 * area), y / (3 * area)];
}

/**
 * A wedge or ramp. Its faces are the bottom (-y), the slope (+y, since it takes
 * the place of the top), the two sides (+x, -x), the high end and, when the low
 * end has any height, the low end (+z or -z by which way the slope runs).
 *
 * The slope faces along its own normal. The sides are triangles or
 * trapezoids, so theirs sit at the centre of the area they cover, which a
 * point at the middle of the box would miss on a pure wedge.
 */
function wedgeConnectors(shape: LegoShape): LegoConnector[] {
  const [w, h, d] = shape.size;
  const { low, flip } = wedgeProfile(shape);
  const down = flip ? -1 : 1;
  const zHigh = flip ? d / 2 : -d / 2;
  const zLow = -zHigh;
  const y0 = -h / 2;
  const yLow = y0 + low;
  const rise = h - low;

  const side: [number, number][] = [
    [zHigh, y0],
    [zLow, y0],
    ...(low > 0 ? [[zLow, yLow] as [number, number]] : []),
    [zHigh, h / 2],
  ];
  const [sideZ, sideY] = centroid(side);

  const connectors = [
    connector("-y", [0, y0, 0], [0, -1, 0]),
    connector("+y", [0, (h / 2 + yLow) / 2, 0], [0, d, rise * down]),
    connector("+x", [w / 2, sideY, sideZ], [1, 0, 0]),
    connector("-x", [-w / 2, sideY, sideZ], [-1, 0, 0]),
    connector(idOf(2, -down), [0, 0, zHigh], [0, 0, -down]),
  ];
  if (low > 0) {
    connectors.push(
      connector(idOf(2, down), [0, y0 + low / 2, zLow], [0, 0, down]),
    );
  }
  return connectors;
}

const CONNECTORS: Record<string, (shape: LegoShape) => LegoConnector[]> = {
  cylinder: roundConnectors,
  tube: roundConnectors,
  cone: coneConnectors,
  sphere: sphereConnectors,
  wedge: wedgeConnectors,
};

/**
 * The connectors of a generated shape, in the shape's own space (the same
 * space as a pack part's, centred on its box). None for a kind this build does
 * not know.
 */
export function shapeConnectors(shape: LegoShape): LegoConnector[] {
  if (!shapeBox(shape)) return [];
  return CONNECTORS[shape.kind]?.(shape) ?? [];
}
