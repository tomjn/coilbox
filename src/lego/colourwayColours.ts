/**
 * The colour of each colourway, for the chips beside its name (#4538).
 *
 * Read from the atlas rather than written down, so an extension pack's
 * colourways get chips too: the colour is the average of the swatch the pack
 * lists for that colourway, with the team colour mixed in by the atlas's alpha
 * as the 3D views mix it. A colourway with no swatch, such as the bundled
 * pack's "Mixed", has no one colour, so its chip shows every swatch's.
 */

import { useEffect, useState } from "react";

import { TEAM_COLOUR } from "../lib/springTexture";
import { textureHasAlpha } from "../lib/textureAlpha";
import { readTexturePixels, type TexturePixels } from "../lib/texturePixels";
import { hexToRgb, mixTeamColourInto } from "../lib/textureTeamColour";
import { atlasUrl, baseAtlas } from "./atlas";
import type { LoadedPack } from "./pack";
import type { ShapeSwatch } from "./shapes";

/** A CSS colour per colourway id. Empty until the atlas has been read. */
export type ColourwayColours = ReadonlyMap<string, string>;

/**
 * The average of a swatch's pixels as a CSS colour. The pixels run from the top
 * left and the swatch's v runs up from the bottom, as three draws it.
 */
export function swatchColour(
  pixels: TexturePixels,
  swatch: ShapeSwatch,
  masked: boolean,
): string | undefined {
  const { width, height, data } = pixels;
  const x0 = Math.floor(swatch.uv.min[0] * width);
  const x1 = Math.ceil(swatch.uv.max[0] * width);
  const y0 = Math.floor((1 - swatch.uv.max[1]) * height);
  const y1 = Math.ceil((1 - swatch.uv.min[1]) * height);
  const box: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const at = (y * width + x) * 4;
      box.push(data[at], data[at + 1], data[at + 2], data[at + 3]);
    }
  }
  if (box.length === 0) return undefined;
  const mixed = new Uint8ClampedArray(box);
  if (masked) mixTeamColourInto(mixed, hexToRgb(TEAM_COLOUR));
  const sum = [0, 0, 0];
  for (let i = 0; i < mixed.length; i += 4) {
    sum[0] += mixed[i];
    sum[1] += mixed[i + 1];
    sum[2] += mixed[i + 2];
  }
  const count = mixed.length / 4;
  const [r, g, b] = sum.map((n) => Math.round(n / count));
  return `rgb(${r} ${g} ${b})`;
}

/** One read per atlas for the session, as the chips are drawn many times. */
const cache = new Map<string, Promise<ColourwayColours>>();

async function readColours(
  url: string,
  swatches: ShapeSwatch[],
): Promise<ColourwayColours> {
  const [pixels, alpha] = await Promise.all([
    readTexturePixels(url),
    textureHasAlpha(url),
  ]);
  // Only a texture known to have no alpha is drawn without the team colour,
  // as `paintTeamColourIfMasked` decides.
  const masked = alpha !== false;
  const colours = new Map<string, string>();
  for (const swatch of swatches) {
    const colour = swatchColour(pixels, swatch, masked);
    if (colour) colours.set(swatch.id, colour);
  }
  return colours;
}

/** The pack's colourway colours, empty while the atlas loads or if it fails. */
export function useColourwayColours(pack: LoadedPack): ColourwayColours {
  const [colours, setColours] = useState<ColourwayColours>(() => new Map());
  const swatches = pack.manifest.swatches;
  const atlas = baseAtlas(pack);
  const url = atlas ? atlasUrl(atlas) : null;

  useEffect(() => {
    if (!url || !swatches || swatches.length === 0) return;
    let live = true;
    let read = cache.get(url);
    if (!read) {
      read = readColours(url, swatches);
      cache.set(url, read);
      // A failed read is tried again by the next view that asks.
      read.catch(() => cache.delete(url));
    }
    read.then(
      (found) => live && setColours(found),
      // No chips beats no menu: they stay the plain outline.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [url, swatches]);

  return colours;
}
