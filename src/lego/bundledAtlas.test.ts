import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodePng } from "../lib/pngDecode";

/**
 * The bundled atlas's alpha is the team colour mask, and the builder mixes the
 * player's colour in wherever it is above 0 (`paintTeamColour`). A part in the
 * grey or tan colourway must therefore sit entirely on alpha 0, or it is drawn
 * tinted (#4523). A part named "grey block" can still show green: the grey
 * column is KaiserJ's own art, and some of its panels are painted green.
 */
const read = (name: string) =>
  readFileSync(new URL(`../../src-tauri/legoparts/${name}`, import.meta.url));

interface Part {
  id: string;
  colourway: string;
  uvBox: { min: [number, number]; max: [number, number] };
}

describe("the bundled atlas", () => {
  const atlas = decodePng(new Uint8Array(read("atlas.png")));
  const parts = (JSON.parse(read("pack.json").toString()) as { parts: Part[] })
    .parts;

  it("has an alpha channel", () => {
    expect(atlas).toBeDefined();
  });

  it("has no team colour under any grey or tan part", () => {
    if (!atlas) throw new Error("no atlas");
    const { width, height, data } = atlas;
    const tinted: string[] = [];
    let checked = 0;
    for (const part of parts) {
      if (part.colourway !== "grey" && part.colourway !== "tan") continue;
      checked++;
      const { min, max } = part.uvBox;
      // v runs up from the bottom of the atlas, rows run down from the top.
      const top = Math.floor((1 - max[1]) * height);
      const bottom = Math.min(height - 1, Math.ceil((1 - min[1]) * height));
      const left = Math.max(0, Math.floor(min[0] * width));
      const right = Math.min(width - 1, Math.ceil(max[0] * width));
      scan: for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          if (data[(y * width + x) * 4 + 3] > 0) {
            tinted.push(part.id);
            break scan;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(tinted).toEqual([]);
  });
});
