/**
 * Writes one OBJ and MTL per colourway beside each model, so Finder's preview
 * can show every colourway. Reads the OBJ and textures the bake wrote.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { test } from "vitest";

const OUT = new URL("../../docs/reports/town-models/out/", import.meta.url)
  .pathname;

test("colourway objs", () => {
  let written = 0;
  for (const folder of ["open-town", "open-town-fillers", "outpost"])
    for (const model of readdirSync(`${OUT}${folder}`)) {
      const dir = `${OUT}${folder}/${model}/`;
      const obj = readFileSync(`${dir}${model}.obj`, "utf8");
      const body = obj
        .slice(obj.indexOf("\n") + 1)
        .replace(/^usemtl .*$/m, "usemtl colourway");
      rmSync(`${dir}colourways`, { recursive: true, force: true });
      mkdirSync(`${dir}colourways`);
      for (const png of readdirSync(`${dir}textures`)) {
        const id = png.replace(/\.png$/, "");
        const name = `${model}-${id}`;
        writeFileSync(
          `${dir}colourways/${name}.obj`,
          `mtllib ${name}.mtl\n${body}`,
        );
        writeFileSync(
          `${dir}colourways/${name}.mtl`,
          [
            "newmtl colourway",
            "Ka 0 0 0",
            "Kd 1 1 1",
            "Ks 0 0 0",
            "d 1",
            "illum 1",
            `map_Kd ../textures/${png}`,
            "",
          ].join("\n"),
        );
        written++;
      }
      rmSync(`${dir}${model}.obj`);
      rmSync(`${dir}${model}.mtl`);
    }
  writeFileSync(`${OUT}colourways.txt`, `${written}\n`);
});
