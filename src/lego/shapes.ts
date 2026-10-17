/**
 * Shapes made in code rather than taken from the parts pack (#3325).
 *
 * A piece with a `shape` stores only a kind and some numbers. The mesh is made
 * from those when something needs it and cached by them, so a document stays
 * small and resizing a shape changes numbers rather than geometry.
 *
 * A shape is centred on its own box, as every pack part is, so `pivot` means
 * the same for both. Its box is its `size`, which is why `shapeBox` can answer
 * without making the mesh: every generator has to fill that box exactly.
 *
 * The mesh is the same 8 float vertex record the pack uses (x, y, z, nx, ny,
 * nz, u, v), wound counter clockwise seen from outside, so the bake and the
 * viewport treat it like a part.
 */

import * as THREE from "three";

/** A piece's generated shape, as the document stores it. */
export interface LegoShape {
  /** Which generator makes it. A kind this build does not know is kept as it
   *  is and draws nothing, so a newer file survives an older build. */
  kind: string;
  /** The shape's box along x, y and z, in elmos. Every side above zero. */
  size: [number, number, number];
  /**
   * The swatch of the atlas the shape samples, by id (#3326). Until the pack
   * lists its swatches (#3327) the ids are the colourways in
   * `INTERIM_SWATCH_POINTS`. Absent, or an id this build does not know, draws
   * with the first of those.
   */
  swatch?: string;
  /** Numbers a kind needs beyond its size, by name. See each kind. */
  options?: Record<string, number>;
}

/**
 * The middle of each colourway's swatch, in the pack's UVs with v up from the
 * bottom, as #3326 measured them. Every vertex of a shape samples this one
 * point until the shared tiling in #3327 replaces it, so a shape already shows
 * the colour it will have. Green and grey are plain there. Tan has no plain
 * surface, so its point lands on grainy concrete.
 */
export const INTERIM_SWATCH_POINTS: Record<string, [number, number]> = {
  green: [0.1836, 0.9648],
  tan: [0.5952, 0.9648],
  grey: [0.9795, 0.2969],
};

/** A shape's mesh in the pack's vertex record, with its own index run. */
export interface ShapeMesh {
  /** x, y, z, nx, ny, nz, u, v per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
  vCount: number;
  iCount: number;
}

type Vec3 = [number, number, number];

/** What a generator gives back before the UVs are added. */
interface ShapeSolid {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** A solid with its UVs, two numbers a vertex. */
interface TexturedSolid extends ShapeSolid {
  uvs: number[];
}

/**
 * Sides round a cylinder when it does not say. 12 sides is 50 vertices, close
 * to the 47 of the middle part in the bundled pack's green colourway (124
 * parts, 12 to 264 vertices), so a cylinder costs about what a block does.
 */
export const DEFAULT_CYLINDER_SIDES = 12;

/** The axis an upright cylinder runs along, y. */
const DEFAULT_CYLINDER_AXIS = 1;

/**
 * What the parts strip lists for a kind (#3337): its name, the size a click
 * adds it at, and the words search finds it by. Each kind added to
 * `GENERATORS` adds a line here and appears in the strip with no other change.
 * The default size is 2 along every side because 2 is the longest side of the
 * median part in the bundled pack, and is a whole number of its 0.25 steps.
 */
export interface ShapeKind {
  kind: string;
  label: string;
  size: [number, number, number];
  options?: Record<string, number>;
  tags: string[];
}

export const SHAPE_KINDS: ShapeKind[] = [
  { kind: "cylinder", label: "Cylinder", size: [2, 2, 2], tags: ["round"] },
];

const GENERATORS: Record<string, (shape: LegoShape) => ShapeSolid> = {
  cylinder,
};

/** Whether this build can make a shape of this kind. */
export function isKnownShapeKind(kind: string): boolean {
  return Object.hasOwn(GENERATORS, kind);
}

/**
 * The shape's box in its own space, without making the mesh. Null for a kind
 * this build does not know, which has no geometry to measure.
 */
export function shapeBox(shape: LegoShape): { min: Vec3; max: Vec3 } | null {
  if (!isKnownShapeKind(shape.kind)) return null;
  const [x, y, z] = shape.size;
  return { min: [-x / 2, -y / 2, -z / 2], max: [x / 2, y / 2, z / 2] };
}

/** A shape's identity for the cache: its kind and every number it carries. */
export function shapeKey(shape: LegoShape): string {
  const options = Object.entries(shape.options ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  return `${shape.kind}|${shape.size.join(",")}|${shape.swatch ?? ""}|${options}`;
}

const meshCache = new Map<string, ShapeMesh>();

/**
 * The shape's mesh, made once for each set of numbers. Null for a kind this
 * build does not know.
 */
export function shapeMesh(shape: LegoShape): ShapeMesh | null {
  if (!isKnownShapeKind(shape.kind)) return null;
  const key = shapeKey(shape);
  const cached = meshCache.get(key);
  if (cached) return cached;

  const solid = textureShape(shape, GENERATORS[shape.kind](shape));
  const vCount = solid.positions.length / 3;
  const vertices = new Float32Array(vCount * 8);
  for (let i = 0; i < vCount; i++) {
    vertices.set(solid.positions.slice(i * 3, i * 3 + 3), i * 8);
    vertices.set(solid.normals.slice(i * 3, i * 3 + 3), i * 8 + 3);
    vertices.set(solid.uvs.slice(i * 2, i * 2 + 2), i * 8 + 6);
  }
  const mesh: ShapeMesh = {
    vertices,
    indices: Uint32Array.from(solid.indices),
    vCount,
    iCount: solid.indices.length,
  };
  meshCache.set(key, mesh);
  return mesh;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * The shape's mesh as three.js geometry, made once for each set of numbers and
 * shared by every view, as a part's is. Null for a kind this build does not
 * know, which then draws nothing.
 */
export function getShapeGeometry(
  shape: LegoShape,
): THREE.BufferGeometry | null {
  const mesh = shapeMesh(shape);
  const box = shapeBox(shape);
  if (!mesh || !box) return null;
  const key = shapeKey(shape);
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const buffer = new THREE.InterleavedBuffer(mesh.vertices, 8);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.InterleavedBufferAttribute(buffer, 3, 0),
  );
  geometry.setAttribute(
    "normal",
    new THREE.InterleavedBufferAttribute(buffer, 3, 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.InterleavedBufferAttribute(buffer, 2, 6),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...box.min),
    new THREE.Vector3(...box.max),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  geometryCache.set(key, geometry);
  return geometry;
}

/**
 * A shape's solid with its UVs: the one place a shape's UVs are made.
 *
 * #3326 decided how shapes are textured: each generator unwraps its faces in
 * pack units, and one shared function cuts the triangles along a grid one
 * swatch wide and tiles the swatch, mirrored. That changes the vertices and
 * the triangles, which is why this takes the whole solid and hands one back.
 * The shared function arrives with the first shape kinds (#3327) and replaces
 * this body. Until then every vertex samples the middle of its swatch.
 */
export function textureShape(
  shape: LegoShape,
  solid: ShapeSolid,
): TexturedSolid {
  const [u, v] =
    (shape.swatch !== undefined &&
      Object.hasOwn(INTERIM_SWATCH_POINTS, shape.swatch) &&
      INTERIM_SWATCH_POINTS[shape.swatch]) ||
    INTERIM_SWATCH_POINTS.green;
  const uvs: number[] = [];
  for (let i = 0; i < solid.positions.length / 3; i++) uvs.push(u, v);
  return { ...solid, uvs };
}

/**
 * A cylinder filling its box. Options: `axis`, the axis it runs along (0, 1 or
 * 2 for x, y or z, default y), and `sides`, the sides round it (3 or more,
 * default `DEFAULT_CYLINDER_SIDES`).
 *
 * The two sizes across the axis are its two diameters, so unequal ones make an
 * oval. The ring is stretched to touch all four sides of the box whatever the
 * side count, so the box is exact. The side is smooth and the caps are flat,
 * and they share no vertices, so each keeps its own normals.
 */
function cylinder(shape: LegoShape): ShapeSolid {
  const axisOption = shape.options?.axis;
  const axis =
    axisOption === 0 || axisOption === 1 || axisOption === 2
      ? axisOption
      : DEFAULT_CYLINDER_AXIS;
  const sidesOption = Math.round(shape.options?.sides ?? NaN);
  const sides = sidesOption >= 3 ? sidesOption : DEFAULT_CYLINDER_SIDES;
  // b, c and the axis in turn are right handed, so a turn from b to c is
  // counter clockwise seen from the axis's positive end.
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const half = shape.size.map((s) => s / 2);

  // The unit ring, then each of its two directions moved and scaled so its
  // extremes land on the box: a ring of 3 or 5 sides does not reach -1 and 1.
  const angles = Array.from(
    { length: sides },
    (_, k) => (2 * Math.PI * k) / sides,
  );
  const spanOf = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return { scale: 2 / (hi - lo), shift: -(hi + lo) / (hi - lo) };
  };
  const cos = angles.map(Math.cos);
  const sin = angles.map(Math.sin);
  const fb = spanOf(cos);
  const fc = spanOf(sin);
  const ring = angles.map((_, k) => ({
    b: (cos[k] * fb.scale + fb.shift) * half[b],
    c: (sin[k] * fc.scale + fc.shift) * half[c],
    // A stretched circle's normal is stretched the other way.
    nb: cos[k] / (fb.scale * half[b]),
    nc: sin[k] / (fc.scale * half[c]),
  }));

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertex = (along: number, pb: number, pc: number, n: Vec3) => {
    const p: Vec3 = [0, 0, 0];
    p[axis] = along;
    p[b] = pb;
    p[c] = pc;
    positions.push(...p);
    const length = Math.hypot(...n);
    normals.push(n[0] / length, n[1] / length, n[2] / length);
    return positions.length / 3 - 1;
  };
  const direction = (na: number, nb: number, nc: number): Vec3 => {
    const n: Vec3 = [0, 0, 0];
    n[axis] = na;
    n[b] = nb;
    n[c] = nc;
    return n;
  };

  // The side: a ring at each end, sharing a smooth normal per corner.
  const low = ring.map((r) =>
    vertex(-half[axis], r.b, r.c, direction(0, r.nb, r.nc)),
  );
  const high = ring.map((r) =>
    vertex(half[axis], r.b, r.c, direction(0, r.nb, r.nc)),
  );
  for (let k = 0; k < sides; k++) {
    const next = (k + 1) % sides;
    indices.push(low[k], low[next], high[next], low[k], high[next], high[k]);
  }

  // The caps, each a fan round its own middle.
  for (const end of [1, -1]) {
    const normal = direction(end, 0, 0);
    const middle = vertex(end * half[axis], 0, 0, normal);
    const rim = ring.map((r) => vertex(end * half[axis], r.b, r.c, normal));
    for (let k = 0; k < sides; k++) {
      const next = (k + 1) % sides;
      if (end > 0) indices.push(middle, rim[k], rim[next]);
      else indices.push(middle, rim[next], rim[k]);
    }
  }
  return { positions, normals, indices };
}

/**
 * A stored shape, or null when it has no kind or no usable size. A kind this
 * build does not know is kept, as are its numbers, so saving does not lose it.
 */
export function parseShape(value: unknown): LegoShape | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || v.kind === "") return null;
  const size = v.size;
  if (
    !Array.isArray(size) ||
    size.length !== 3 ||
    !size.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
  ) {
    return null;
  }
  const options =
    typeof v.options === "object" && v.options !== null
      ? Object.fromEntries(
          Object.entries(v.options).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1]),
          ),
        )
      : {};
  return {
    kind: v.kind,
    size: [size[0], size[1], size[2]],
    ...(typeof v.swatch === "string" && v.swatch !== ""
      ? { swatch: v.swatch }
      : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}
