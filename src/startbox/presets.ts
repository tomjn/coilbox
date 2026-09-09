import { GRID, MIN_BOX, type StartRect } from "./geometry";

/**
 * One-click start-box split presets (issue #334), mirroring BYAR-Chobby's
 * vertical/horizontal/corner/side splits. Each preset is a fixed pattern of
 * `slots` boxes on the 0..GRID grid; the caller assigns slots to allies in
 * order, so patterns list diagonally-opposed positions first — with 2 allies
 * "4 corners" still puts them in facing corners rather than side by side.
 * `sizePct` is the box depth as a percentage of the map dimension.
 */
export type PresetKind =
  | "vertical"
  | "horizontal"
  | "corners2"
  | "corners2alt"
  | "corners4"
  | "sides4";

export interface PresetDef {
  kind: PresetKind;
  label: string;
  /** How many boxes the pattern produces (allies beyond this get no box). */
  slots: number;
}

// Both 2-corner diagonals are offered, because a map has two and which one
// plays well is a property of the map rather than a default anyone would accept.
// Labelled by compass points: the pattern is the whole of what a corner preset
// is, so naming the direction says more than "2 corners" twice would.
export const PRESETS: PresetDef[] = [
  { kind: "vertical", label: "Vertical", slots: 2 },
  { kind: "horizontal", label: "Horizontal", slots: 2 },
  { kind: "corners2", label: "NW-SE", slots: 2 },
  { kind: "corners2alt", label: "NE-SW", slots: 2 },
  { kind: "corners4", label: "4 corners", slots: 4 },
  { kind: "sides4", label: "4 sides", slots: 4 },
];

/**
 * Which of a preset's slots a roster actually takes, as slot indices.
 *
 * A preset has a fixed number of slots and a roster rarely has that many allies,
 * so "4 sides" with two allies can only hand out two boxes. Taking the first two
 * every time means west and east are the only pair that preset can ever produce
 * and north/south is unreachable, which is what `start` is for: it moves the
 * window along, wrapping, so every pair the pattern holds is a click away.
 */
export function slotWindow(
  slotCount: number,
  allyCount: number,
  start: number,
): number[] {
  const take = Math.min(slotCount, allyCount);
  if (take <= 0) return [];
  const from = ((start % slotCount) + slotCount) % slotCount;
  return Array.from({ length: take }, (_, i) => (from + i) % slotCount);
}

/**
 * The next window start after `start` for a preset with `slotCount` slots and
 * `allyCount` allies. Advances by a whole roster, so clicking "4 sides" twice
 * with two allies moves from west/east to north/south rather than shuffling by
 * one. A preset with no spare slots stays where it is, so re-applying it is
 * simply re-applying it.
 */
export function nextSlotStart(
  slotCount: number,
  allyCount: number,
  start: number,
): number {
  if (allyCount >= slotCount) return 0;
  return (start + allyCount) % slotCount;
}

/**
 * Rotate an ally order one step left, the change to slot assignment that matches
 * one {@link rotateBoxes} of the boxes those slots produced. Applying a preset
 * with the rotated order reproduces what rotating the live boxes just drew, so
 * the swap button moves the presets along with the boxes rather than leaving the
 * next apply to undo it.
 */
export function rotateOrder(order: number[]): number[] {
  if (order.length < 2) return order;
  return [...order.slice(1), order[0]];
}

/**
 * Move every box on to the next ally that has one, wrapping at the end. With
 * two allies that is a straight swap, which is what it is usually wanted for:
 * a preset assigns its slots in ally order, and that order is not always the
 * one you want to play. Allies without a box are left out rather than pulled
 * into the cycle, so nobody loses a box to a button labelled swap.
 */
export function rotateBoxes(
  rects: Record<string, StartRect>,
  allyList: number[],
): Record<string, StartRect> {
  const holders = allyList.filter((a) => rects[String(a)]);
  if (holders.length < 2) return rects;
  const out = { ...rects };
  holders.forEach((ally, i) => {
    const from = holders[(i + holders.length - 1) % holders.length];
    out[String(ally)] = rects[String(from)];
  });
  return out;
}

/**
 * Box depth on the grid for a size percentage, clamped so a box is never
 * thinner than MIN_BOX nor deeper than half the map (opposed boxes would
 * overlap past 50%).
 */
export const sizeToGrid = (pct: number): number =>
  Math.max(MIN_BOX, Math.min(GRID / 2, Math.round((pct / 100) * GRID)));

/** The preset's boxes in ally-assignment order. */
export function presetBoxes(kind: PresetKind, sizePct: number): StartRect[] {
  const s = sizeToGrid(sizePct);
  const half = GRID / 2;
  // Side boxes are edge-centred squares. Their depth is capped at a third of
  // the map — beyond that a side box would overlap its perpendicular
  // neighbours' corners.
  const sd = Math.min(s, Math.floor(GRID / 3));
  const lo = half - Math.floor(sd / 2);
  const hi = lo + sd;
  const nw = { left: 0, top: 0, right: s, bottom: s };
  const ne = { left: GRID - s, top: 0, right: GRID, bottom: s };
  const sw = { left: 0, top: GRID - s, right: s, bottom: GRID };
  const se = { left: GRID - s, top: GRID - s, right: GRID, bottom: GRID };
  switch (kind) {
    case "vertical":
      return [
        { left: 0, top: 0, right: s, bottom: GRID },
        { left: GRID - s, top: 0, right: GRID, bottom: GRID },
      ];
    case "horizontal":
      return [
        { left: 0, top: 0, right: GRID, bottom: s },
        { left: 0, top: GRID - s, right: GRID, bottom: GRID },
      ];
    case "corners2":
      return [nw, se];
    case "corners2alt":
      return [ne, sw];
    case "corners4":
      return [nw, se, ne, sw];
    case "sides4":
      return [
        { left: 0, top: lo, right: sd, bottom: hi },
        { left: GRID - sd, top: lo, right: GRID, bottom: hi },
        { left: lo, top: 0, right: hi, bottom: sd },
        { left: lo, top: GRID - sd, right: hi, bottom: GRID },
      ];
  }
}
