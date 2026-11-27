import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type * as THREE from "three";
import { test } from "vitest";
import { townPalette } from "../../src/conquest/galaxy3d/landmarks/palettes";
import { BUILDINGS } from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
  OUTPOST_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";
import { dress, LIVERIES } from "../../src/conquest/galaxy3d/towns3d/liveries";
import {
  OUTPOST_COLOURWAYS,
  outpostPaint,
  type SealedPlanetId,
} from "../../src/conquest/galaxy3d/towns3d/outpostColourways";
import { OUTPOSTS } from "../../src/conquest/galaxy3d/towns3d/outposts";
import {
  aoImage,
  bake,
  bakeAo,
  built,
  OPEN_PLANETS,
  OUT,
  obj,
  png,
  s3o,
  stl,
  unwrap,
} from "./townkit";

const BAKE = process.env.BAKE === "1";
interface Job {
  folder: string;
  name: string;
  outpost: boolean;
  /** Each colourway's name and its geometry. */
  variants: { id: string; geometry: () => THREE.BufferGeometry }[];
}

function jobs(): Job[] {
  const list: Job[] = [];
  for (const m of BUILDINGS) {
    const [w, d] = footprint(m, OPEN_GRID);
    const variants: Job["variants"] = [];
    for (const planet of OPEN_PLANETS) {
      const make = () => built((b) => m.build(b, w, d, townPalette(planet)));
      if (m.filler) {
        variants.push({ id: planet, geometry: make });
        continue;
      }
      for (const l of LIVERIES) {
        if (
          (l.from !== undefined && m.height < l.from) ||
          (l.to !== undefined && m.height > l.to)
        )
          continue;
        variants.push({
          id: `${planet}-${l.id}`,
          geometry: () => {
            const g = make();
            dress(g, 1, l);
            return g;
          },
        });
      }
    }
    list.push({
      folder: m.filler ? "open-town-fillers" : "open-town",
      name: m.id,
      outpost: false,
      variants,
    });
  }
  for (const m of OUTPOSTS) {
    const [w, d] = footprint(m, OUTPOST_GRID);
    const variants: Job["variants"] = [];
    for (const [planet, all] of Object.entries(OUTPOST_COLOURWAYS) as [
      SealedPlanetId,
      typeof OUTPOST_COLOURWAYS.red,
    ][]) {
      const suited = all.filter(
        (c) => !c.families || c.families.includes(m.family),
      );
      for (const c of suited.length > 0 ? suited : all)
        variants.push({
          id: `${planet}-${c.id}`,
          geometry: () =>
            built((b) => m.build(b, w, d, outpostPaint(planet, c))),
        });
    }
    list.push({
      folder: "outpost",
      name: m.id.replace(/^outpost-/, ""),
      outpost: true,
      variants,
    });
  }
  return list;
}

/** Elmos per world unit in the .s3o files: Persepolis's scale, where an open-town lot is 128 elmos. */
const S3O_SCALE = 512;
/** The package is written here, to be zipped as coilbox-town-models.zip. */
const PACKAGE = `${OUT}coilbox-town-models/`;

test("export town models", () => {
  if (!process.env.ONLY) rmSync(PACKAGE, { recursive: true, force: true });
  const recoil = `${PACKAGE}recoil/`;
  mkdirSync(`${recoil}objects3d`, { recursive: true });
  mkdirSync(`${recoil}unittextures`, { recursive: true });
  const lines: string[] = [];
  let texels = 0;
  let files = 0;
  let lowest = Infinity;
  for (const job of jobs().filter(
    (j) => !process.env.ONLY || j.name === process.env.ONLY,
  )) {
    const dir = `${PACKAGE}${job.folder}/${job.name}/`;
    mkdirSync(`${dir}textures`, { recursive: true });
    mkdirSync(`${dir}colourways`, { recursive: true });
    const first = job.variants[0].geometry();
    const u = unwrap(first);
    lowest = Math.min(lowest, u.density);
    writeFileSync(`${dir}${job.name}.stl`, stl(first));
    texels += u.w * u.h * job.variants.length;
    files += job.variants.length;
    lines.push(
      `${job.folder}/${job.name} atlas=${u.w}x${u.h} density=${u.density.toFixed(0)} variants=${job.variants.length}`,
    );
    // Colourways share the shape, so one AO map serves them all.
    first.computeBoundingBox();
    const ao = BAKE
      ? bakeAo(first, u, (first.boundingBox as THREE.Box3).min.y)
      : undefined;
    if (ao)
      writeFileSync(`${dir}${job.name}_ao.png`, png(aoImage(ao), u.w, u.h));
    for (const v of job.variants) {
      const o = obj(`${job.name}-${v.id}`, first, u, v.id);
      writeFileSync(`${dir}colourways/${job.name}-${v.id}.obj`, o.obj);
      writeFileSync(
        `${dir}colourways/${job.name}-${v.id}.mtl`,
        o.mtl.replace("map_Kd textures/", "map_Kd ../textures/"),
      );
      if (!BAKE) continue;
      const pbr = new Uint8Array(u.w * u.h * 4);
      const colour = bake(v.geometry(), u, job.outpost, pbr, ao);
      writeFileSync(`${dir}textures/${v.id}.png`, png(colour, u.w, u.h));
      // Recoil reads tex1's alpha as the team colour mask, 0 keeping the building's own colour,
      // and cuts out any texel whose tex2 alpha is 0.
      const name = `${job.folder}-${job.name}-${v.id}`;
      for (let i = 3; i < colour.length; i += 4) colour[i] = 0;
      for (let i = 3; i < pbr.length; i += 4) pbr[i] = 255;
      writeFileSync(
        `${recoil}unittextures/${name}.png`,
        png(colour, u.w, u.h, true),
      );
      writeFileSync(
        `${recoil}unittextures/${name}_2.png`,
        png(pbr, u.w, u.h, true),
      );
      writeFileSync(
        `${recoil}objects3d/${name}.s3o`,
        s3o(first, u, `${name}.png`, `${name}_2.png`, S3O_SCALE).bytes,
      );
    }
  }
  lines.push(
    `total colourways=${files} texels=${texels} lowestDensity=${lowest.toFixed(0)}`,
  );
  writeFileSync(`${OUT}plan.txt`, `${lines.join("\n")}\n`);
});
