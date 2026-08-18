/**
 * Turning a map's stored heights into something a vertex shader can displace by
 * (issue #1730).
 *
 * The alternative is a picture of them, which is eight bits deep whatever the
 * file holds: a browser flattens a 16 bit image to its high byte on the way in,
 * canvas `ImageData` is a `Uint8ClampedArray` and a three.js texture defaults to
 * `UnsignedByteType`. That collapses gentle slopes into flat steps, and shading
 * turns those steps into contour rings.
 *
 * Kept apart from the preview component so the arithmetic can be tested without
 * a WebGL context.
 */

/**
 * A map's heights as the engine stores them: one 16 bit word per heightmap
 * vertex, row major, row 0 at the map's north.
 */
export interface HeightWords {
  words: Uint16Array;
  width: number;
  height: number;
}

/** Samples kept on each axis, which the preview mesh's vertex count decides. */
export interface DecimatedHeights {
  /** Row major, `width * height` samples, each 0..1 across the map's range. */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * The grid reduced to `max` samples a side, as the 0..1 floats a `DataTexture`
 * takes, with the rows in the order a texture wants them.
 *
 * Three things are going on and each is load bearing:
 *
 * - Decimated, because the mesh has a fixed number of vertices a side and
 *   horizontal detail past that cannot be drawn. A 2049 sample grid held at
 *   full resolution in floats is 16 MB against about 1 MB for this.
 * - Averaged rather than sampled, so a peak between two kept columns pulls its
 *   neighbours up instead of vanishing.
 * - Rows reversed, because a `DataTexture` is not flipped on upload the way a
 *   loaded image is. WebGL's `UNPACK_FLIP_Y_WEBGL` has no effect on an array
 *   upload, so the flip happens here and the two paths put the map's north in
 *   the same place.
 *
 * 65536 rather than 65535 is the divisor because that is
 * `CSMFMapFile::ReadHeightmap`'s own, at `rts/Map/SMF/SMFReadMap.cpp:157`, so a
 * sample is the number the engine holds rather than one a step off it.
 */
export function decimateHeights(
  grid: HeightWords,
  max: number,
): DecimatedHeights {
  const stepX = Math.max(1, Math.ceil(grid.width / max));
  const stepZ = Math.max(1, Math.ceil(grid.height / max));
  const width = Math.ceil(grid.width / stepX);
  const height = Math.ceil(grid.height / stepZ);
  const data = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let sum = 0;
      let counted = 0;
      for (let dz = 0; dz < stepZ; dz++) {
        const z = row * stepZ + dz;
        if (z >= grid.height) break;
        for (let dx = 0; dx < stepX; dx++) {
          const x = col * stepX + dx;
          if (x >= grid.width) break;
          sum += grid.words[z * grid.width + x];
          counted++;
        }
      }
      const flipped = height - 1 - row;
      data[flipped * width + col] = counted ? sum / counted / 65536 : 0;
    }
  }
  return { data, width, height };
}
