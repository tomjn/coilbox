import type { UnitDisplay } from "./bindings";

/**
 * What to draw in place of a unit's build pic, and what to say about it.
 *
 * "This game ships no build pic for this unit" and "coilbox cannot read the one
 * it ships" are different answers, and only the second is coilbox's bug. They
 * used to look the same everywhere, so a game that came out half empty never
 * said why (#1625).
 *
 * `display` absent means the build pics have not come back yet, which is a
 * third thing again and claims nothing.
 */
export function buildPicMissing(display?: UnitDisplay): {
  label: string;
  title?: string;
} {
  switch (display?.iconSkipped) {
    case "undecodable":
    case "encode-failed":
      return {
        label: "bad pic",
        title:
          "Coilbox cannot read this unit's build pic. The game ships one, in a format the decoder does not handle.",
      };
    case "no-source":
      return {
        label: "no pic",
        title: "This game ships no build pic for this unit.",
      };
    default:
      return { label: "no pic" };
  }
}
