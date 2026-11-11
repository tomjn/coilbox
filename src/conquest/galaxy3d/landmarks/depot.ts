/**
 * The depot that stands on a run's supply stop: a comms building, a yard of
 * crates and, most of the time, storage for something liquid or gas.
 *
 * Unlike the stronghold and the anomalies it is painted metal, in one of a
 * few liveries, and looks the same on every planet but for what has settled
 * on it. Depots are not one of a kind: a map has many, and the seed picks
 * each one's comms building, its storage, its livery and how its crates lie.
 *
 * Built with the road arriving along +x. The layer turns it.
 */
import * as THREE from "three";
import {
  at,
  Builder,
  type BuiltLandmark,
  block,
  box,
  faceOut,
  on,
  type Paint,
  type Rgb,
  seeded,
  shaft,
  TAU,
  tube,
} from "./kit";
import { DEPOT_LIVERIES, type DepotPalette } from "./palettes";

/** How far a depot reaches from its origin. A test holds every part inside it. */
export const DEPOT_REACH = 1.5;

/** The gap left between the comms building's slab and the ones beside it. */
const GAP = 0.12;
/** How far a slab's top stands above the ground it is cut into. */
const SLAB_LIFT = 0.03;
/** How far a slab's foot goes below the lowest ground under it. */
const SLAB_FOOT = 0.12;
/** How far a crate off the slabs sinks into the ground it lies on. */
const CRATE_SINK = 0.012;
/** The room a stray crate needs round its middle: half the longest one's diagonal, and a little. */
const STRAY_ROOM = 0.17;
const BEACON: Rgb = [255, 84, 54];

export const DEPOT_COMMS = ["dish", "mast", "radome"] as const;
export const DEPOT_STORES = ["sphere", "silos", "drums", "none"] as const;

export interface Depot {
  built: BuiltLandmark;
  comms: (typeof DEPOT_COMMS)[number];
  store: (typeof DEPOT_STORES)[number];
}

/** A bowl of radius `r` opening along +y, then tipped `tilt` towards +x, with its feed. */
function dish(r: number, tilt: number) {
  const depth = r * 0.3;
  const skin = r * 0.05;
  const steps = 8;
  const inner = Array.from({ length: steps + 1 }, (_, i) => {
    const x = (r * i) / steps;
    return new THREE.Vector2(x, depth * (x / r) ** 2);
  });
  const outer = inner
    .map((v) => new THREE.Vector2(v.x, v.y - skin))
    .reverse();
  const bowl = faceOut(new THREE.LatheGeometry([...inner, ...outer], 24));
  const boom = shaft(r * 0.025, r * 0.025, r * 0.8, 5);
  const feed = box(r * 0.14, r * 0.1, r * 0.14).translate(0, r * 0.8, 0);
  for (const g of [bowl, boom, feed]) g.rotateZ(-tilt);
  return { bowl, boom, feed };
}

/**
 * Build a depot round its origin. `ground` is the terrain's height under a
 * point, less the height at the origin.
 */
export function buildDepot(
  ground: (x: number, z: number) => number,
  p: DepotPalette,
  seed: number,
): Depot {
  const b = new Builder();
  const rand = seeded(seed);
  const pick = <T>(from: readonly T[]): T =>
    from[Math.floor(rand() * from.length)];
  const livery = pick(DEPOT_LIVERIES);
  const comms = pick(DEPOT_COMMS);
  const store = pick(DEPOT_STORES);
  const side = rand() < 0.5 ? 1 : -1;

  const settled = { top: p.top, topCover: p.topCover * 0.4 };
  /** Painted plate with seams, standing on the ground or a slab. */
  const panel: Paint = { kind: 11, ...settled };
  /** The same, on a part that stands on another. */
  const fitted: Paint = { kind: 11, clean: true, ...settled };
  /** Painted and curved: a tank, a dome, a dish. */
  const curved: Paint = { kind: 12, clean: true, ...settled };
  const bare: Paint = { kind: 13, clean: true };
  const cast: Paint = { kind: 8, top: p.top, topCover: p.topCover };

  /**
   * A level slab cut into the ground at x, z, turned `ry`. Gives back the
   * placement of its top.
   */
  const slab = (x: number, z: number, w: number, d: number, ry = 0) => {
    const m = at(x, 0, z, ry);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (const [u, v] of [
      [0, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const c = new THREE.Vector3((u * w) / 2, 0, (v * d) / 2).applyMatrix4(m);
      const g = ground(c.x, c.z);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      sum += g / 5;
    }
    // Cut halfway into the slope, so the downhill side does not stand tall.
    const top = (sum + hi) / 2 + SLAB_LIFT;
    const h = top - lo + SLAB_FOOT;
    b.add(box(w, h, d), p.pad, at(x, top - h, z, ry), cast);
    b.add(
      box(w - 0.06, 0.012, d - 0.06),
      p.metal,
      at(x, top - 0.004, z, ry),
      bare,
    );
    return at(x, top + 0.008, z, ry);
  };

  // The comms building, a little back from the road.
  const COMMS_SLAB: Record<Depot["comms"], [number, number]> = {
    dish: [0.74, 0.6],
    mast: [0.8, 0.8],
    radome: [1.3, 0.96],
  };
  const [cw, cd] = COMMS_SLAB[comms];
  const C = slab(-0.1, 0, cw, cd);
  const tower = (
    g: THREE.BufferGeometry,
    c: Rgb,
    m: THREE.Matrix4,
    paint: Paint,
  ) => b.add(g, c, m, paint, "tower");
  const beacon = (m: THREE.Matrix4) =>
    b.glow(box(0.014, 0.014, 0.014), BEACON, m, 1.2);
  const aim = rand() * TAU;

  if (comms === "dish") {
    // A dish on a pylon, standing on a plant block.
    tower(box(0.52, 0.16, 0.38, 0.02), livery.accent, C, panel);
    tower(box(0.44, 0.05, 0.3, 0.01), livery.shell, on(C, 0, 0.16, 0), fitted);
    tower(block(0.2, 0.56, 0.2, 0.68), livery.shell, on(C, 0, 0.21, 0), fitted);
    tower(box(0.17, 0.05, 0.17), livery.accent, on(C, 0, 0.47, 0), fitted);
    const H = on(C, 0, 0.77, 0, aim);
    tower(box(0.17, 0.12, 0.21, 0.02), livery.accent, H, fitted);
    tower(new THREE.SphereGeometry(0.05, 12, 8), p.metal, on(H, 0, 0.15, 0), bare);
    const d = dish(0.36, 0.85);
    const D = on(H, 0.02, 0.17, 0);
    tower(d.bowl, livery.shell, D, curved);
    tower(d.boom, p.metal, D, bare);
    tower(d.feed, livery.accent, D, fitted);
  } else if (comms === "mast") {
    // A tall mast over two plant cabinets, on four splayed legs.
    for (let k = 0; k < 4; k++) {
      const L = on(C, 0, 0, 0, Math.PI / 4 + (k * Math.PI) / 2);
      tower(tube(0.03, 0.4, 6, -0.6), p.metal, on(L, 0.03, 0.225, 0), bare);
      tower(box(0.1, 0.03, 0.1, 0.008), livery.accent, on(L, 0.35, 0, 0), panel);
    }
    tower(box(0.15, 0.52, 0.15), p.metal, C, bare);
    for (const s of [-1, 1]) {
      const K = on(C, s * 0.145, 0.07, 0);
      tower(box(0.14, 0.3, 0.22, 0.02), livery.shell, K, fitted);
      tower(box(0.15, 0.03, 0.23, 0.008), livery.accent, on(K, 0, 0.3, 0), fitted);
    }
    const P = on(C, 0, 0.52, 0);
    tower(box(0.11, 0.5, 0.07, 0.015), livery.shell, P, fitted);
    for (const s of [-1, 1])
      tower(box(0.02, 0.44, 0.1, 0.006), livery.accent, on(P, s * 0.065, 0.03, 0), fitted);
    const M = on(P, 0, 0.5, 0);
    tower(shaft(0.015, 0.008, 0.78, 6), p.metal, M, bare);
    for (const y of [0.16, 0.42])
      tower(shaft(0.018, 0.017, 0.09, 6), livery.shell, on(M, 0, y, 0), curved);
    for (let k = 0; k < 3; k++) {
      const A = on(M, 0, 0.5, 0, aim + (k * TAU) / 3);
      tower(box(0.07, 0.008, 0.008), p.metal, on(A, 0.035, 0.07, 0), bare);
      tower(box(0.025, 0.15, 0.06, 0.006), livery.accent, on(A, 0.075, 0, 0), fitted);
    }
    beacon(on(M, 0, 0.785, 0));
  } else {
    // A radar dome on a ring, with a plant block beside it.
    const R = 0.38;
    const B = on(C, -0.14, 0, 0);
    tower(shaft(0.43, 0.43, 0.1, 28), p.metal, B, bare);
    const O = on(B, 0, 0.22, 0);
    tower(
      new THREE.SphereGeometry(R, 28, 14, 0, TAU, 0, Math.PI * 0.62),
      livery.shell,
      O,
      curved,
    );
    tower(
      new THREE.TorusGeometry(R + 0.004, 0.016, 6, 36).rotateX(Math.PI / 2),
      livery.accent,
      O,
      curved,
    );
    for (let k = 0; k < 4; k++)
      tower(
        new THREE.TorusGeometry(R + 0.002, 0.007, 4, 24, Math.PI),
        p.metal,
        on(O, 0, 0, 0, aim + (k * Math.PI) / 4),
        bare,
      );
    tower(shaft(0.07, 0.055, 0.035, 12), p.metal, on(O, 0, R - 0.005, 0), bare);
    tower(shaft(0.006, 0.004, 0.26, 5), p.metal, on(O, 0, R + 0.03, 0), bare);
    beacon(on(O, 0, R + 0.295, 0));
    const X = on(C, 0.46, 0, 0.1 * side);
    tower(box(0.26, 0.17, 0.3, 0.02), livery.shell, X, panel);
    tower(box(0.27, 0.035, 0.31, 0.008), livery.accent, on(X, 0, 0.1, 0), fitted);
    const d = dish(0.11, 0.7);
    const D = on(X, 0, 0.2, 0.06, aim);
    tower(shaft(0.014, 0.014, 0.04, 6), p.metal, on(X, 0, 0.17, 0.06), bare);
    tower(d.bowl, livery.shell, D, curved);
    tower(d.boom, p.metal, D, bare);
  }

  // Storage on one side of the comms building.
  const beside = cd / 2 + GAP;
  if (store !== "none") {
    const S = slab(
      -0.1 + (rand() - 0.5) * 0.3,
      side * (beside + 0.31),
      0.84,
      0.62,
      (rand() - 0.5) * 0.3,
    );
    if (store === "sphere") {
      // A ball of gas held up on legs inside a ring.
      const r = 0.27;
      const O = on(S, 0, 0.14 + r, 0);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        b.add(
          block(0.05, 0.3, 0.05, 0.7),
          livery.accent,
          on(S, 0.25 * Math.cos(a), 0, 0.25 * Math.sin(a), -a),
          panel,
        );
      }
      b.add(shaft(0.045, 0.045, 0.16, 8), p.metal, S, bare);
      b.add(new THREE.SphereGeometry(r, 28, 18), livery.shell, O, curved);
      b.add(
        new THREE.TorusGeometry(r + 0.012, 0.022, 6, 32).rotateX(Math.PI / 2),
        livery.accent,
        on(O, 0, -0.1, 0),
        curved,
      );
      b.add(
        new THREE.TorusGeometry(r + 0.002, 0.008, 4, 32).rotateX(Math.PI / 2),
        p.metal,
        on(O, 0, 0.08, 0),
        bare,
      );
      b.add(shaft(0.09, 0.07, 0.03, 14), p.metal, on(O, 0, r - 0.008, 0), bare);
      b.add(box(0.2, 0.14, 0.14, 0.015), livery.shell, on(S, 0.28, 0, 0.2), panel);
    } else if (store === "silos") {
      // Two upright tanks piped together over the top, in a frame.
      const r = 0.14;
      for (const s of [-1, 1]) {
        const T = on(S, s * 0.17, 0, 0);
        b.add(shaft(0.13, 0.11, 0.1, 14), p.metal, T, bare);
        b.add(shaft(r, r, 0.46, 22), livery.shell, on(T, 0, 0.1, 0), curved);
        b.add(
          new THREE.SphereGeometry(r, 22, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.7, 1),
          livery.shell,
          on(T, 0, 0.56, 0),
          curved,
        );
        for (const y of [0.2, 0.44])
          b.add(shaft(r + 0.004, r + 0.004, 0.035, 22), livery.accent, on(T, 0, y, 0), curved);
        b.add(shaft(0.02, 0.02, 0.07, 6), p.metal, on(T, 0, 0.65, 0), bare);
      }
      b.add(
        new THREE.TorusGeometry(0.17, 0.02, 6, 16, Math.PI),
        p.metal,
        on(S, 0, 0.71, 0),
        bare,
      );
      b.add(box(0.1, 0.5, 0.1), p.metal, on(S, 0, 0, 0.1), bare);
      b.add(box(0.3, 0.36, 0.1, 0.015), livery.shell, on(S, 0, 0, 0.2), panel);
      b.add(box(0.31, 0.03, 0.11, 0.008), livery.accent, on(S, 0, 0.2, 0.2), fitted);
    } else {
      // Tanks lying side by side on saddles.
      const r = 0.105;
      const len = 0.52;
      for (const s of [-1, 1]) {
        const T = on(S, -len / 2, 0.05 + r, s * 0.14);
        b.add(tube(r, len, 20), livery.shell, T, curved);
        for (const x of [0, len])
          b.add(
            new THREE.SphereGeometry(r, 16, 10).scale(0.55, 1, 1),
            livery.shell,
            on(T, x, 0, 0),
            curved,
          );
        for (const x of [0.1, len - 0.1 - 0.04])
          b.add(tube(r + 0.004, 0.04, 20), livery.accent, on(T, x, 0, 0), curved);
        b.add(shaft(0.03, 0.03, 0.03, 8), p.metal, on(T, len / 2, r - 0.005, 0), bare);
      }
      for (const x of [-0.16, 0.16])
        b.add(box(0.06, 0.1, 0.52, 0.008), livery.accent, on(S, x, 0, 0), panel);
      b.add(tube(0.016, 0.28, 6), p.metal, on(S, 0, 0.3, -0.14, -Math.PI / 2), bare);
    }
  }

  // Crates. Each is built with its long side along +x.
  const CRATE = {
    // A long container with capped ends.
    long: { h: 0.12, half: 0.14 },
    // A cube with a plate on each side.
    cube: { h: 0.16, half: 0.09 },
    // A six-sided canister lying on a flat.
    drum: { h: 0.13, half: 0.13 },
  };
  type Crate = keyof typeof CRATE;
  const CRATES = Object.keys(CRATE) as Crate[];
  const crate = (kind: Crate, m: THREE.Matrix4, paint: Paint) => {
    if (kind === "long") {
      b.add(box(0.26, 0.12, 0.14, 0.012), livery.shell, m, paint);
      for (const s of [-1, 1])
        b.add(box(0.05, 0.128, 0.148, 0.012), livery.accent, on(m, s * 0.115, 0, 0), paint);
      b.add(box(0.07, 0.012, 0.08), p.metal, on(m, 0, 0.12, 0), bare);
    } else if (kind === "cube") {
      b.add(box(0.16, 0.16, 0.16, 0.028), livery.shell, m, paint);
      b.add(box(0.168, 0.09, 0.09, 0.006), livery.accent, on(m, 0, 0.035, 0), fitted);
      b.add(box(0.09, 0.09, 0.168, 0.006), livery.accent, on(m, 0, 0.035, 0), fitted);
      b.add(box(0.1, 0.012, 0.1), p.metal, on(m, 0, 0.16, 0), bare);
    } else {
      const r = 0.075;
      const T = on(m, -0.12, r * Math.cos(Math.PI / 6), 0);
      b.add(tube(r, 0.24, 6).rotateX(Math.PI / 6), livery.accent, T, { ...paint, clean: true });
      for (const x of [0.02, 0.19])
        b.add(tube(r + 0.006, 0.03, 6).rotateX(Math.PI / 6), livery.shell, on(T, x, 0, 0), fitted);
    }
  };

  // A yard of them in rows on the other side, some stacked.
  const yardTurn = (rand() - 0.5) * 0.3;
  const Y = slab(
    0.05 + (rand() - 0.5) * 0.3,
    -side * (beside + 0.3),
    0.98,
    0.6,
    yardTurn,
  );
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      if (rand() > 0.8) continue;
      const kind = pick(CRATES);
      const turn =
        (kind === "long" && rand() < 0.3 ? Math.PI / 2 : 0) +
        (rand() - 0.5) * 0.24;
      const m = on(
        Y,
        (i - 1) * 0.31 + (rand() - 0.5) * 0.03,
        0,
        (j - 0.5) * 0.28 + (rand() - 0.5) * 0.03,
        turn,
      );
      crate(kind, m, panel);
      if (kind !== "drum" && rand() < 0.35)
        crate(kind, on(m, 0, CRATE[kind].h, 0, (rand() - 0.5) * 0.3), fitted);
    }

  // And a few left lying on the ground past the yard and by the road.
  const strays: [number, number][] = [
    [-0.35 + rand() * 0.7, -side * (beside + 0.6 + 0.16 + rand() * 0.1)],
    [0.62 + rand() * 0.12, -side * (0.1 + rand() * 0.25)],
  ];
  if (store === "none")
    for (let k = 0; k < 3; k++)
      strays.push([
        -0.4 + k * 0.33 + rand() * 0.08,
        side * (beside + 0.14 + rand() * 0.3),
      ]);
  for (const [sx, sz] of strays) {
    if (rand() > 0.85) continue;
    // Pull one that would lie past the reach back inside it.
    const pull = Math.min(1, (DEPOT_REACH - STRAY_ROOM) / Math.hypot(sx, sz));
    const x = sx * pull;
    const z = sz * pull;
    crate(
      pick(CRATES),
      at(x, ground(x, z) - CRATE_SINK, z, rand() * TAU),
      panel,
    );
  }

  return { built: b.build(), comms, store };
}
