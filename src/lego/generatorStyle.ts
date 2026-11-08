/**
 * A saved look the generator applies to the units it makes (issue #3237).
 *
 * A style holds a colourway, preferred part shapes, a proportion tendency and a
 * detail density. It biases the generator's choices and never changes a job's
 * rules: a proportion is still rolled inside the job's range, a slot count
 * inside the slot's, and a covering part is still one of the shapes the
 * covering allows. With no style every choice is made as before.
 *
 * - The colourway recolours each module part to the same shape in that
 *   colourway, where the pack has one. The covering, wheels and treads take
 *   the chassis's colourway (`coverParts`), so they follow.
 * - The shapes narrow the covering's parts to those shapes, where any of them
 *   is allowed there.
 * - Stocky skews heights low and widths, bulk and covering thickness high.
 *   Lean does the opposite.
 * - Dense skews slot counts high and covers with smaller parts, so more of
 *   them. Sparse skews counts low and covers with the fewest parts.
 *
 * Styles are kept by name in the app's settings (`GENERATOR_STYLES_KEY`), as
 * the workshop keeps its projects, so several can exist at once. A style is
 * also a small file of its own (`serializeStyleFile`), which is how it is
 * copied to another install or handed to another game maker. A generated unit
 * records the style that made it, so a reroll applies it again.
 */

import type { Rng } from "../conquest/rng";

export const PROPORTION_TENDENCIES = ["stocky", "lean"] as const;
export type ProportionTendency = (typeof PROPORTION_TENDENCIES)[number];

export const DETAIL_DENSITIES = ["sparse", "dense"] as const;
export type DetailDensity = (typeof DETAIL_DENSITIES)[number];

export interface GeneratorStyle {
  id: string;
  name: string;
  /** A colourway id from the pack. Left off, colours are as generated. */
  colourway?: string;
  /** Part shapes from the pack (`LegoPartInfo.shape`) the covering prefers.
   *  Empty prefers none. */
  shapes: string[];
  proportions?: ProportionTendency;
  detail?: DetailDensity;
}

/** The settings key the saved styles live under. */
export const GENERATOR_STYLES_KEY = "lego.generatorStyles";

/** What a style file says it is, so another JSON file is not taken for one. */
export const STYLE_FILE_KIND = "coilbox-generator-style";
const STYLE_FILE_VERSION = 1;

/** Which way a roll is pushed, or not at all. */
export type Lean = "high" | "low" | undefined;

/**
 * A PRNG whose rolls are pushed towards one end of 0 to 1 and still cover all
 * of it: `u` squared for low, its mirror for high. Only multiplication, so it
 * gives the same answer in every engine (#5113). Not pushed, it is `rng`.
 */
export function skewed(rng: Rng, lean: Lean): Rng {
  if (lean === "low") {
    return () => {
      const u = rng();
      return u * u;
    };
  }
  if (lean === "high") {
    return () => {
      const u = 1 - rng();
      return 1 - u * u;
    };
  }
  return rng;
}

/** Proportions that make a unit taller, and ones that make it wider. */
const TALL = new Set([
  "legLength",
  "bodyHeight",
  "wheelHeight",
  "trackHeight",
  "hullHeight",
  "deckHeight",
  "turretHeight",
]);
const WIDE = new Set(["stance", "trackWidth", "hullWidth"]);

/** Which way a style pushes a proportion of the body plan, by id. */
export function proportionLean(
  style: GeneratorStyle | undefined,
  id: string,
): Lean {
  const wide = style?.proportions === "stocky";
  if (!style?.proportions) return undefined;
  if (TALL.has(id)) return wide ? "low" : "high";
  if (WIDE.has(id)) return wide ? "high" : "low";
  return undefined;
}

/** Which way a style pushes the chassis's bulk and the covering's thickness. */
export function girthLean(style: GeneratorStyle | undefined): Lean {
  if (!style?.proportions) return undefined;
  return style.proportions === "stocky" ? "high" : "low";
}

/** Which way a style pushes how many modules a slot gets. */
export function countLean(style: GeneratorStyle | undefined): Lean {
  if (!style?.detail) return undefined;
  return style.detail === "dense" ? "high" : "low";
}

/** The shapes a choice allows that the style prefers, or all it allows when it
 *  prefers none of them. */
export function preferredShapes(
  allowed: readonly string[],
  style: GeneratorStyle | undefined,
): readonly string[] {
  const preferred = allowed.filter((shape) => style?.shapes.includes(shape));
  return preferred.length > 0 ? preferred : allowed;
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (values as readonly string[]).includes(value)
  );
}

/** A style from stored JSON, or null for anything that is not one. Unknown
 *  values for the optional fields are dropped rather than refused. */
export function parseStyle(value: unknown): GeneratorStyle | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id === "") return null;
  if (typeof v.name !== "string" || v.name.trim() === "") return null;
  const shapes = Array.isArray(v.shapes)
    ? [...new Set(v.shapes.filter((s): s is string => typeof s === "string"))]
    : [];
  return {
    id: v.id,
    name: v.name.trim(),
    ...(typeof v.colourway === "string" && v.colourway !== ""
      ? { colourway: v.colourway }
      : {}),
    shapes,
    ...(isOneOf(PROPORTION_TENDENCIES, v.proportions)
      ? { proportions: v.proportions }
      : {}),
    ...(isOneOf(DETAIL_DENSITIES, v.detail) ? { detail: v.detail } : {}),
  };
}

/** Every readable style in a stored list, skipping any that are not. */
export function parseStyles(value: unknown): GeneratorStyle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => parseStyle(item) ?? []);
}

/** A style as a file of its own. */
export function serializeStyleFile(style: GeneratorStyle): string {
  return `${JSON.stringify(
    { kind: STYLE_FILE_KIND, version: STYLE_FILE_VERSION, style },
    null,
    2,
  )}\n`;
}

/** The style in a file, or null when the file is not a style file. */
export function parseStyleFile(text: string): GeneratorStyle | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== STYLE_FILE_KIND) return null;
  return parseStyle(d.style);
}

/** `name`, or "name 2", "name 3" and on, whichever no style in `taken` has. */
export function freeStyleName(name: string, taken: readonly GeneratorStyle[]) {
  const names = new Set(taken.map((s) => s.name.trim().toLowerCase()));
  const base = name.trim();
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const next = `${base} ${n}`;
    if (!names.has(next.toLowerCase())) return next;
  }
}

/**
 * `style` added to `styles`, under a new id and a name none of them has. A
 * style loaded from a file comes in this way too, so it never replaces one
 * already saved.
 */
export function withCopy(
  styles: readonly GeneratorStyle[],
  style: GeneratorStyle,
  id: string,
): GeneratorStyle[] {
  return [...styles, { ...style, id, name: freeStyleName(style.name, styles) }];
}

/** `styles` with the one of `style.id` replaced by it. */
export function withStyle(
  styles: readonly GeneratorStyle[],
  style: GeneratorStyle,
): GeneratorStyle[] {
  return styles.map((s) => (s.id === style.id ? style : s));
}
