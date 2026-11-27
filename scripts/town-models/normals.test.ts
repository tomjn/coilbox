/**
 * Bakes a few buildings' colour and normal atlases and a lit preview of each,
 * to check the normal bake by eye before a full map run. Writes to out/normals/.
 * The preview lights each chart from its texture's upper left, so a groove
 * shows a lit and a dark side on every face.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { test } from "vitest";
import { TOWN_PALETTES } from "../../src/conquest/galaxy3d/landmarks/palettes";
import { BUILDINGS } from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";
import { dress, LIVERIES } from "../../src/conquest/galaxy3d/towns3d/liveries";
import { bake, bakeAo, bakeNormals, built, OUT, png, unwrap } from "./townkit";

const DIR = `${OUT}normals/`;
const CASES: [string, string][] = [
  ["arch", "ribbed-dark"],
  ["arch", "blue-glass"],
  ["atrium", "red-brick"],
  ["arch", "pale"],
];

test("normal bake previews", () => {
  mkdirSync(DIR, { recursive: true });
  for (const [id, liveryId] of CASES) {
    const model = BUILDINGS.find((m) => m.id === id);
    const livery = LIVERIES.find((l) => l.id === liveryId);
    if (!model || !livery)
      throw new Error(`no model ${id} or livery ${liveryId}`);
    const [w, d] = footprint(model, OPEN_GRID);
    const g = built((b) => model.build(b, w, d, TOWN_PALETTES.temperate));
    dress(g, 1, livery);
    const geometry = mergeGeometries([g]);
    const u = unwrap(geometry);
    const ao = bakeAo(geometry, u, 0);
    const colour = bake(geometry, u, false, undefined, ao);
    const normals = bakeNormals(geometry, u, ao);
    const L = [-0.55, -0.55, 0.63];
    const lit = new Uint8Array(colour.length);
    for (let o = 0; o < colour.length; o += 4) {
      const n = [0, 1, 2].map((c) => normals[o + c] / 127.5 - 1);
      const shade =
        0.35 + 0.9 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      for (let c = 0; c < 3; c++)
        lit[o + c] = Math.min(255, Math.round(colour[o + c] * shade));
      lit[o + 3] = 255;
    }
    const name = `${id}-${liveryId}`;
    writeFileSync(`${DIR}${name}.png`, png(colour, u.w, u.h));
    writeFileSync(`${DIR}${name}_normals.png`, png(normals, u.w, u.h));
    writeFileSync(`${DIR}${name}_lit.png`, png(lit, u.w, u.h));
    console.log(name, `${u.w}x${u.h}`, `density ${u.density.toFixed(0)}`);
  }
});
