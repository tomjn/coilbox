import { msg } from "@lingui/core/macro";

/** mapcompile's `-ct` choices, shared by the Compile page and settings. */
export const CT_OPTIONS = [
  { value: "1", label: msg`1 — No compression` },
  { value: "2", label: msg`2 — Fast (compare last N tiles)` },
  { value: "3", label: msg`3 — Insane (whole map; very slow)` },
  { value: "4", label: msg`4 — High quality fast` },
];
