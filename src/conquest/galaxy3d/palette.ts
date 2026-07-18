import { hashString } from "./layout";

/**
 * Curated backdrop palettes so each galaxy reads as its own place: a nebula
 * swathe plus matching starfield tints, more varied than the single restrained
 * default. Picked deterministically from the galaxy id, and used only as a
 * fallback for galaxies whose theme sets no palette of its own — authored and
 * bundled galaxies keep their intended look.
 *
 * Kept a touch more muted than the run map's bolder set: conquest is a longer,
 * calmer strategic view, not an arcade run. The first entry is the classic
 * blue/violet default, so some galaxies still land on the familiar sky.
 */
export const GALAXY_PALETTES: { nebula: string[]; stars: string[] }[] = [
  { nebula: ["#4756b8", "#8a4bb8", "#2a6f8f"], stars: ["#cfe0ff", "#a9c2ff"] },
  { nebula: ["#c85a3c", "#e0913f", "#5c2a18"], stars: ["#ffd9b0", "#ffc088"] },
  { nebula: ["#2fae7a", "#2f8fae", "#123a2e"], stars: ["#c8ffe6", "#a6f0d4"] },
  { nebula: ["#9a5bd0", "#d05ba0", "#3a1a52"], stars: ["#e6ccff", "#f0c0e0"] },
  { nebula: ["#d0a83c", "#c8603a", "#4a331a"], stars: ["#fff0c8", "#ffd9a8"] },
  { nebula: ["#3a86c8", "#5f6fd0", "#12294a"], stars: ["#cfe0ff", "#b8c0ff"] },
  { nebula: ["#c84a6a", "#d06a4a", "#4a1220"], stars: ["#ffd0d8", "#ffb8b0"] },
];

/** Backdrop palette for a galaxy, chosen deterministically from its id. */
export function galaxyPalette(id: string): {
  nebula: string[];
  stars: string[];
} {
  return GALAXY_PALETTES[hashString(id) % GALAXY_PALETTES.length];
}
