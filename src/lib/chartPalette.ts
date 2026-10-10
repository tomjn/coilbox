/**
 * The categorical palette coilbox owns for charts, one slot per team (#1142).
 *
 * A game is free to give a player near black, or the same lobby placeholder as
 * everybody else, so a chart cannot rely on in-game colours being readable.
 * These eight are chosen so that, taken as any two of them (not only
 * neighbours), they stay apart for normal vision and for protan and deutan
 * simulation, and so that each clears 3:1 against the white card and against
 * the lightest dark card of every picoframe base preset. One set serves both
 * themes, so a team keeps its colour when the theme changes.
 *
 * Found by a greedy farthest-point search in OKLCH over the gamut, then kept
 * in the order the search picked them, which is also the order of slots handed
 * out: the earliest slots are the most mutually distinct, so a small match
 * gets the safest colours. `chartPalette.test.ts` re-measures all of it
 * against `BASES` and fails if an edit here breaks a floor.
 *
 * Slot order is part of the contract. A slot is never reassigned, so a team
 * that is deselected does not repaint the others.
 */
export const CHART_PALETTE: readonly string[] = [
  "#b979c5", // orchid
  "#27a902", // green
  "#1c58fc", // blue
  "#9a5835", // brown
  "#067396", // teal
  "#cf027e", // magenta
  "#4296fb", // sky
  "#fa5e75", // salmon
];
