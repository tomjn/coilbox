/**
 * Reading the map's ground height on the CPU.
 *
 * The 3D preview puts the terrain's relief in a `displacementMap` sampled by the
 * vertex shader, so the geometry three.js holds is a flat plane: a raycast
 * against it comes back flat, and a model positioned from it floats or sinks.
 * The heightmap is already in hand as a data URL, so the same values the shader
 * uses are read back off a canvas once and sampled here.
 *
 * The sampling is arithmetic and tested. Decoding the image is not, because it
 * needs a canvas.
 */

/** A decoded heightmap: one 0..1 sample per pixel, row 0 at the map's north. */
export interface HeightField {
  width: number;
  height: number;
  /** Row-major, `width * height` samples, each 0..1 across the map's range. */
  samples: Float32Array;
}

/**
 * Decode a heightmap data URL into samples, or `null` if it cannot be read.
 *
 * Greyscale, so the red channel is the height. The preview's texture loader
 * flips the image on upload and the plane's V axis is flipped again by lying it
 * down, so the two cancel: image row 0 is the map's north edge, exactly as the
 * image looks.
 */
export async function readHeightField(
  src: string,
): Promise<HeightField | null> {
  const bitmap = await createImageBitmap(await (await fetch(src)).blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const samples = new Float32Array(bitmap.width * bitmap.height);
    for (let i = 0; i < samples.length; i++) samples[i] = data[i * 4] / 255;
    return { width: bitmap.width, height: bitmap.height, samples };
  } finally {
    bitmap.close();
  }
}

/** A sample by pixel, clamped to the field so an edge position still reads. */
function sampleAt(field: HeightField, col: number, row: number): number {
  const c = Math.min(field.width - 1, Math.max(0, col));
  const r = Math.min(field.height - 1, Math.max(0, row));
  return field.samples[r * field.width + c];
}

/**
 * The ground height in engine world units at an engine position.
 *
 * Bilinear, because the heightmap the preview fetches is downscaled and nearest
 * sampling on a 512-pixel image of a 4096-elmo map makes a row of units step up
 * and down in 8-elmo jumps. `minHeight` and `maxHeight` are the map's own range,
 * the same pair the preview scales its displacement by.
 */
export function groundHeight(
  field: HeightField,
  worldX: number,
  worldZ: number,
  worldWidth: number,
  worldHeight: number,
  minHeight: number,
  maxHeight: number,
): number {
  const u = Math.min(1, Math.max(0, worldWidth > 0 ? worldX / worldWidth : 0));
  const v = Math.min(
    1,
    Math.max(0, worldHeight > 0 ? worldZ / worldHeight : 0),
  );
  const x = u * (field.width - 1);
  const z = v * (field.height - 1);
  const col = Math.floor(x);
  const row = Math.floor(z);
  const fx = x - col;
  const fz = z - row;
  const top =
    sampleAt(field, col, row) * (1 - fx) + sampleAt(field, col + 1, row) * fx;
  const bottom =
    sampleAt(field, col, row + 1) * (1 - fx) +
    sampleAt(field, col + 1, row + 1) * fx;
  const norm = top * (1 - fz) + bottom * fz;
  return norm * (maxHeight - minHeight) + minHeight;
}
