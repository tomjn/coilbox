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
   * The swatch of the atlas the shape samples, by the id the base pack gives it
   * in `swatches` (#3326). Absent, or an id the pack does not list, draws with
   * the pack's first swatch.
   */
  swatch?: string;
  /** Numbers a kind needs beyond its size, by name. See each kind. */
  options?: Record<string, number>;
}

/**
 * A rectangle of plain surface on the atlas that a shape tiles, as the base
 * pack's `swatches` lists it. `uv` is in the pack's UVs, v up from the bottom,
 * and `tile` is how many pack units one copy of it covers, so a shape is drawn
 * at the pack's own texel density whatever its size.
 */
export interface ShapeSwatch {
  /** Matches a colourway. */
  id: string;
  uv: { min: [number, number]; max: [number, number] };
  tile: number;
}

let swatches: readonly ShapeSwatch[] = [];

/**
 * Use the base pack's swatches for every shape from now on. The pack loader
 * calls this once the base pack is read. Until then, or for a pack that lists
 * none, there is no swatch and every UV of a shape is (0, 0). A change throws
 * away every mesh made with the old swatches.
 */
export function setShapeSwatches(list: readonly ShapeSwatch[]): void {
  if (JSON.stringify(list) === JSON.stringify(swatches)) return;
  swatches = list;
  meshCache.clear();
  geometryCache.clear();
}

/** The swatches shapes are drawn with: the base pack's. */
export function shapeSwatches(): readonly ShapeSwatch[] {
  return swatches;
}

/** The swatch a shape samples: its own by id, else the first, else none. */
export function swatchOf(shape: LegoShape): ShapeSwatch | null {
  return (
    swatches.find((swatch) => swatch.id === shape.swatch) ?? swatches[0] ?? null
  );
}

/** A shape's mesh in the pack's vertex record, with its own index run. */
export interface ShapeMesh {
  /** x, y, z, nx, ny, nz, u, v per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
  vCount: number;
  iCount: number;
}

type Vec3 = [number, number, number];

/**
 * What a generator gives back: the solid, with each vertex's UV unwrapped flat
 * in pack units and measured from the shape's minimum corner, so a resize from
 * the far face leaves the texture where it was. `textureShape` turns those into
 * the atlas's UVs.
 */
export interface ShapeSolid {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Two numbers a vertex, in pack units. */
  unwrapped: number[];
}

/** A solid with its atlas UVs, two numbers a vertex. */
export interface TexturedSolid {
  positions: number[];
  normals: number[];
  indices: number[];
  uvs: number[];
}

/**
 * Sides round a cylinder or a tube when it does not say. Counted after cutting
 * (#3327): a cylinder 2 across and 1 long has 97 vertices, against 40 for the
 * middle green part of that size and 176 for the most. One 2 across and 10 long
 * has 265, the bundled pack's most is 264. At 16 sides those are 122 and 344.
 */
export const DEFAULT_CYLINDER_SIDES = 12;

/** The axis an upright cylinder runs along, y. */
const DEFAULT_CYLINDER_AXIS = 1;

/**
 * A tube's hole when it states no usable `inner`, as a share of its outer
 * radius.
 */
const DEFAULT_TUBE_HOLE = 0.5;

/**
 * What the parts strip lists for a kind (#3337): its name, the size and options
 * a click adds it with, and the words search finds it by. Each kind added to
 * `GENERATORS` adds a line here and appears in the strip and on the Lego Parts
 * page with no other change. A new shape is 1 along every side, near the
 * pack's smaller blocks. Its swatch is chosen when it is added.
 */
export interface ShapeKind {
  kind: string;
  label: string;
  size: [number, number, number];
  options?: Record<string, number>;
  tags: string[];
}

export const SHAPE_KINDS: ShapeKind[] = [
  {
    kind: "cylinder",
    label: "Cylinder",
    size: [1, 1, 1],
    options: { axis: 1, sides: DEFAULT_CYLINDER_SIDES },
    tags: ["round"],
  },
  {
    kind: "tube",
    label: "Tube",
    size: [1, 1, 1],
    // The hole's radius: the tube's 0.5, less a wall of 0.25.
    options: { axis: 1, sides: DEFAULT_CYLINDER_SIDES, inner: 0.25 },
    tags: ["round", "tube", "hollow", "pipe"],
  },
  {
    kind: "wedge",
    label: "Wedge",
    size: [1, 1, 1],
    options: { low: 0, flip: 0 },
    tags: ["slope", "ramp"],
  },
];

const GENERATORS: Record<string, (shape: LegoShape) => ShapeSolid> = {
  cylinder,
  tube,
  wedge,
};

/** Every kind this build can make, so a test can cover each one. */
export function shapeKinds(): string[] {
  return Object.keys(GENERATORS);
}

/** Whether a shape of this kind is round, so its box corners are not on it. */
export function isRoundShapeKind(kind: string): boolean {
  return kind === "cylinder" || kind === "tube";
}

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
 * #3326 decided how shapes are textured. Each generator unwraps its faces in
 * pack units, and `cutAndTile` cuts the triangles along a grid one tile wide
 * and samples the swatch in each piece, mirrored. With no swatch, which is a
 * pack that lists none, every UV is (0, 0).
 */
export function textureShape(
  shape: LegoShape,
  solid: ShapeSolid,
): TexturedSolid {
  const swatch = swatchOf(shape);
  if (swatch) return cutAndTile(solid, swatch);
  return {
    positions: solid.positions,
    normals: solid.normals,
    indices: solid.indices,
    uvs: solid.unwrapped.map(() => 0),
  };
}

/** One corner of a polygon being cut: where, which way it faces, and its UV
 *  in tiles. */
interface Corner {
  p: Vec3;
  n: Vec3;
  t: [number, number];
}

/** A UV this close to a grid line is on it, so a cut never leaves a sliver. */
const ON_LINE = 1e-9;
/** Two positions this close are the same point. */
const SAME_POINT = 1e-6;

/**
 * Tile a swatch over a solid without stretching it (#3326).
 *
 * The unwrapped UVs are divided by the swatch's `tile`, so one tile is 1 by 1.
 * Every triangle is cut along the whole-number lines it crosses, and each piece
 * samples the swatch through a triangle wave, so every other tile runs
 * backwards. That mirroring is why the UV is the same on both sides of a cut,
 * and the two sides share vertices. Every UV lands inside the swatch.
 *
 * Where two faces meet at a hard edge, a cap and a side, each is cut on its own
 * grid, so one side has points along the edge the other does not. Those points
 * are added to the other side's edge too, so the mesh stays closed.
 */
export function cutAndTile(
  solid: ShapeSolid,
  swatch: ShapeSwatch,
): TexturedSolid {
  const corner = (i: number): Corner => ({
    p: [
      solid.positions[i * 3],
      solid.positions[i * 3 + 1],
      solid.positions[i * 3 + 2],
    ],
    n: [
      solid.normals[i * 3],
      solid.normals[i * 3 + 1],
      solid.normals[i * 3 + 2],
    ],
    t: [
      solid.unwrapped[i * 2] / swatch.tile,
      solid.unwrapped[i * 2 + 1] / swatch.tile,
    ],
  });
  let polygons: Corner[][] = [];
  for (let i = 0; i < solid.indices.length; i += 3) {
    polygons.push([0, 1, 2].map((k) => corner(solid.indices[i + k])));
  }
  for (const axis of [0, 1] as const) {
    polygons = polygons.flatMap((polygon) => cutAlong(polygon, axis));
  }
  polygons = closeEdges(polygons, swatch.tile);

  const { min, max } = swatch.uv;
  const out: TexturedSolid = {
    positions: [],
    normals: [],
    indices: [],
    uvs: [],
  };
  const ids = new Map<string, number>();
  const id = (c: Corner) => {
    const uv = [0, 1].map((k) => min[k] + mirror(c.t[k]) * (max[k] - min[k]));
    const key = [...c.p, ...c.n, ...uv]
      .map((x) => Math.round(x / SAME_POINT))
      .join(",");
    const found = ids.get(key);
    if (found !== undefined) return found;
    const next = out.positions.length / 3;
    out.positions.push(...c.p);
    out.normals.push(...c.n);
    out.uvs.push(...uv);
    ids.set(key, next);
    return next;
  };
  for (const polygon of polygons) {
    for (const triangle of triangulate(polygon)) {
      out.indices.push(...triangle.map(id));
    }
  }
  return out;
}

/** The triangle wave: 0 to 1 over even tiles, 1 back to 0 over odd ones. */
function mirror(x: number): number {
  const f = ((x % 2) + 2) % 2;
  return f <= 1 ? f : 2 - f;
}

/** A convex polygon cut along every whole-number line of one UV axis. */
function cutAlong(polygon: Corner[], axis: 0 | 1): Corner[][] {
  const values = polygon.map((c) => c.t[axis]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  let pieces = [polygon];
  for (let k = Math.floor(lo + ON_LINE) + 1; k < hi - ON_LINE; k++) {
    pieces = pieces.flatMap((piece) => split(piece, axis, k));
  }
  return pieces;
}

/** A convex polygon cut in two along the line where UV `axis` is `k`. */
function split(polygon: Corner[], axis: 0 | 1, k: number): Corner[][] {
  const below: Corner[] = [];
  const above: Corner[] = [];
  const sideOf = (c: Corner) => {
    const d = c.t[axis] - k;
    return Math.abs(d) < ON_LINE ? 0 : d;
  };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const da = sideOf(a);
    const db = sideOf(b);
    if (da <= 0) below.push(a);
    if (da >= 0) above.push(a);
    if (da * db < 0) {
      const middle = between(a, b, da / (da - db));
      middle.t[axis] = k;
      below.push(middle);
      above.push(middle);
    }
  }
  return [below, above].filter((piece) => piece.length >= 3);
}

/** The point `s` of the way from `a` to `b`, its normal made unit again. */
function between(a: Corner, b: Corner, s: number): Corner {
  const mix = (x: number, y: number) => x + (y - x) * s;
  const n: Vec3 = [
    mix(a.n[0], b.n[0]),
    mix(a.n[1], b.n[1]),
    mix(a.n[2], b.n[2]),
  ];
  const length = Math.hypot(...n);
  return {
    p: [mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])],
    n: [n[0] / length, n[1] / length, n[2] / length],
    t: [mix(a.t[0], b.t[0]), mix(a.t[1], b.t[1])],
  };
}

/**
 * Every polygon with the points other polygons put along its edges added to
 * those edges. Without this a cap and a side meet with points on one edge and
 * not the other, and the mesh is no longer closed.
 *
 * Points are bucketed in cubes `cell` wide. A cut piece sits inside one tile,
 * so no edge is longer than a tile's diagonal and an edge only looks in the
 * buckets its own box touches.
 */
function closeEdges(polygons: Corner[][], tile: number): Corner[][] {
  const cell = tile;
  const bucketOf = (p: Vec3) => p.map((x) => Math.floor(x / cell));
  const buckets = new Map<string, Vec3[]>();
  const seen = new Set<string>();
  for (const polygon of polygons) {
    for (const c of polygon) {
      const key = c.p.map((x) => Math.round(x / SAME_POINT)).join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = bucketOf(c.p).join(",");
      const list = buckets.get(bucket);
      if (list) list.push(c.p);
      else buckets.set(bucket, [c.p]);
    }
  }

  const onEdge = (a: Corner, b: Corner): { s: number; at: Corner }[] => {
    const d: Vec3 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const length2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (length2 === 0) return [];
    const from = bucketOf(a.p.map((x, k) => Math.min(x, b.p[k])) as Vec3);
    const to = bucketOf(a.p.map((x, k) => Math.max(x, b.p[k])) as Vec3);
    const found: { s: number; at: Corner }[] = [];
    for (let x = from[0]; x <= to[0]; x++) {
      for (let y = from[1]; y <= to[1]; y++) {
        for (let z = from[2]; z <= to[2]; z++) {
          for (const p of buckets.get(`${x},${y},${z}`) ?? []) {
            const v = [p[0] - a.p[0], p[1] - a.p[1], p[2] - a.p[2]];
            const s = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / length2;
            if (s * Math.sqrt(length2) < SAME_POINT) continue;
            if ((1 - s) * Math.sqrt(length2) < SAME_POINT) continue;
            const off = Math.hypot(
              v[0] - s * d[0],
              v[1] - s * d[1],
              v[2] - s * d[2],
            );
            if (off < SAME_POINT) found.push({ s, at: between(a, b, s) });
          }
        }
      }
    }
    return found.sort((p, q) => p.s - q.s);
  };

  return polygons.map((polygon) => {
    const out: Corner[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      out.push(a);
      for (const { at } of onEdge(a, polygon[(i + 1) % polygon.length])) {
        out.push(at);
      }
    }
    return out;
  });
}

/**
 * A convex polygon as triangles that keep its winding. A polygon with a point
 * partway along an edge is fanned from a corner that gives no flat triangle,
 * or from its middle when no corner does.
 */
function triangulate(polygon: Corner[]): Corner[][] {
  const area = (a: Corner, b: Corner, c: Corner) => {
    const u = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const v = [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]];
    return Math.hypot(
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    );
  };
  const flat = SAME_POINT * SAME_POINT;
  const count = polygon.length;
  for (let start = 0; start < count; start++) {
    const fan: Corner[][] = [];
    for (let i = 1; i + 1 < count; i++) {
      fan.push([
        polygon[start],
        polygon[(start + i) % count],
        polygon[(start + i + 1) % count],
      ]);
    }
    if (fan.every(([a, b, c]) => area(a, b, c) > flat)) return fan;
  }
  // Every corner gives a flat triangle somewhere. The middle of a convex
  // polygon does not, and its UV is the average because the piece sits inside
  // one tile, where the map from position to UV is flat.
  const middle = polygon
    .slice(1)
    .reduce((sum, c, i) => between(sum, c, 1 / (i + 2)), polygon[0]);
  return polygon
    .map((c, i) => [middle, c, polygon[(i + 1) % count]])
    .filter(([a, b, c]) => area(a, b, c) > flat);
}

/** A round shape's numbers, read from its options with their defaults. */
interface Section {
  axis: number;
  /** The two axes across it, right handed with `axis`, so a turn from b to c
   *  is counter clockwise seen from the axis's positive end. */
  b: number;
  c: number;
  half: Vec3;
  sides: number;
  /** The outer ring, touching all four sides of the box. */
  ring: { b: number; c: number; nb: number; nc: number }[];
}

function section(shape: LegoShape): Section {
  const axisOption = shape.options?.axis;
  const axis =
    axisOption === 0 || axisOption === 1 || axisOption === 2
      ? axisOption
      : DEFAULT_CYLINDER_AXIS;
  const sidesOption = Math.round(shape.options?.sides ?? NaN);
  const sides = sidesOption >= 3 ? sidesOption : DEFAULT_CYLINDER_SIDES;
  const b = (axis + 1) % 3;
  const c = (axis + 2) % 3;
  const half = shape.size.map((s) => s / 2) as Vec3;

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
  return { axis, b, c, half, sides, ring };
}

/** Collects a solid's vertices and triangles in a section's axes. */
function builder(s: Section) {
  const solid: ShapeSolid = {
    positions: [],
    normals: [],
    indices: [],
    unwrapped: [],
  };
  const vector = (along: number, pb: number, pc: number): Vec3 => {
    const v: Vec3 = [0, 0, 0];
    v[s.axis] = along;
    v[s.b] = pb;
    v[s.c] = pc;
    return v;
  };
  const vertex = (
    along: number,
    pb: number,
    pc: number,
    n: Vec3,
    uv: [number, number],
  ) => {
    solid.positions.push(...vector(along, pb, pc));
    const length = Math.hypot(...n);
    solid.normals.push(n[0] / length, n[1] / length, n[2] / length);
    solid.unwrapped.push(...uv);
    return solid.positions.length / 3 - 1;
  };
  return { solid, vector, vertex };
}

type Builder = ReturnType<typeof builder>;

/**
 * A round wall the full length of the section, its ring scaled by `scale`.
 * Smooth all the way round. Unwrapped by the length round the ring and the
 * distance along the axis, so its facets are not stretched. The seam has a
 * vertex on each side, at the start of the ring and at its full length.
 * `inward` faces it in, for a tube's hole, and winds it to be seen from there.
 */
function wall(out: Builder, s: Section, scale: number, inward: boolean) {
  const h = s.half[s.axis];
  const facing = inward ? -1 : 1;
  const low: number[] = [];
  const high: number[] = [];
  let u = 0;
  for (let k = 0; k <= s.sides; k++) {
    const r = s.ring[k % s.sides];
    if (k > 0) {
      const before = s.ring[k - 1];
      u += Math.hypot(r.b - before.b, r.c - before.c) * scale;
    }
    const n = out.vector(0, r.nb * facing, r.nc * facing);
    low.push(out.vertex(-h, r.b * scale, r.c * scale, n, [u, 0]));
    high.push(out.vertex(h, r.b * scale, r.c * scale, n, [u, 2 * h]));
  }
  for (let k = 0; k < s.sides; k++) {
    if (inward) {
      out.solid.indices.push(
        low[k],
        high[k + 1],
        low[k + 1],
        low[k],
        high[k],
        high[k + 1],
      );
    } else {
      out.solid.indices.push(
        low[k],
        low[k + 1],
        high[k + 1],
        low[k],
        high[k + 1],
        high[k],
      );
    }
  }
}

/**
 * A flat end facing out along the axis at `end` (1 or -1): a full disc when
 * `hole` is 0, otherwise a ring round a hole that share of the ring's size.
 * Projected flat in its own plane, measured from the box's corner.
 */
function end(out: Builder, s: Section, side: 1 | -1, hole: number) {
  const along = side * s.half[s.axis];
  const normal = out.vector(side, 0, 0);
  const at = (pb: number, pc: number) =>
    out.vertex(along, pb, pc, normal, [pb + s.half[s.b], pc + s.half[s.c]]);
  const rim = s.ring.map((r) => at(r.b, r.c));
  const push = (a: number, b: number, c: number) => {
    if (side > 0) out.solid.indices.push(a, b, c);
    else out.solid.indices.push(a, c, b);
  };
  if (hole === 0) {
    const middle = at(0, 0);
    for (let k = 0; k < s.sides; k++) {
      push(middle, rim[k], rim[(k + 1) % s.sides]);
    }
    return;
  }
  const inner = s.ring.map((r) => at(r.b * hole, r.c * hole));
  for (let k = 0; k < s.sides; k++) {
    const next = (k + 1) % s.sides;
    push(rim[k], rim[next], inner[next]);
    push(rim[k], inner[next], inner[k]);
  }
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
  const s = section(shape);
  const out = builder(s);
  wall(out, s, 1, false);
  end(out, s, 1, 0);
  end(out, s, -1, 0);
  return out.solid;
}

/**
 * How big a tube's hole is, as a share of its outer ring. `inner` is the hole's
 * radius in elmos, measured against the smaller of the two radii across the
 * axis. Absent, or not between 0 and that radius, the hole is half of it.
 */
function tubeHole(shape: LegoShape): number {
  const s = section(shape);
  const outer = Math.min(s.half[s.b], s.half[s.c]);
  const inner = shape.options?.inner;
  return inner !== undefined && inner > 0 && inner < outer
    ? inner / outer
    : DEFAULT_TUBE_HOLE;
}

/**
 * The radius of a tube's hole as it is drawn, in elmos: its `inner`, or the
 * default when that cannot be used.
 */
export function tubeInnerRadius(shape: LegoShape): number {
  const s = section(shape);
  return tubeHole(shape) * Math.min(s.half[s.b], s.half[s.c]);
}

/**
 * A tube: a cylinder with a round hole along its axis. Options as a cylinder,
 * plus `inner`, the hole's radius (see `tubeHole`). The outer wall fills the
 * box as a cylinder's does. The inner wall faces in, and a flat ring closes
 * each end.
 */
function tube(shape: LegoShape): ShapeSolid {
  const s = section(shape);
  const hole = tubeHole(shape);
  const out = builder(s);
  wall(out, s, 1, false);
  wall(out, s, hole, true);
  end(out, s, 1, hole);
  end(out, s, -1, hole);
  return out.solid;
}

/**
 * A wedge's slope as it is drawn: `low`, the height of the low end from the
 * bottom (0 comes to an edge, the full height is a box), and whether the
 * slope is `flip`ped. A low end that is not between 0 and the height is 0.
 */
export function wedgeProfile(shape: LegoShape): {
  low: number;
  flip: boolean;
} {
  const low = shape.options?.low;
  return {
    low: low !== undefined && low >= 0 && low <= shape.size[1] ? low : 0,
    flip: (shape.options?.flip ?? 0) !== 0,
  };
}

/**
 * A wedge or a ramp filling its box: `size` is width (x), height at the high
 * end (y) and depth (z). The slope runs along z, high at the back (-z) and low
 * at the front (+z), the way a unit faces. Options: `low`, the height of the
 * low end (see `wedgeProfile`), and `flip`, 1 to put the high end at the front.
 *
 * Every face is flat with its own vertices and normal. A pure wedge has no
 * front face. Each face is unwrapped by a planar projection in its own plane,
 * from the box's minimum corner, so the slope is not squashed: along it, v is
 * the distance from the back or front edge, whichever has the smaller z.
 */
function wedge(shape: LegoShape): ShapeSolid {
  const [w, h, d] = shape.size;
  const { low, flip } = wedgeProfile(shape);
  const [x0, x1, y0, y1] = [-w / 2, w / 2, -h / 2, h / 2];
  const zHigh = flip ? d / 2 : -d / 2;
  const zLow = -zHigh;
  // Which way along z the surface runs down.
  const down = flip ? -1 : 1;
  const yLow = y0 + low;
  const rise = h - low;
  const stretch = Math.hypot(d, rise) / d;

  const solid: ShapeSolid = {
    positions: [],
    normals: [],
    indices: [],
    unwrapped: [],
  };
  // A convex polygon as a fan, wound to face along `normal`.
  const face = (
    points: Vec3[],
    normal: Vec3,
    unwrap: (p: Vec3) => [number, number],
  ) => {
    const [a, b, c] = points;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const wound =
      (ab[1] * ac[2] - ab[2] * ac[1]) * normal[0] +
      (ab[2] * ac[0] - ab[0] * ac[2]) * normal[1] +
      (ab[0] * ac[1] - ab[1] * ac[0]) * normal[2];
    const ordered = wound >= 0 ? points : [...points].reverse();
    const length = Math.hypot(...normal);
    const base = solid.positions.length / 3;
    for (const p of ordered) {
      solid.positions.push(...p);
      solid.normals.push(
        normal[0] / length,
        normal[1] / length,
        normal[2] / length,
      );
      solid.unwrapped.push(...unwrap(p));
    }
    for (let i = 1; i + 1 < ordered.length; i++) {
      solid.indices.push(base, base + i, base + i + 1);
    }
  };
  const acrossZ = (p: Vec3): [number, number] => [p[0] - x0, p[1] - y0];
  const alongZ = (p: Vec3): [number, number] => [p[2] + d / 2, p[1] - y0];

  face(
    [
      [x0, y0, -d / 2],
      [x1, y0, -d / 2],
      [x1, y0, d / 2],
      [x0, y0, d / 2],
    ],
    [0, -1, 0],
    (p) => [p[0] - x0, p[2] + d / 2],
  );
  face(
    [
      [x0, y0, zHigh],
      [x1, y0, zHigh],
      [x1, y1, zHigh],
      [x0, y1, zHigh],
    ],
    [0, 0, -down],
    acrossZ,
  );
  if (low > 0) {
    face(
      [
        [x0, y0, zLow],
        [x1, y0, zLow],
        [x1, yLow, zLow],
        [x0, yLow, zLow],
      ],
      [0, 0, down],
      acrossZ,
    );
  }
  face(
    [
      [x0, y1, zHigh],
      [x1, y1, zHigh],
      [x1, yLow, zLow],
      [x0, yLow, zLow],
    ],
    [0, d, rise * down],
    (p) => [p[0] - x0, (p[2] + d / 2) * stretch],
  );
  for (const x of [x0, x1]) {
    face(
      [
        [x, y0, zHigh],
        [x, y0, zLow],
        ...(low > 0 ? [[x, yLow, zLow] as Vec3] : []),
        [x, y1, zHigh],
      ],
      [x === x0 ? -1 : 1, 0, 0],
      alongZ,
    );
  }
  return solid;
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
