import type { StartRect } from "../bindings";
import { GRID, MIN_BOX } from "./startBoxGeometry";

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
  | "corners4"
  | "sides4";

export interface PresetDef {
  kind: PresetKind;
  label: string;
  /** How many boxes the pattern produces (allies beyond this get no box). */
  slots: number;
}

export const PRESETS: PresetDef[] = [
  { kind: "vertical", label: "Vertical", slots: 2 },
  { kind: "horizontal", label: "Horizontal", slots: 2 },
  { kind: "corners2", label: "2 corners", slots: 2 },
  { kind: "corners4", label: "4 corners", slots: 4 },
  { kind: "sides4", label: "4 sides", slots: 4 },
];

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
