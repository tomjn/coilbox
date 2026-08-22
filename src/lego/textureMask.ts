/**
 * Spotting an imported unit whose team-colour mask coilbox threw away.
 *
 * An `.s3o` keeps the mask in the alpha of the texture the unit is painted with.
 * Until issue #1909 the store re-encoded a `.bmp` or a `.tga` to an RGB PNG on
 * the way in, on the belief that the mask was the second texture's business, so
 * every unit imported from a legacy game before that fix has a stored texture
 * with its markings cut out. The store is keyed by content, so those bytes are
 * byte-identical to themselves for ever and nothing re-fetches them on its own.
 *
 * #1909 stopped it showing up as a unit painted entirely in the player's colour,
 * by skipping the team colour when there is no alpha to read. That leaves the
 * unit merely missing its markings and saying nothing about why, which is what
 * this is for (#1912).
 *
 * Pure, so the rule can be tested without a webview or a texture store.
 */

import type { LegoTexture } from "./model";

/**
 * What can be done about a unit whose stored texture has lost its mask, or
 * `null` when nothing has been lost.
 *
 * `"refresh"` when the file it was read from is still there, which is one click
 * in the texture panel. `"reimport"` when it is not, which is every unit that
 * came out of a packed archive: the import unpacked its texture into a temp
 * folder to read it, and an archive holds no path to hand back (#1903).
 */
export type MaskLoss = "refresh" | "reimport" | null;

/**
 * Whether this unit's markings were lost on the way into the store, given what
 * the stored file's header says about its alpha channel.
 *
 * `alpha` is {@link import("../lib/textureAlpha").textureHasAlpha}'s answer:
 * `undefined` for bytes it does not read, which is a reason to trust the file
 * rather than to distrust it.
 *
 * A stored `.png` with no alpha is the exact signature of the bug and nothing
 * else. The store only ever writes a `.png` when it re-encodes a `.bmp` or a
 * `.tga`, and since #1909 that encode is always RGBA, so the current code cannot
 * produce one. Every other extension is stored as it arrived, and a `.dds` or a
 * `.jpg` without alpha is the game's own file telling the truth about itself:
 * warning about those would be noise on a unit that never had markings.
 */
export function maskLoss(
  texture: LegoTexture | undefined,
  alpha: boolean | undefined,
): MaskLoss {
  if (!texture?.key || alpha !== false) return null;
  if (!texture.key.toLowerCase().endsWith(".png")) return null;
  return texture.source ? "refresh" : "reimport";
}

/** What to tell somebody looking at a unit missing its markings. */
export function maskLossNote(loss: MaskLoss): string | null {
  if (loss === null) return null;
  const why =
    "This texture has no alpha channel, and that is where the model keeps its team-colour mask, so the unit draws with no markings. Coilbox stored it before it started keeping the alpha.";
  return loss === "refresh"
    ? `${why} Refresh re-reads the file it came from and puts the mask back.`
    : `${why} There is no file to re-read, because it came out of a packed archive, so importing the unit again is what gets the mask back.`;
}
