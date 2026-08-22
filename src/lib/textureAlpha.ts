/**
 * Whether a texture file carries an alpha channel, read from its header.
 *
 * The unit builder needs this because a team-colour mask that is not there
 * samples as 1 rather than as 0: a texture with no alpha paints the whole unit
 * in the player's colour instead of none of it. Coilbox's own texture store made
 * exactly that hole. Until issue #1909 it re-encoded a `.bmp` or a `.tga` to an
 * RGB PNG on the way in, on the belief that the alpha was the second texture's
 * business, so a unit imported before that has a stored texture with the mask
 * cut out of it. Refreshing the texture puts it back, but a unit nobody has
 * touched should not turn blue in the meantime.
 *
 * The header rather than the pixels: a shared unit atlas is 8192 square, and the
 * question is answered by 32 bytes.
 */

/** PNG's eight-byte signature. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** How many bytes of a file [`headerHasAlpha`] needs to answer. */
export const TEXTURE_HEADER_BYTES = 128;

/** `DDPF_ALPHAPIXELS`: the pixel format carries alpha. */
const DDPF_ALPHAPIXELS = 0x1;

/**
 * Does this file have an alpha channel? `undefined` when the bytes are not a
 * format this reads, which the caller treats as a reason to trust the file
 * rather than to distrust it.
 */
export function headerHasAlpha(bytes: Uint8Array): boolean | undefined {
  if (PNG_MAGIC.every((byte, at) => bytes[at] === byte)) {
    return pngHasAlpha(bytes);
  }
  if (
    bytes[0] === 0x44 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x53 &&
    bytes[3] === 0x20
  ) {
    return ddsHasAlpha(bytes);
  }
  // A JPEG never carries one, whatever else is in its header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return false;
  return undefined;
}

/**
 * A PNG's colour type, the 26th byte of the file, which is the last field of a
 * fixed-size IHDR that is always the first chunk. 4 is grey with alpha and 6 is
 * truecolour with alpha, while 0, 2 and 3 have none.
 */
function pngHasAlpha(bytes: Uint8Array): boolean | undefined {
  const colourType = bytes[25];
  if (colourType === undefined) return undefined;
  return colourType === 4 || colourType === 6;
}

/**
 * A DDS's pixel format, at offset 76 of a 128 byte header.
 *
 * A compressed one is named by its four character code. DXT1 stores one bit of
 * alpha that the engine's own loader reads as opaque, so it counts as none, and
 * DXT2 upwards all carry it. Anything behind a DX10 header names its format in a
 * second header this does not read, and is not a format coilbox decodes anywhere
 * else either.
 */
function ddsHasAlpha(bytes: Uint8Array): boolean | undefined {
  if (bytes.length < 88) return undefined;
  const flags =
    bytes[80] | (bytes[81] << 8) | (bytes[82] << 16) | (bytes[83] << 24);
  const fourCC = String.fromCharCode(
    bytes[84],
    bytes[85],
    bytes[86],
    bytes[87],
  );
  if (fourCC === "DX10") return undefined;
  if (fourCC.startsWith("DXT")) return fourCC !== "DXT1";
  return (flags & DDPF_ALPHAPIXELS) !== 0;
}

/**
 * The same answer for a file the asset protocol serves, over a range request so
 * a 64 MiB atlas costs 128 bytes.
 *
 * `undefined` for anything that does not answer, which is a reason to go on
 * drawing rather than to stop.
 */
export async function textureHasAlpha(
  url: string,
): Promise<boolean | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${TEXTURE_HEADER_BYTES - 1}` },
    });
    if (!response.ok) return undefined;
    return headerHasAlpha(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }
}
