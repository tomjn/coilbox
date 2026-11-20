/**
 * The detail every open-town building gets on top of the parts its model
 * adds: plant on its free roofs, and close up a parapet round them, units and
 * vents beside the plant, and a band at each storey. It works from the parts
 * themselves, so a new model gets it with nothing added.
 *
 * Sizes are in elmos, as the Persepolis map draws them, 512 to a world unit.
 */
import * as THREE from "three";
import { seeded } from "../landmarks/kit";
import type { Tools } from "./openTown";
import { column, type Pt, rect, round } from "./parts";

/**
 * How much is added. A town on the conquest map is seen from far off, a lot
 * about ten pixels wide, so it takes only what changes a roof's outline. A
 * building seen close, as on a Recoil map, takes the rest.
 */
export type Detail = "town" | "close";

/** One part as the model added it, and the finish it was added in. */
export interface Placed {
  g: THREE.BufferGeometry;
  finish: keyof Tools;
}

const ELMO = 1 / 512;
/** A storey: the Persepolis map lays a floor inside each building this far apart. */
export const STOREY = 48 * ELMO;
const PARAPET_HEIGHT = 12 * ELMO;
const PARAPET_THICK = 4 * ELMO;
const BAND_PROUD = 2 * ELMO;
const BAND_HEIGHT = 4 * ELMO;
/** A roof narrower than this takes no plant. */
const PLANT_ROOF = 40 * ELMO;
/** A roof narrower than this takes no parapet: on a housing or a cap it reads as an open box. */
const PARAPET_ROOF = STOREY;
/** A face this much steeper than its neighbour below is a shoulder or a taper, not a wall. */
const FLUSH = 1.5 * ELMO;
/** How far above or below a level counts as on it. */
const EPS = 0.25 * ELMO;

/** The finishes a band or a parapet follows: the masses, not the metal or the green. */
const MASONRY = new Set<keyof Tools>(["wall", "alt", "ribs"]);

// --- plans -------------------------------------------------------------------

/** The convex hull of points on plan, x then z. */
function hull(points: Pt[]): Pt[] {
  // Two triangles meeting on the level give the same point twice, a hair apart.
  const seen = new Map<string, Pt>();
  for (const q of points)
    seen.set(
      `${Math.round(q[0] / (0.05 * ELMO))},${Math.round(q[1] / (0.05 * ELMO))}`,
      q,
    );
  const p = [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12
    )
      lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12
    )
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Where a part crosses the level `y`, as a convex plan, or null where it does not reach. */
function slice(g: THREE.BufferGeometry, y: number): Pt[] | null {
  const pos = g.getAttribute("position");
  const index = g.index;
  const count = index ? index.count : pos.count;
  const at = (k: number) => (index ? index.getX(k) : k);
  const pts: Pt[] = [];
  for (let t = 0; t < count; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = at(t + k);
      return [pos.getX(i), pos.getY(i), pos.getZ(i)];
    });
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      const f = (y - a[1]) / (b[1] - a[1]);
      pts.push([a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f]);
    }
  }
  const h = hull(pts);
  return h.length >= 3 ? h : null;
}

/** The signed area: positive for counter-clockwise in x, z. */
const area = (p: Pt[]) =>
  p.reduce(
    (s, a, i) =>
      s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1],
    0,
  ) / 2;

/** How far a point is inside a convex plan: negative outside. */
function inside(poly: Pt[], q: Pt): number {
  const s = Math.sign(area(poly)) || 1;
  let least = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    least = Math.min(
      least,
      (s * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]))) /
        len,
    );
  }
  return least;
}

/** A convex plan grown outward by `by`, or shrunk where `by` is negative. */
function offset(poly: Pt[], by: number): Pt[] {
  const s = Math.sign(area(poly)) || 1;
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // The outward normal of a counter-clockwise edge is its direction turned clockwise.
    const nx = (s * (b[1] - a[1])) / len;
    const nz = (-s * (b[0] - a[0])) / len;
    return {
      p: [a[0] + nx * by, a[1] + nz * by] as Pt,
      d: [b[0] - a[0], b[1] - a[1]] as Pt,
    };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n];
    const den = m.d[0] * l.d[1] - m.d[1] * l.d[0];
    if (Math.abs(den) < 1e-12) return l.p;
    const t = ((l.p[0] - m.p[0]) * l.d[1] - (l.p[1] - m.p[1]) * l.d[0]) / den;
    return [m.p[0] + m.d[0] * t, m.p[1] + m.d[1] * t];
  });
}

/**
 * A rim along a plan's edges, from `y0` to `y1`: a parapet on a roof or a
 * band round a wall. `from` is the plan the rim stands on and `to` the same
 * plan offset, out for a band or in for a parapet. Edge `i` runs from point
 * `i` to the next. It is cut into lengths of about `step`, or left whole when
 * `step` is 0, and `keep(i, f0, f1)` says whether the length from `f0` to
 * `f1` of the way along is drawn. Each unbroken run is one solid, closed at its two
 * ends only, so no two of its faces meet back to back, and it has a corner
 * only where the plan does or where it stops. `fromSide` draws the face over
 * `from` too, as a parapet's outer face is. `floor` closes the underside, as
 * a band's is.
 */
function rim(
  from: Pt[],
  to: Pt[],
  keep: (i: number, f0: number, f1: number) => boolean,
  step: number,
  y0: number,
  y1: number,
  fromSide: boolean,
  floor: boolean,
): THREE.BufferGeometry | null {
  const n = from.length;
  const lerp = (a: Pt, b: Pt, f: number): Pt => [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
  ];
  // The lengths in order round the plan, each with the point it starts at.
  const lengths: { from: Pt; to: Pt; kept: boolean; corner: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(to[j][0] - to[i][0], to[j][1] - to[i][1]);
    const count = step > 0 ? Math.max(1, Math.ceil(len / step)) : 1;
    for (let k = 0; k < count; k++)
      lengths.push({
        from: lerp(from[i], from[j], k / count),
        to: lerp(to[i], to[j], k / count),
        kept: keep(i, k / count, (k + 1) / count),
        corner: k === 0,
      });
  }
  const m = lengths.length;
  if (!lengths.some((l) => l.kept)) return null;
  // Each run as its points: a closed loop of the plan's corners when nothing
  // stops it, or from where it starts to where it stops.
  const runs: { from: Pt[]; to: Pt[]; closed: boolean }[] = [];
  if (lengths.every((l) => l.kept)) {
    const corners = lengths.filter((l) => l.corner);
    runs.push({
      from: corners.map((l) => l.from),
      to: corners.map((l) => l.to),
      closed: true,
    });
  } else
    for (let s = 0; s < m; s++) {
      if (!lengths[s].kept || lengths[(s + m - 1) % m].kept) continue;
      const run = {
        from: [lengths[s].from],
        to: [lengths[s].to],
        closed: false,
      };
      let e = (s + 1) % m;
      for (; lengths[e].kept; e = (e + 1) % m)
        if (lengths[e].corner) {
          run.from.push(lengths[e].from);
          run.to.push(lengths[e].to);
        }
      run.from.push(lengths[e].from);
      run.to.push(lengths[e].to);
      runs.push(run);
    }
  const pos: number[] = [];
  const v = (p: Pt, y: number) => new THREE.Vector3(p[0], y, p[1]);
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  /** Two triangles over a, b, c, d, turned to face `want`. */
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    want: THREE.Vector3,
  ) => {
    const facing = ab.subVectors(b, a).cross(ac.subVectors(c, a)).dot(want);
    const tri = facing >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const q of tri) pos.push(q.x, q.y, q.z);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  for (const run of runs) {
    const { from: f, to: o } = run;
    const k = f.length;
    const edges = run.closed ? k : k - 1;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % k;
      // The way from `from` across to `to`.
      const out = new THREE.Vector3(
        o[i][0] + o[j][0] - f[i][0] - f[j][0],
        0,
        o[i][1] + o[j][1] - f[i][1] - f[j][1],
      );
      quad(v(f[i], y1), v(f[j], y1), v(o[j], y1), v(o[i], y1), up);
      if (floor) quad(v(f[i], y0), v(f[j], y0), v(o[j], y0), v(o[i], y0), down);
      quad(v(o[i], y0), v(o[j], y0), v(o[j], y1), v(o[i], y1), out);
      if (fromSide)
        quad(v(f[i], y0), v(f[j], y0), v(f[j], y1), v(f[i], y1), out.negate());
    }
    if (run.closed) continue;
    // A run's two ends.
    const end = (i: number, j: number) =>
      quad(
        v(f[i], y0),
        v(o[i], y0),
        v(o[i], y1),
        v(f[i], y1),
        new THREE.Vector3(f[i][0] - f[j][0], 0, f[i][1] - f[j][1]),
      );
    end(0, 1);
    end(k - 1, k - 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// --- the pass ----------------------------------------------------------------

/** A piece of plant: its centre, width and depth on plan, and its foot and top. */
type Taken = [number, number, number, number, number, number];

interface Part {
  g: THREE.BufferGeometry;
  finish: keyof Tools;
  min: number;
  max: number;
}

const seedOf = (id: string) =>
  [...id].reduce(
    (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
    2166136261,
  );

/**
 * Add a building's detail through `t`, from the parts its model added. Nothing
 * rises past `height`, the model's own, which the town lays it out by.
 */
export function addDetail(
  t: Tools,
  placed: Placed[],
  id: string,
  height: number,
  detail: Detail,
): void {
  const parts: Part[] = placed.map(({ g, finish }) => {
    g.computeBoundingBox();
    const box = g.boundingBox as THREE.Box3;
    return { g, finish, min: box.min.y, max: box.max.y };
  });
  const rand = seeded(seedOf(id));
  /** Whether any part but `self` covers the point at level `y`. */
  const covered = (self: Part, q: Pt, y: number) =>
    parts.some((p) => {
      if (p === self || y < p.min - EPS || y > p.max + EPS) return false;
      const s = slice(p.g, y);
      return s !== null && inside(s, q) > -EPS;
    });

  // Plant already stood anywhere on the building: two parts can share a roof.
  const taken: Taken[] = [];
  for (const part of parts) {
    if (part.finish === "green") continue;
    const top = slice(part.g, part.max - EPS);
    if (!top || Math.abs(area(top)) < (PLANT_ROOF * PLANT_ROOF) / 4) continue;
    // A roof is what the sky sees: not where another part stands on it.
    // Each edge and each piece of plant checks for itself that nothing stands there.
    const headroom = height - part.max;
    if (
      detail === "close" &&
      MASONRY.has(part.finish) &&
      headroom >= PARAPET_HEIGHT
    )
      parapet(t, part, top, covered);
    plant(t, part, top, detail, headroom, rand, covered, taken);
  }
  if (detail === "close")
    for (const part of parts)
      if (part.finish === "wall" || part.finish === "alt")
        bands(t, part, parts);
}

/** A coping round a roof's edges, where the wall under them is straight. */
function parapet(
  t: Tools,
  part: Part,
  top: Pt[],
  covered: (self: Part, q: Pt, y: number) => boolean,
): void {
  const y = part.max;
  const span = (k: 0 | 1) =>
    Math.max(...top.map((p) => p[k])) - Math.min(...top.map((p) => p[k]));
  if (Math.min(span(0), span(1)) < PARAPET_ROOF) return;
  const below = slice(part.g, y - 6 * ELMO);
  if (!below) return;
  const inner = offset(top, -PARAPET_THICK);
  // A roof too narrow to hold a coping turns the inner edge inside out.
  if (area(inner) * area(top) <= 0) return;
  const n = top.length;
  const g = rim(
    top,
    inner,
    (i) => {
      const a = top[i];
      const b = top[(i + 1) % n];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // A shoulder or a taper: the wall below stands out beyond the roof's edge.
      if (inside(below, mid) > FLUSH) return false;
      // Another part runs on above the edge, or stands against it.
      const probe: Pt = [
        (inner[i][0] + inner[(i + 1) % n][0]) / 2,
        (inner[i][1] + inner[(i + 1) % n][1]) / 2,
      ];
      // A ledge round a wall that passes through it, as a cornice, has no
      // roof behind its edge to hold a parapet.
      const reach = PARAPET_ROOF / 2 / PARAPET_THICK;
      const deep: Pt = [
        mid[0] + (probe[0] - mid[0]) * reach,
        mid[1] + (probe[1] - mid[1]) * reach,
      ];
      return ![mid, probe, deep].some((q) => covered(part, q, y + EPS));
    },
    0,
    y,
    y + PARAPET_HEIGHT,
    true,
    false,
  );
  if (g) t.alt(g);
}

/**
 * Plant on a free roof: a plant room, and close up a row of units and a few
 * vents. Each is placed where nothing else stands and inside the parapet.
 */
function plant(
  t: Tools,
  part: Part,
  top: Pt[],
  detail: Detail,
  headroom: number,
  rand: () => number,
  covered: (self: Part, q: Pt, y: number) => boolean,
  taken: Taken[],
): void {
  const y = part.max;
  // Below the lowest of it, a plant room, there is no room for any.
  if (headroom < 24 * ELMO) return;
  const room = offset(top, -(PARAPET_THICK + 3 * ELMO));
  const xs = room.map((p) => p[0]);
  const zs = room.map((p) => p[1]);
  const [x0, x1, z0, z1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ];
  if (x1 - x0 < PLANT_ROOF || z1 - z0 < PLANT_ROOF) return;
  /** Try to stand a box `w` by `d` somewhere free on the roof, and return its centre. */
  const place = (
    w: number,
    d: number,
    tall: number,
    tries: number,
  ): Pt | null => {
    for (let k = 0; k < tries; k++) {
      const cx = x0 + w / 2 + rand() * Math.max(0, x1 - x0 - w);
      const cz = z0 + d / 2 + rand() * Math.max(0, z1 - z0 - d);
      const corners: Pt[] = [
        [cx - w / 2, cz - d / 2],
        [cx + w / 2, cz - d / 2],
        [cx + w / 2, cz + d / 2],
        [cx - w / 2, cz + d / 2],
        [cx, cz],
      ];
      // Clear air over the whole of it and a little above, not only at the
      // roof: a part may overhang, and its underside must not lie on the top.
      const levels = [y + EPS, y + tall / 2, y + tall + 2 * ELMO];
      if (
        corners.some(
          (q) => inside(room, q) < 0 || levels.some((l) => covered(part, q, l)),
        )
      )
        continue;
      const gap = 2 * ELMO;
      if (
        taken.some(
          ([ax, az, aw, ad, ay0, ay1]) =>
            Math.abs(ax - cx) < (aw + w) / 2 + gap &&
            Math.abs(az - cz) < (ad + d) / 2 + gap &&
            ay0 < y + tall + gap &&
            ay1 > y - gap,
        )
      )
        continue;
      taken.push([cx, cz, w, d, y, y + tall]);
      return [cx, cz];
    }
    return null;
  };
  const span = Math.min(x1 - x0, z1 - z0);
  // A plant room or a lift's overrun, a third to a half of the roof across.
  const rw = Math.max(24 * ELMO, span * (0.3 + 0.2 * rand()));
  const rd = Math.max(20 * ELMO, span * (0.25 + 0.15 * rand()));
  // Kept a little under the model's top, so its roof never lies level with it.
  const below = headroom - 2 * ELMO;
  const rh = Math.min(below, (22 + 10 * rand()) * ELMO);
  const at = place(rw, rd, rh, 12);
  if (at) t.alt(column(rect(rw, rd, at[0], at[1]), y, y + rh));
  if (detail !== "close") return;
  // Units in a row of two to four, on a shared dark plinth.
  const units = 2 + Math.floor(rand() * 3);
  const along = rand() < 0.5;
  const uw = 10 * ELMO;
  const ud = 16 * ELMO;
  const rowW = along ? units * (uw + 2 * ELMO) : ud + 4 * ELMO;
  const rowD = along ? ud + 4 * ELMO : units * (uw + 2 * ELMO);
  const row = place(rowW, rowD, 10 * ELMO, 12);
  if (row) {
    t.dark(column(rect(rowW, rowD, row[0], row[1]), y, y + 2 * ELMO));
    for (let i = 0; i < units; i++) {
      const o = (i - (units - 1) / 2) * (uw + 2 * ELMO);
      const [cx, cz] = along ? [row[0] + o, row[1]] : [row[0], row[1] + o];
      t.alt(
        column(
          along ? rect(uw, ud, cx, cz) : rect(ud, uw, cx, cz),
          y + 2 * ELMO,
          y + 10 * ELMO,
        ),
      );
    }
  }
  // Vents: short round stacks.
  const vents = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < vents; i++) {
    const vh = Math.min(below, (8 + 6 * rand()) * ELMO);
    const v = place(6 * ELMO, 6 * ELMO, vh, 6);
    if (v) t.dark(column(round(6 * ELMO, 6 * ELMO, 6, v[0], v[1]), y, y + vh));
  }
}

/** A slab edge standing proud of a wall at each storey, where the wall is plain. */
function bands(t: Tools, part: Part, parts: Part[]): void {
  const first = Math.ceil((part.min + STOREY / 2) / STOREY) * STOREY;
  for (let y = first; y < part.max - STOREY / 2; y += STOREY) {
    const at = slice(part.g, y);
    if (!at) continue;
    // Where the wall leans, as on a taper, the band would float off it.
    const lower = slice(part.g, y - BAND_HEIGHT);
    const upper = slice(part.g, y + BAND_HEIGHT);
    if (
      !lower ||
      !upper ||
      Math.abs(Math.abs(area(lower)) - Math.abs(area(upper))) >
        Math.abs(area(at)) * 0.02
    )
      continue;
    const ring = offset(at, BAND_PROUD);
    const others = parts
      .filter(
        (p) => p !== part && y > p.min - BAND_HEIGHT && y < p.max + BAND_HEIGHT,
      )
      .map((p) => slice(p.g, y))
      .filter((s): s is Pt[] => s !== null);
    const n = at.length;
    const g = rim(
      at,
      ring,
      (i, f0, f1) => {
        const j = (i + 1) % n;
        // Where another part stands against the wall, or covers it, the band
        // stops for that length. A length is shorter than any part is narrow,
        // a fin included, and both its ends and its middle must be clear, so
        // the band stops short of what it meets rather than touching it.
        return [f0, (f0 + f1) / 2, f1].every((f) => {
          const q: Pt = [
            ring[i][0] + (ring[j][0] - ring[i][0]) * f,
            ring[i][1] + (ring[j][1] - ring[i][1]) * f,
          ];
          return !others.some((s) => inside(s, q) > -BAND_PROUD);
        });
      },
      2 * ELMO,
      y - BAND_HEIGHT / 2,
      y + BAND_HEIGHT / 2,
      false,
      true,
    );
    if (g) t.alt(g);
  }
}
