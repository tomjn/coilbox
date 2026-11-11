/**
 * The stronghold that stands on an enemy capital: one long battered block set
 * into a crag, with a command tower, containment spheres, decks standing off
 * on piers and a long wall running down into the ground.
 *
 * It is a megastructure seen from orbit, so nothing on it is small enough to
 * read as a window, a door or a vehicle. Built facing +x, with the long wall
 * running off along -x. The layer turns it to its road.
 */
import * as THREE from "three";
import {
  at,
  Builder,
  type BuiltLandmark,
  block,
  box,
  noise3,
  on,
  type Paint,
  type Rgb,
  seeded,
  shaft,
  smooth,
  sweep,
  TAU,
  tube,
} from "./kit";
import type { StrongholdPalette } from "./palettes";
import { insideShield } from "./shield";

/**
 * How far the stronghold reaches from its origin. The end block of the long
 * wall is the furthest part, at 3.783 when measured.
 */
export const STRONGHOLD_REACH = 3.79;
/** How far the crag's sheet reaches. */
const CRAG_REACH = 3.6;
/** Where the crag's sheet starts to fade into the ground. */
const FADE_FROM = 2.6;
const FADE_OVER = 0.9;
/** How far the crag's outermost row sinks below the ground. */
const EDGE_SINK = 0.03;
/** The crag's height under the block. */
const LIFT = 0.8;

/**
 * The dome as it was approved, in the stronghold's units: a sphere of 2.6
 * stretched 1.3 high, then 1.5, 1.9 and 1.38 along x, y and z, lifted 0.4.
 */
const SHIELD_RADII = new THREE.Vector3(2.6 * 1.5, 2.6 * 1.3 * 1.9, 2.6 * 1.38);
const SHIELD_CENTRE = new THREE.Vector3(0, 0.4, 0);
/** How much the dome grows each time a part pokes through it. */
const SHIELD_GROWTH = 1.05;

export interface Stronghold {
  built: BuiltLandmark;
  shield: { radii: THREE.Vector3; centre: THREE.Vector3 };
}

/**
 * Build the stronghold round its origin. `ground` is the terrain's height
 * under a point, less the height at the origin. `edgeColour` is the ground's
 * own colour at a point, which the crag takes on at its edge so it fades into
 * the terrain.
 */
export function buildStronghold(
  ground: (x: number, z: number) => number,
  p: StrongholdPalette,
  seed: number,
  edgeColour?: (x: number, z: number) => Rgb | undefined,
): Stronghold {
  const b = new Builder();
  const rand = seeded(seed);
  const wall: Paint = { kind: 8 };
  const plate: Paint = { kind: 8, clean: true };
  const dark: Paint = { kind: 7, clean: true };
  const F = at(0, LIFT, 0);
  const P = (x: number, y: number, z: number, ry = 0) => on(F, x, y, z, ry);

  // The crag: rock heaped on the terrain, so there is no edge where the two meet.
  const ridged = (x: number, z: number, f: number, o: number) => {
    const r = 1 - Math.abs(noise3(x * f + o, o, z * f) - 0.5) * 2;
    return r * r;
  };
  /** 1 on the crag, falling to 0 where it meets the ground. */
  const fallAt = (x: number, z: number) => {
    // Spurs: the foot of the crag reaches further out along some bearings.
    const a = Math.atan2(z, x);
    const spur =
      0.78 + 0.5 * ridged(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 1, 7);
    const d = Math.hypot(x / 1.85, z / 1.05);
    const w = 1 - Math.min(1, Math.max(0, (d - 0.7) / (1.15 * spur)));
    return w * w * (3 - 2 * w);
  };
  const crag = (x: number, z: number) => {
    const fall = fallAt(x, z);
    const slope = Math.min(1, fall * (1 - fall) * 5);
    const rock =
      0.5 * ridged(x, z, 1.5, 4) +
      0.24 * ridged(x, z, 3.4, 11) +
      0.1 * ridged(x, z, 7.5, 23) -
      0.3;
    return LIFT * fall + slope * rock;
  };
  const gy = (x: number, z: number) => ground(x, z) + crag(x, z);
  const ROWS = 64;
  const SEGS = 220;
  b.add(
    sweep(ROWS, SEGS, (i, s) => {
      const a = (s / SEGS) * TAU;
      const r = (i / (ROWS - 1)) * CRAG_REACH;
      const x = r * Math.cos(a);
      const z = r * Math.sin(a);
      const sink = EDGE_SINK * smooth(0.85, 1, i / (ROWS - 1));
      return [x, gy(x, z) - 0.01 - sink, z];
    }),
    p.rock,
    new THREE.Matrix4(),
    {
      kind: 2,
      top: p.top,
      topCover: p.topCover * 0.3,
      clean: true,
      // A broken edge, so the fade does not trace a clean circle.
      fade: (x, _y, z) => {
        const r = Math.hypot(x, z) + (noise3(x * 2.1, 5, z * 2.1) - 0.5) * 0.5;
        return 1 - Math.min(1, Math.max(0, (r - FADE_FROM) / FADE_OVER));
      },
      blend: edgeColour,
      blendWeight: (x, z) => 1 - fallAt(x, z),
    },
    "crag",
  );

  const world = (m: THREE.Matrix4) =>
    new THREE.Vector3().setFromMatrixPosition(m);
  /** A pier from the ground up to a height. */
  const pier = (x: number, z: number, topY: number, w = 0.12) => {
    const v = world(P(x, 0, z));
    const y = gy(v.x, v.z) - 0.25 - LIFT;
    b.add(
      block(w * 1.5, topY - y, w * 1.3, 0.62),
      p.concrete,
      P(x, y, z),
      wall,
    );
    b.add(box(w * 1.9, 0.04, w * 1.6), p.trim, P(x, topY - 0.07, z), dark);
  };
  /** Small plant scattered on a deck. */
  const clutter = (
    n: number,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const m = P(
        x0 + rand() * (x1 - x0),
        y,
        z0 + rand() * (z1 - z0),
        rand() > 0.5 ? 0 : Math.PI / 2,
      );
      if (rand() > 0.25)
        b.add(
          box(
            0.05 + rand() * 0.14,
            0.02 + rand() * 0.07,
            0.04 + rand() * 0.07,
            0.005,
          ),
          rand() > 0.5 ? p.concrete : p.armour,
          m,
          plate,
        );
      else
        b.add(
          tube(0.012, 0.12 + rand() * 0.2, 6),
          p.trim,
          on(m, 0, 0.02, 0),
          dark,
        );
    }
  };
  /** A mast. One on the tower is tagged with it, for the shield. */
  const mast = (m: THREE.Matrix4, h: number, tag: "mast" | "body" = "body") => {
    b.add(shaft(0.012, 0.004, h, 5), p.trim, m, dark, tag);
    b.add(box(0.05, 0.008, 0.008), p.trim, on(m, 0, h * 0.7, 0), dark, tag);
  };
  const dish = (m: THREE.Matrix4, tag: "mast" | "body" = "body") => {
    b.add(shaft(0.012, 0.012, 0.05, 6), p.trim, m, dark, tag);
    b.add(
      new THREE.SphereGeometry(0.038, 12, 8),
      p.concrete,
      on(m, 0, 0.075, 0),
      dark,
      tag,
    );
  };
  /** A plasma battery, barrels along the matrix's +x. */
  const battery = (m: THREE.Matrix4) => {
    b.add(shaft(0.15, 0.13, 0.06, 12), p.armour, m, plate);
    b.add(box(0.2, 0.09, 0.19, 0.03), p.concrete, on(m, 0, 0.06, 0), plate);
    for (const z of [-0.045, 0.045]) {
      b.add(tube(0.022, 0.18, 8, 0.3), p.armour, on(m, 0.05, 0.11, z), plate);
      b.add(tube(0.012, 0.44, 8, 0.3), p.trim, on(m, 0.05, 0.11, z), dark);
    }
  };

  // The main block, its foot deep in the rock.
  const ROOF = 1.05;
  b.add(block(3.1, ROOF + 0.2, 1.06, 0.76), p.concrete, P(0, -0.2, 0), wall);
  b.add(box(2.38, 0.03, 0.83), p.trim, P(0, ROOF - 0.02, 0), dark);
  for (let i = 0; i < 11; i++) {
    const x = -1.2 + i * 0.24;
    for (const side of [-1, 1])
      b.add(
        block(0.09, ROOF + 0.1, 0.3, 0.25),
        p.armour,
        P(x, -0.15, side * 0.46),
        plate,
      );
  }
  for (const side of [-1, 1])
    b.add(block(0.5, ROOF, 0.9, 0.6), p.armour, P(side * 1.42, -0.2, 0), plate);
  clutter(26, 0.3, 1.1, -0.34, 0.34, ROOF);

  // The upper tier and the command tower on it.
  b.add(block(1.3, 0.3, 0.64, 0.86), p.concrete, P(-0.45, ROOF, 0), wall);
  b.add(box(1.14, 0.025, 0.57), p.trim, P(-0.45, ROOF + 0.29, 0), dark);
  const T = P(-0.6, ROOF + 0.3, 0);
  const tower = (
    g: THREE.BufferGeometry,
    c: Rgb,
    m: THREE.Matrix4,
    paint: Paint,
  ) => b.add(g, c, m, paint, "tower");
  tower(block(0.62, 0.4, 0.5, 0.8), p.armour, T, plate);
  tower(block(0.46, 1.25, 0.38, 0.86), p.concrete, on(T, 0, 0.3, 0), wall);
  for (const side of [-1, 1])
    tower(
      block(0.1, 1.2, 0.16, 0.5),
      p.armour,
      on(T, side * 0.22, 0.3, 0),
      plate,
    );
  for (const y of [0.75, 1.15])
    tower(box(0.44, 0.022, 0.37), p.trim, on(T, 0, y, 0), dark);
  // The head: wider than the neck that carries it.
  tower(block(0.4, 0.3, 0.33, 2.9), p.armour, on(T, 0, 1.52, 0), plate);
  tower(box(1.3, 0.09, 1.02, 0.02), p.concrete, on(T, 0, 1.82, 0), wall);
  tower(box(1.33, 0.02, 1.05), p.trim, on(T, 0, 1.86, 0), dark);
  tower(block(0.86, 0.1, 0.66, 0.8), p.armour, on(T, -0.05, 1.91, 0), plate);
  tower(box(0.36, 0.07, 0.28, 0.01), p.concrete, on(T, -0.1, 2.01, 0), plate);
  mast(on(T, 0.12, 2.07, 0.1), 0.55, "mast");
  mast(on(T, -0.2, 2.14, -0.06), 0.34, "mast");
  mast(on(T, 0.52, 1.91, -0.4), 0.3, "mast");
  dish(on(T, -0.52, 1.91, 0.4), "mast");
  b.glow(box(0.012, 0.012, 0.012), [255, 84, 54], on(T, 0.12, 2.62, 0.1), 1.2);
  // Lit points on the head's underside edge, a handful.
  for (let i = 0; i < 7; i++)
    b.glow(
      box(0.009, 0.009, 0.009),
      p.lamp,
      on(T, -0.57 + i * 0.19, 1.81, 0.515),
      1.0,
    );

  // The reactor: three spheres in a cradle on the block's shoulder.
  const R = P(0.72, ROOF, 0);
  b.add(block(1.0, 0.09, 0.56, 0.9), p.armour, R, plate);
  for (const x of [-0.33, 0, 0.33]) {
    const s = on(R, x, 0.09, 0);
    b.add(shaft(0.13, 0.11, 0.06, 16), p.trim, s, dark);
    b.add(
      new THREE.SphereGeometry(0.165, 28, 18),
      p.concrete,
      on(s, 0, 0.19, 0),
      plate,
    );
    b.add(
      new THREE.TorusGeometry(0.168, 0.011, 5, 28).rotateX(Math.PI / 2),
      p.trim,
      on(s, 0, 0.19, 0),
      dark,
    );
    b.add(
      new THREE.TorusGeometry(0.168, 0.009, 5, 28).rotateY(Math.PI / 2),
      p.trim,
      on(s, 0, 0.19, 0),
      dark,
    );
    b.glow(shaft(0.115, 0.115, 0.01, 16), p.lamp, on(s, 0, 0.06, 0), 0.8);
  }
  b.add(box(1.06, 0.028, 0.03), p.trim, on(R, 0, 0.47, 0), dark);
  for (const x of [-0.52, -0.165, 0.165, 0.52]) {
    for (const z of [-0.2, 0.2])
      b.add(box(0.022, 0.4, 0.022), p.trim, on(R, x, 0.09, z), dark);
    b.add(box(0.022, 0.022, 0.42), p.trim, on(R, x, 0.47, 0), dark);
  }

  // The great deck, standing off the long face on piers.
  const D = 0.9;
  b.add(box(1.0, 0.06, 0.6), p.trim, P(-0.15, D - 0.06, 0.95), dark);
  b.add(box(1.55, 0.1, 1.0, 0.012), p.concrete, P(-0.1, D, 1.0), wall);
  b.add(box(1.57, 0.02, 1.02), p.trim, P(-0.1, D + 0.035, 1.0), dark);
  b.add(box(1.0, 0.07, 0.62, 0.01), p.armour, P(0.22, D + 0.1, 1.12), plate);
  b.add(box(0.5, 0.06, 0.4, 0.01), p.concrete, P(0.36, D + 0.17, 1.2), plate);
  for (const [x, z] of [
    [-0.72, 1.36],
    [0.5, 1.38],
    [-0.1, 0.92],
    [0.56, 0.84],
  ])
    pier(x, z, D);
  clutter(16, -0.8, -0.3, 0.6, 1.4, D + 0.1);
  mast(P(0.5, D + 0.23, 1.3), 0.5);
  mast(P(0.2, D + 0.17, 0.95), 0.32);
  dish(P(0.05, D + 0.17, 1.3));
  dish(P(-0.6, D + 0.1, 0.7));
  battery(P(-0.55, D + 0.1, 1.2, -Math.PI / 2 + 0.3));

  // A lesser deck off the end, reached by a bridge.
  const E = 0.62;
  b.add(box(0.75, 0.035, 0.12), p.concrete, P(1.62, E, 0.05), plate);
  b.add(box(0.74, 0.08, 0.56, 0.01), p.concrete, P(2.25, E - 0.02, 0.1), wall);
  b.add(box(0.76, 0.02, 0.58), p.trim, P(2.25, E + 0.01, 0.1), dark);
  b.add(box(0.4, 0.06, 0.34, 0.01), p.armour, P(2.33, E + 0.06, 0.12), plate);
  pier(2.05, -0.08, E - 0.02, 0.1);
  pier(2.45, 0.28, E - 0.02, 0.1);
  battery(P(2.28, E + 0.12, 0.12));
  mast(P(2.5, E + 0.06, -0.1), 0.3);

  // The long wall: runs off the end of the block and down into the terrain.
  const N = 40;
  const line = (t: number): [number, number] => [
    -1.5 - t * 2.0,
    0.5 * t * t + 0.12 * Math.sin(t * 5),
  ];
  const [endX, endZ] = line(1);
  const endTop = gy(endX, endZ) + 0.1;
  const wallTop = (t: number, g0: number) =>
    Math.max(g0 + 0.1, LIFT + 0.78 + (endTop - LIFT - 0.78) * t);
  b.add(
    sweep(N + 1, 4, (i, s) => {
      const t = i / N;
      const [x, z] = line(t);
      const [x1, z1] = line(t + 0.01);
      const len = Math.hypot(x1 - x, z1 - z);
      const nx = -(z1 - z) / len;
      const nz = (x1 - x) / len;
      const top = s < 2;
      // The wall heads towards -x, so its left hand is +z: order the section to face outward.
      const side = (s === 0 || s === 3 ? 1 : -1) * (top ? 0.055 : 0.12);
      const vx = x + nx * side;
      const vz = z + nz * side;
      const y = top ? wallTop(t, gy(x, z)) : gy(vx, vz) - 0.3;
      return [vx, y, vz];
    }),
    p.concrete,
    new THREE.Matrix4(),
    wall,
  );
  for (let i = 1; i < 12; i++) {
    const t = i / 12.5;
    const [x, z] = line(t);
    const g0 = gy(x, z);
    const h = wallTop(t, g0) - g0 + 0.2;
    if (h > 0.25)
      b.add(
        block(0.09, h, 0.42, 0.3),
        p.armour,
        P(x, g0 - 0.25 - LIFT, z, -0.25 * t),
        plate,
      );
  }
  b.add(
    block(0.4, 0.3, 0.34, 0.75),
    p.armour,
    P(endX, endTop - 0.3 - LIFT, endZ, -0.5),
    plate,
  );

  const built = b.build();
  return { built, shield: fitShield(built) };
}

/** The approved dome, grown until it covers the tower and its masts. */
function fitShield(built: BuiltLandmark) {
  const radii = SHIELD_RADII.clone();
  const centre = SHIELD_CENTRE.clone();
  const parts = [built.vertices("tower"), built.vertices("mast")];
  const point = new THREE.Vector3();
  const covered = () =>
    parts.every((v) => {
      for (let i = 0; i < v.length; i += 3) {
        point.set(v[i], v[i + 1], v[i + 2]);
        if (!insideShield(radii, centre, point)) return false;
      }
      return true;
    });
  while (!covered()) radii.multiplyScalar(SHIELD_GROWTH);
  return { radii, centre };
}
