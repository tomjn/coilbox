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
  /** The DDS would not fetch or would not parse. DX10 and BC7 both land here. */
  | "unreadable"
  /** The DDS read, but holds a single image rather than six cube faces. */
  | "not-a-cube-map";

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
