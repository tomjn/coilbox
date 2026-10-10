/**
 * Turning a density field into colours (issue #1151).
 *
 * The field is read against its own brightest cell and not an absolute scale.
 * A short match would otherwise look empty and a long one hot all over, when
 * the question a heatmap answers is "where, compared with everywhere else".
 * That hides the scale on purpose, so whatever draws this must also draw a
 * legend that states the peak. `HeatLegend.tsx` is that legend.
 *
 * Pure, like `heatField.ts`: bytes in, bytes out.
 */

import type { HeatField } from "./heatField";

/** The density layers that have a ramp of their own (#3890). */
export type HeatKind = "buildings" | "orders" | "deaths";

/**
 * The ramps, least to most, as `#rrggbb`, one for each kind of density layer so
 * that two stacked on one map can be told apart.
 *
 * Each ramp is one hue family that gets lighter as density rises.
 * `heatRamp.test.ts` measures that every stop is lighter than the one before
 * for normal vision and for protan and deutan simulation, and that any two ramps
 * stay apart at the same stop under all three, using `NORMAL_FLOOR` and
 * `CVD_TARGET` from `chartPalette.ts`.
 *
 * - buildings: violet through magenta to pink, chosen in #1151 when it was the
 *   only layer. Magenta is the colour a map is least likely to be.
 * - orders: deep cyan to pale aqua. Seen on a tan map and a green one, the
 *   green leaning teal this replaced was a grey green wash at low density,
 *   because that is the colour of terrain. Cyan is not. It stops short of
 *   blue, because blue and magenta are close on the axis a deutan reader
 *   keeps: buildings against orders measures 10.7 for deutan vision at the
 *   closest stop, where the teal measured 9.0 and a blue ramp 2.1.
 * - deaths: brown through orange to pale amber. It differs from both by hue and
 *   it is the one colour of the three that carries a warning.
 *
 * None is a red to green ramp, and no two are red against green. Where a map
 * is itself cyan, as water can be, the legend bar beside the layer's name says
 * which layer is which.
 *
 * There is no fourth ramp, and damage is drawn in the deaths ramp with only
 * one of the two shown at a time. Red and green colour blindness leaves one
 * axis of hue, from blue to yellow, and the three ramps sit at its blue end,
 * its middle and its yellow end. Of 9,000 single hue ramps tried against these
 * three (every 5 degrees of hue, five saturations, 25 ranges of lightness),
 * the 310 that kept `CVD_TARGET` and `NORMAL_FLOOR` at every stop all began at
 * 8% lightness: they passed by being darker than the others at the same stop,
 * which on a map reads as the same colour at a lower density.
 *
 * The same ramps serve both themes. They are drawn over the map's own texture
 * and never over the card, so the theme does not change what is behind them.
 */
export const HEAT_RAMPS: Readonly<Record<HeatKind, readonly string[]>> = {
  buildings: ["#551ea6", "#8628b8", "#b436b6", "#e25aae", "#ffa0cc"],
  orders: ["#00788f", "#00a0b8", "#0ac8dc", "#54e4f2", "#aaf6fc"],
  deaths: ["#7a3b00", "#b05a00", "#e07a00", "#ff9f40", "#ffd070"],
};

/**
 * Which ramp each density layer is drawn in. The one place that decides, so a
 * layer keeps its colour on the replay's map, in the 3D terrain, in its legend,
 * on a map's own page and in the exported picture. The replay's toggles are
 * `density` (buildings ordered), `orderDensity`, `deaths` and `damage`, and the
 * last two share a ramp and are never drawn together. A map's page names its
 * layers `buildings`, `defence`, `economy`, `orders` and `deaths`, and the
 * three building layers are all buildings.
 */
export const HEAT_KIND_OF_LAYER = {
  density: "buildings",
  orderDensity: "orders",
  buildings: "buildings",
  defence: "buildings",
  economy: "buildings",
  orders: "orders",
  deaths: "deaths",
  damage: "deaths",
} as const satisfies Record<string, HeatKind>;

/**
 * How opaque the least and the most dense drawn cells are, 0 to 1.
 *
 * Opacity rises with density, so a quiet area lets the map show through and a
 * hotspot covers it. Both ends are display choices with no measurement behind
 * them. The top stops short of 1 so the relief under a hotspot is still there.
 */
export const HEAT_ALPHA_MIN = 0.3;
export const HEAT_ALPHA_MAX = 0.9;

/**
 * The power a cell's fraction of the peak is raised to before it is coloured.
 *
 * A match has one spot far busier than the rest, usually a block of identical
 * buildings, and drawn in proportion everything else sits in the faintest
 * tenth of the ramp. Seen on real replays that was a picture of one dot. The
 * square root spreads the low end out, so a base ordered at a quarter of the
 * peak's rate is drawn half way up the ramp. The order of the colours is
 * unchanged, and the legend says least to most and gives no scale between.
 * A display choice: 0.5 is the usual value and nothing here measured it.
 */
export const HEAT_GAMMA = 0.5;

/**
 * The fraction of the peak under which a cell is not drawn at all.
 *
 * A display choice with no measurement behind it. Opacity already falls with
 * density, so this only removes the faint skirt round every blob and the
 * single stray event that would otherwise leave a smudge. It decides what is
 * drawn and never what is counted: the field and its peak are worked out from
 * every point before this is applied.
 */
export const DEFAULT_HEAT_THRESHOLD = 0.04;

export interface HeatPaintOptions {
  /** Whose ramp to paint in. Default buildings. */
  kind?: HeatKind;
  /** Fraction of the peak below which nothing is drawn. */
  threshold?: number;
  /**
   * Write the rows south first. A three.js data texture has its first row at
   * the bottom of the UV square, and the terrain's UVs put the bottom at the
   * map's south edge. A 2D canvas wants north first, which is the default.
   */
  southFirst?: boolean;
}

type Rgb = [number, number, number];

const STOPS: Record<HeatKind, Rgb[]> = Object.fromEntries(
  Object.entries(HEAT_RAMPS).map(([kind, ramp]) => [
    kind,
    ramp.map((hex) => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ]),
  ]),
) as Record<HeatKind, Rgb[]>;

/** The ramp's colour along its length, 0 for the first stop and 1 for the last. */
function rampAt(t: number, kind: HeatKind): Rgb {
  const stops = STOPS[kind];
  const clamped = Math.min(1, Math.max(0, t));
  const at = clamped * (stops.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(stops.length - 1, lo + 1);
  const f = at - lo;
  const a = stops[lo];
  const b = stops[hi];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** How far up the ramp a cell at fraction `t` of the peak is drawn. */
const drawnAt = (t: number) => Math.min(1, Math.max(0, t)) ** HEAT_GAMMA;

/** The colour of a cell at fraction `t` of the peak. */
export function heatColour(t: number, kind: HeatKind = "buildings"): Rgb {
  return rampAt(drawnAt(t), kind);
}

/** How opaque a cell at fraction `t` of the peak is, 0 to 1. 0 under the
 *  threshold. */
export function heatAlpha(
  t: number,
  threshold = DEFAULT_HEAT_THRESHOLD,
): number {
  if (!(t > 0) || t < threshold) return 0;
  return HEAT_ALPHA_MIN + (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN) * drawnAt(t);
}

/**
 * The field as RGBA bytes, one pixel per cell, with straight alpha.
 *
 * A cell that is not drawn still carries the ramp's lowest colour under its
 * zero alpha. Whatever stretches these pixels over a map blends neighbours
 * together, and a transparent black one would put a dark rim round every blob.
 *
 * An empty field gives all zero alpha.
 */
export function paintHeatField(
  field: HeatField,
  options: HeatPaintOptions = {},
): Uint8ClampedArray {
  const { width, height, peak } = field;
  const threshold = options.threshold ?? DEFAULT_HEAT_THRESHOLD;
  const out = new Uint8ClampedArray(width * height * 4);
  const kind = options.kind ?? "buildings";
  const floor = STOPS[kind][0];
  for (let row = 0; row < height; row++) {
    const target = options.southFirst ? height - 1 - row : row;
    for (let col = 0; col < width; col++) {
      const t = peak > 0 ? field.values[row * width + col] / peak : 0;
      const alpha = heatAlpha(t, threshold);
      const [r, g, b] = alpha > 0 ? heatColour(t, kind) : floor;
      const o = (target * width + col) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** The ramp as a CSS gradient, least on the left, for a legend. */
export function heatGradientCss(kind: HeatKind): string {
  const ramp = HEAT_RAMPS[kind];
  const stops = ramp.map((_, i) => {
    const t = i / (ramp.length - 1);
    const alpha = HEAT_ALPHA_MIN + (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN) * t;
    const [r, g, b] = rampAt(t, kind);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)}) ${Math.round(t * 100)}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
