/**
 * Painting Spring's team-colour alpha mask into RGB for a flat 2D preview.
 *
 * The texture a unit is painted with carries team colour in its alpha channel
 * rather than transparency (255 = full team colour, 0 = none, see
 * `springTexture.ts`), and most of a typical texture is 0. A plain `<img>`
 * therefore renders it as almost entirely see-through, which reads as a
 * broken file rather than as the unit's own colours. `mixTeamColourInto`
 * reproduces the mix the 3D viewport's shader patch does in `shade()`:
 * `diffuseColor.rgb = mix(diffuseColor.rgb, teamColour, diffuseColor.a)`,
 * over raw canvas pixel data rather than in a fragment shader, then forces
 * alpha to 255 so the canvas itself never turns transparent.
 *
 * The second texture carries no such mask, it is glow (red) and shine
 * (green), so `forceOpaqueInto` is the whole of what its preview needs.
 */

/** One 0..255 RGB triple, the shape `hexToRgb` and the mixers agree on. */
export type Rgb = readonly [number, number, number];

/** Decode a `0xRRGGBB` int, the shape `TEAM_COLOUR` is stored in, to RGB. */
export function hexToRgb(hex: number): Rgb {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/**
 * Mix `teamColour` into every pixel of `data` by its own alpha, then force
 * alpha to 255. `data` is `ImageData.data`, mutated in place.
 */
export function mixTeamColourInto(
  data: Uint8ClampedArray,
  teamColour: Rgb,
): void {
  const [r, g, b] = teamColour;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] += (r - data[i]) * a;
    data[i + 1] += (g - data[i + 1]) * a;
    data[i + 2] += (b - data[i + 2]) * a;
    data[i + 3] = 255;
  }
}

/** Force every pixel of `data` opaque, leaving RGB untouched. Mutated in place. */
export function forceOpaqueInto(data: Uint8ClampedArray): void {
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
}
