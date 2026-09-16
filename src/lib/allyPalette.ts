/**
 * The fixed colours a start box is drawn in, one per ally team and
 * unrelated to any player's own colour (issue #2797). Pure and hook-free,
 * like `teamColor.ts` and `allyDisplay.ts`.
 *
 * Hand-built rather than lifted from a stock qualitative set (Okabe-Ito,
 * ColorBrewer) because those include a green and/or a blue, which is
 * exactly what a start box needs to read against on a typical Spring
 * minimap (grass, water, dirt). Every hue below sits in the ~180 degree arc
 * that's left once green (roughly 75-255 degrees) and blue (roughly
 * 200-260) are cut out, so no swatch competes with the terrain it's drawn
 * over.
 *
 * Checked, not eyeballed: scored with the OKLab colour-blindness method the
 * `dataviz` skill's `validate_palette.py` uses (Machado-Oliveira-Fernandes
 * 2009 protan/deutan simulation, Delta E in OKLab x100), restricted to the
 * hue arc above, via a greedy farthest-point search over random candidates
 * that maximises the worst-case gap. Measured results for these eight, as
 * neighbours in this order (the order boxes are actually handed out in):
 * worst adjacent Delta E 14.0 simulated / 15.3 normal vision, both clear of
 * the method's floors. Taken as any two boxes side by side (all 28 pairs,
 * not just neighbours) the worst pair drops to 8.8 simulated (still over
 * the method's target of 8) and 12.3 normal vision (under its floor of
 * 15) - two boxes can still land close enough to need the ally letter to
 * tell them apart, which is exactly why the letter never comes off a box.
 */
export const ALLY_PALETTE: readonly string[] = [
  "#d24f5a", // red
  "#a90ef6", // violet
  "#ef80ed", // orchid
  "#c58207", // amber
  "#a41f8d", // magenta-purple
  "#992b2c", // maroon
  "#d14abb", // magenta-pink
  "#fb748f", // salmon
];

/** How much darker each successive lap round the palette runs, per lap. */
const LAP_DARKEN = 0.8;

/**
 * Ally index (0-based) -> its fixed CSS colour. Ally 0 always gets
 * {@link ALLY_PALETTE}'s first entry, ally 1 the second, and so on, so a
 * box keeps its colour whoever joins or leaves that ally team. Never falls
 * through to a neutral grey: once the palette runs out, an index wraps back
 * to the start of the list one shade darker per lap (clamped so it never
 * reaches black), so a 9th ally reuses the 1st hue at a visibly different
 * shade rather than an identical or blank colour.
 */
export function allyPaletteColor(ally: number): string {
  const n = ALLY_PALETTE.length;
  const lap = Math.floor(ally / n);
  const base = ALLY_PALETTE[ally % n];
  if (lap === 0) return base;
  return darken(base, Math.max(LAP_DARKEN ** lap, 0.35));
}

/** Scale a `#rrggbb`'s channels by `factor` (0..1), each rounded and clamped. */
function darken(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 0xff) * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
