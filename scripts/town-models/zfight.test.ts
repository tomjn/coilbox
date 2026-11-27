/**
 * Finds the faces in each Persepolis building that two different parts draw
 * in the same plane and overlap, which the engine shows as z-fighting.
 */
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { test } from "vitest";
import {
  Builder,
  type Paint,
  type PartTag,
} from "../../src/conquest/galaxy3d/landmarks/kit";
import { TOWN_PALETTES } from "../../src/conquest/galaxy3d/landmarks/palettes";
import { BUILDINGS } from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";

type Rgb = [number, number, number];
interface Tri {
  part: number;
  n: THREE.Vector3;
  d: number;
  pts: THREE.Vector3[];
}

class TriRecorder extends Builder {
  tris: Tri[] = [];
  private parts = 0;
  override add(
    g: THREE.BufferGeometry,
    color: Rgb,
    m: THREE.Matrix4,
    paint: Paint = {},
    tag?: PartTag,
  ): void {
    const flat = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    const pos = flat.getAttribute("position");
    const part = this.parts++;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const pts = [0, 1, 2].map(
        (k) =>
          new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)),
      );
      const n = new THREE.Vector3()
        .subVectors(pts[1], pts[0])
        .cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
      const area = n.length() / 2;
      if (area < 1e-10) continue;
      n.normalize();
      this.tris.push({ part, n, d: n.dot(pts[0]), pts });
    }
    super.add(g, color, m, paint, tag);
  }
}

/** Overlap area of two coplanar triangles, by clipping one against the other in the plane. */
function overlap(a: Tri, b: Tri): number {
  const u = new THREE.Vector3().subVectors(a.pts[1], a.pts[0]).normalize();
  const v = new THREE.Vector3().crossVectors(a.n, u);
  const flat = (t: Tri) =>
    t.pts.map((p) => [p.dot(u), p.dot(v)] as [number, number]);
  let poly = flat(a);
  const clip = flat(b);
  // Wind the clipping triangle anticlockwise.
  const s =
    (clip[1][0] - clip[0][0]) * (clip[2][1] - clip[0][1]) -
    (clip[2][0] - clip[0][0]) * (clip[1][1] - clip[0][1]);
  if (s < 0) clip.reverse();
  for (let e = 0; e < 3 && poly.length > 0; e++) {
    const [p, q] = [clip[e], clip[(e + 1) % 3]];
    const inside = (r: [number, number]) =>
      (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) >= -1e-9;
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i];
      const n = poly[(i + 1) % poly.length];
      if (inside(c)) out.push(c);
      if (inside(c) !== inside(n)) {
        const dx = n[0] - c[0];
        const dy = n[1] - c[1];
        const ex = q[0] - p[0];
        const ey = q[1] - p[1];
        const t =
          ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / (dx * ey - dy * ex);
        out.push([c[0] + dx * t, c[1] + dy * t]);
      }
    }
    poly = out;
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area) / 2;
}

test("coplanar overlapping faces per building", () => {
  /** Planes closer than this, in world units, fight: 0.5 elmo at 512 elmos a unit. */
  const EPS = 0.5 / 512;
  const lines: string[] = [];
  for (const model of BUILDINGS) {
    const [w, d] = footprint(model, OPEN_GRID);
    const r = new TriRecorder();
    model.build(r, w, d, TOWN_PALETTES.temperate, "close");
    const buckets = new Map<string, Tri[]>();
    const key = (t: Tri, dd: number) =>
      `${Math.round(t.n.x * 200)},${Math.round(t.n.y * 200)},${Math.round(t.n.z * 200)},${Math.floor(t.d / EPS) + dd}`;
    for (const t of r.tris) {
      const k = key(t, 0);
      if (!buckets.has(k)) buckets.set(k, []);
      (buckets.get(k) as Tri[]).push(t);
    }
    let area = 0;
    const pairs = new Map<string, { area: number; y0: number; y1: number }>();
    for (const t of r.tris)
      for (const dd of [0, 1]) {
        for (const o of buckets.get(key(t, dd)) ?? []) {
          if (
            o.part <= t.part ||
            Math.abs(o.d - t.d) > EPS ||
            t.n.dot(o.n) < 0.9999
          )
            continue;
          const a = overlap(t, o);
          if (a < 1e-8) continue;
          area += a;
          const pk = `${t.part}/${o.part}`;
          const ys = [...t.pts, ...o.pts].map((p) => p.y);
          const e = pairs.get(pk) ?? { area: 0, y0: Infinity, y1: -Infinity };
          e.area += a;
          e.y0 = Math.min(e.y0, ...ys);
          e.y1 = Math.max(e.y1, ...ys);
          pairs.set(pk, e);
        }
      }
    if (area === 0) continue;
    const top = [...pairs.entries()]
      .sort((a, b) => b[1].area - a[1].area)
      .slice(0, 4);
    lines.push(
      `${model.id} height ${model.height}: ${(area * 512 * 512).toFixed(0)} square elmos in ${pairs.size} part pairs; ` +
        top
          .map(
            ([k, e]) =>
              `parts ${k} ${(e.area * 512 * 512).toFixed(0)} at y ${(e.y0 * 512).toFixed(0)}..${(e.y1 * 512).toFixed(0)}`,
          )
          .join("; "),
    );
  }
  writeFileSync(
    new URL("../../docs/reports/town-models/zfight-report.txt", import.meta.url)
      .pathname,
    `${lines.join("\n")}\n`,
  );
});
