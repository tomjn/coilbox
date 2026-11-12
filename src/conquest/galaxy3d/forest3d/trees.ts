/**
 * The shape of each kind of tree, near and far. Every shape is one tree high
 * and one crown wide, standing on y = 0 round its own origin, and the forest
 * layer scales it to each tree. `foliage` is 1 on the crown and 0 on the
 * trunk, and `up` runs from 0 at the crown's underside to 1 at its top, for
 * the shade a crown holds inside itself.
 */
import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { noise3 } from "../landmarks/kit";
import { SPECIES, type Species } from "./placement";

/** A crown: a lumpy ball, flattened underneath. */
function crown(
  detail: number,
  centre: number,
  half: [number, number],
  lumps: number,
  seed: number,
): THREE.BufferGeometry {
  const ball = new THREE.IcosahedronGeometry(1, detail);
  ball.deleteAttribute("uv");
  ball.deleteAttribute("normal");
  const g = mergeVertices(ball);
  ball.dispose();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const up = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Broad lumps, so the crown is boughs and not a ball.
    const swell =
      1 + lumps * (noise3(x * 1.7 + seed, y * 1.7, z * 1.7 - seed) - 0.5) * 2;
    // The underside is flatter than the top.
    const squash = y < 0 ? 0.55 : 1;
    pos.setXYZ(
      i,
      x * half[0] * swell,
      centre + y * half[1] * swell * squash,
      z * half[0] * swell,
    );
    up[i] = y * 0.5 + 0.5;
  }
  g.setAttribute("up", new THREE.BufferAttribute(up, 1));
  g.setAttribute(
    "foliage",
    new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1),
  );
  g.computeVertexNormals();
  return g;
}

/** A conifer: tiers of boughs round a stem, each wider than the one above. */
function tiers(
  sides: number,
  count: number,
  from: number,
  half: number,
): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [new THREE.Vector2(0.001, from)];
  for (let t = 0; t < count; t++) {
    const y0 = from + ((1 - from) * t) / count;
    const y1 = from + ((1 - from) * (t + 1)) / count;
    const wide = half * (1 - (t / count) * 0.78);
    const tuck = half * (1 - ((t + 1) / count) * 0.78) * 0.55;
    profile.push(new THREE.Vector2(wide, y0 + (y1 - y0) * 0.12));
    if (t < count - 1) profile.push(new THREE.Vector2(tuck, y1));
  }
  profile.push(new THREE.Vector2(0.001, 1));
  const lathe = new THREE.LatheGeometry(profile, sides);
  lathe.deleteAttribute("uv");
  lathe.deleteAttribute("normal");
  const g = mergeVertices(lathe);
  lathe.dispose();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const up = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    // Each tier is dark under its boughs and lit along their tips.
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    const y = pos.getY(i);
    const wideHere = half * (1 - ((y - from) / (1 - from)) * 0.78);
    up[i] = Math.min(1, 0.25 + 0.75 * (r / Math.max(wideHere, 1e-3)));
  }
  g.setAttribute("up", new THREE.BufferAttribute(up, 1));
  g.setAttribute(
    "foliage",
    new THREE.BufferAttribute(new Float32Array(pos.count).fill(1), 1),
  );
  g.computeVertexNormals();
  return g;
}

/** A trunk, tapering to `top`. */
function trunk(sides: number, r: number, top: number): THREE.BufferGeometry {
  const c = new THREE.CylinderGeometry(r * 0.55, r, top, sides, 1, true);
  c.translate(0, top / 2, 0);
  c.deleteAttribute("uv");
  const n = c.getAttribute("position").count;
  c.setAttribute("up", new THREE.BufferAttribute(new Float32Array(n), 1));
  c.setAttribute("foliage", new THREE.BufferAttribute(new Float32Array(n), 1));
  const g = c.toNonIndexed();
  c.dispose();
  return g;
}

/**
 * A round-ended column from `y0` to `y1`, standing at `x`. It takes no part
 * in the swell a crown gets, and is lit as one surface from foot to top.
 */
function column(
  sides: number,
  r: number,
  y0: number,
  y1: number,
  x = 0,
): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(r, y0),
    new THREE.Vector2(r, y1 - r),
    new THREE.Vector2(r * 0.7, y1 - r * 0.3),
    new THREE.Vector2(0.001, y1),
  ];
  const lathe = new THREE.LatheGeometry(profile, sides);
  lathe.deleteAttribute("uv");
  lathe.translate(x, 0, 0);
  const n = lathe.getAttribute("position").count;
  lathe.setAttribute(
    "up",
    new THREE.BufferAttribute(new Float32Array(n).fill(1), 1),
  );
  lathe.setAttribute(
    "foliage",
    new THREE.BufferAttribute(new Float32Array(n), 1),
  );
  const g = lathe.toNonIndexed();
  lathe.dispose();
  return g;
}

/** A bare branch from a stem, leaning out by `lean` radians toward `turn`. */
function branch(
  r: number,
  from: number,
  length: number,
  lean: number,
  turn: number,
): THREE.BufferGeometry {
  const g = trunk(4, r, length);
  g.rotateZ(-lean);
  g.rotateY(turn);
  g.translate(0, from, 0);
  return g;
}

function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
  );
  if (!merged) throw new Error("A tree's parts cannot be merged.");
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * The shape of `species`, in full for a tree seen close and in few triangles
 * for one seen from far off.
 */
export function treeGeometry(
  species: Species,
  far: boolean,
): THREE.BufferGeometry {
  const d = far ? 0 : 1;
  const sides = far ? 5 : 8;
  switch (species.id) {
    case "oak":
      return join([
        crown(d, 0.5, [0.5, 0.5], 0.3, 1.3),
        ...(far ? [] : [trunk(5, 0.045, 0.35)]),
      ]);
    case "beech":
      return join([
        crown(d, 0.5, [0.5, 0.5], 0.26, 4.1),
        ...(far ? [] : [trunk(5, 0.06, 0.32)]),
      ]);
    case "spruce":
      return join([
        tiers(sides, far ? 2 : 4, 0.1, 0.5),
        ...(far ? [] : [trunk(5, 0.07, 0.2)]),
      ]);
    case "pine":
      return join([
        crown(d, 0.8, [0.5, 0.2], 0.24, 7.7),
        trunk(far ? 4 : 5, 0.07, 0.75),
      ]);
    case "birch":
      return join([
        crown(d, 0.6, [0.5, 0.4], 0.3, 9.2),
        trunk(far ? 4 : 5, 0.06, 0.6),
      ]);
    case "boulder":
      // Sunk into the ground, so no rock sits on it like a ball.
      return join([crown(d, 0.3, [0.5, 0.7], 0.34, 13.4)]);
    case "crag":
      return join([crown(d, 0.3, [0.5, 0.62], 0.4, 17.8)]);
    case "cactus":
      return join([
        column(far ? 4 : 6, 0.16, 0, 1),
        ...(far
          ? []
          : [
              column(5, 0.1, 0.38, 0.8, 0.38),
              column(5, 0.1, 0.5, 0.92, -0.36),
              // The arms' elbows, as short stubs out from the stem.
              branch(0.09, 0.42, 0.38, Math.PI / 2, 0),
              branch(0.09, 0.54, 0.36, Math.PI / 2, Math.PI),
            ]),
      ]);
    case "palm":
      return join([
        crown(d, 0.9, [0.5, 0.14], 0.3, 21.3),
        trunk(far ? 4 : 5, 0.05, 0.9),
      ]);
    case "acacia":
      return join([
        crown(d, 0.86, [0.5, 0.16], 0.24, 25.1),
        trunk(far ? 4 : 5, 0.05, 0.8),
      ]);
    case "snag":
      return join([
        trunk(far ? 4 : 5, 0.16, 1),
        ...(far
          ? []
          : [
              branch(0.07, 0.5, 0.42, 0.9, 0.4),
              branch(0.06, 0.66, 0.34, 1.0, 2.7),
              branch(0.05, 0.36, 0.3, 1.1, 4.4),
            ]),
      ]);
    case "shrub":
      return join([crown(d, 0.42, [0.5, 0.55], 0.22, 11.9)]);
  }
}

/** Triangles in each kind's shapes, near then far, for a report. */
export function treeTriangles(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const s of SPECIES) {
    const near = treeGeometry(s, false);
    const far = treeGeometry(s, true);
    out[s.id] = [
      near.getAttribute("position").count / 3,
      far.getAttribute("position").count / 3,
    ];
    near.dispose();
    far.dispose();
  }
  return out;
}
