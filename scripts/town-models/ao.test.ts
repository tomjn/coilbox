import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { test } from "vitest";
import { townPalette } from "../../src/conquest/galaxy3d/landmarks/palettes";
import { BUILDINGS } from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";
import { dress, LIVERIES } from "../../src/conquest/galaxy3d/towns3d/liveries";
import {
  AO_RAYS,
  AO_REACH,
  aoImage,
  bake,
  bakeAo,
  built,
  OUT,
  obj,
  png,
  unwrap,
} from "./townkit";

/** Bakes models with and without AO into out/ao-probe/, for render.test.ts to compare. */
test("ao probe", () => {
  const root = `${OUT}ao-probe/`;
  for (const id of (process.env.ONLY ?? "tower").split(",")) {
    const m = BUILDINGS.find((b) => b.id === id);
    if (!m) throw new Error(`no building ${id}`);
    const [w, d] = footprint(m, OPEN_GRID);
    const g = built((b) => m.build(b, w, d, townPalette("temperate")));
    dress(
      g,
      1,
      LIVERIES.find(
        (l) =>
          (l.from === undefined || m.height >= l.from) &&
          (l.to === undefined || m.height <= l.to),
      ),
    );
    g.computeBoundingBox();
    const box = g.boundingBox as THREE.Box3;
    const u = unwrap(g);
    const dir = `${root}${id}/`;
    mkdirSync(`${dir}textures`, { recursive: true });
    writeFileSync(`${dir}${id}.obj`, obj(id, g, u, "plain").obj);
    const t0 = performance.now();
    const ao = bakeAo(g, u, box.min.y);
    const ms = performance.now() - t0;
    let sum = 0;
    for (const v of ao) sum += v;
    writeFileSync(`${dir}textures/ao.png`, png(aoImage(ao), u.w, u.h));
    writeFileSync(
      `${dir}textures/plain.png`,
      png(bake(g, u, false, undefined, undefined, 0), u.w, u.h),
    );
    writeFileSync(
      `${dir}textures/shaded.png`,
      png(bake(g, u, false, undefined, ao), u.w, u.h),
    );
    const size = box.getSize(new THREE.Vector3());
    appendFileSync(
      `${root}log.txt`,
      `${new Date().toISOString()} ${id} size=${size
        .toArray()
        .map((x) => x.toFixed(3))
        .join(
          "x",
        )} tris=${g.getAttribute("position").count / 3} atlas=${u.w}x${u.h} rays=${AO_RAYS} reach=${AO_REACH} ao=${ms.toFixed(0)}ms meanAo=${(sum / ao.length).toFixed(3)}\n`,
    );
  }
});
