/**
 * What to say about a map's sky, and when to say nothing.
 *
 * A map that declares no skybox and a map whose skybox coilbox cannot read both
 * drew the same flat colour, so a preview that was quietly wrong looked exactly
 * like one that was right (#1650). Only the second is coilbox's bug.
 *
 * Same split as a unit's build pic (#1625), and deliberately as quiet: a short
 * word on the preview and the reason on hover, not a banner.
 */

/** Why a declared skybox is not the sky on screen. */
export type SkyboxProblem =
  /** The DDS would not fetch or would not read. DX10 and BC7 both land here. */
  | "unreadable"
  /** The DDS read fine, but holds a single image rather than six cube faces. */
  | "not-a-cube-map";

/** What `DDSLoader.parse` hands back, as far as reading a sky from it goes. */
export interface ParsedDds {
  /** A three pixel format, or null when the loader never worked the file out. */
  format: number | null;
  isCubemap: boolean;
  /** `mipmapCount` entries per face, so six times that for a cube map. */
  mipmaps: readonly unknown[];
  mipmapCount: number;
}

/**
 * Whether a parsed DDS can be the sky, and why not when it cannot. Null means
 * it can.
 *
 * `DDSLoader.parse` does not throw on a file it cannot read. It logs, and hands
 * back the empty object it started with, whose `isCubemap` is false. So asking
 * "is it a cube map" first would answer "this map's sky is not a cube map" for
 * every DX10 and BC7 file, which are the two the issue is actually about. A
 * null format is the loader saying it never worked the file out, so that
 * question comes first.
 */
export function skyboxFromDds(data: ParsedDds): SkyboxProblem | null {
  if (data.format === null || data.format === undefined) return "unreadable";
  if (!data.isCubemap) return "not-a-cube-map";
  // A cube map missing faces is a broken file rather than a flat picture. The
  // loader has already given up on it and returned what it had.
  if (data.mipmaps.length / data.mipmapCount !== 6) return "unreadable";
  return null;
}

/**
 * The word for the preview and the reason for its tooltip, or null when there
 * is nothing to say.
 *
 * Null covers both a map that declares no skybox, where a flat sky is the right
 * answer, and a skybox that read and is on screen.
 */
export function skyboxNote(
  problem?: SkyboxProblem | null,
): { label: string; title: string } | null {
  switch (problem) {
    case "unreadable":
      return {
        label: "flat sky",
        title:
          "Coilbox cannot read this map's skybox. The map ships one, in a DDS format the reader does not handle, so the preview draws the map's sky colour instead.",
      };
    case "not-a-cube-map":
      return {
        label: "flat sky",
        title:
          "This map's skybox is a DDS, but not a cube map, so the preview draws the map's sky colour instead.",
      };
    default:
      return null;
  }
}
