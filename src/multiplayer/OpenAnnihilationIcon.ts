import { createLucideIcon } from "lucide-react";

/**
 * A rounded box with the letters O and A, drawn in Lucide's style so it sits
 * beside the other settings icons. Open Annihilation's own logo is not ours to
 * copy, so this is an outline of the initials and nothing more. The letters
 * are strokes rather than text, so no font is involved.
 */
export const OpenAnnihilationIcon = createLucideIcon("open-annihilation", [
  ["rect", { width: "20", height: "20", x: "2", y: "2", rx: "5", key: "box" }],
  [
    "rect",
    {
      width: "5",
      height: "8",
      x: "6",
      y: "8",
      rx: "2",
      strokeWidth: "1.5",
      key: "o",
    },
  ],
  ["path", { d: "M13.5 16 16 8l2.5 8", strokeWidth: "1.5", key: "a" }],
  ["path", { d: "M14.4 13.5h3.2", strokeWidth: "1.5", key: "bar" }],
]);
