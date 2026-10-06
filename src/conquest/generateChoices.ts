import { MAP_STYLE_OPTIONS } from "./mapStyle";
import type { MapSkin } from "./model";

/**
 * What the "Generate a map" form remembers from the last map made (issue
 * #3638). One setting holds all of it, as the host form's choices are held
 * across games. Whether a game offers a remembered choice is checked where the
 * form is drawn, since that depends on the game's unlocks and the style. The
 * seed is never remembered, so a new map gets a new seed.
 */
export const GENERATE_CHOICES_KEY = "conquest.generate.choices";

export interface GenerateChoices {
  style: MapSkin;
  layout: string;
  planet: string;
  size: string;
  radius: string;
  factions: string;
  starting: string;
  fog: boolean;
  threat: number;
  start: "edge" | "centre";
}

const STYLES = MAP_STYLE_OPTIONS.map((o) => o.value as string);

/**
 * The choices read back from a stored value, with any field of the wrong
 * shape left out. A setting file can be edited by hand or written by another
 * version, so nothing here trusts what it finds.
 */
export function readGenerateChoices(stored: unknown): Partial<GenerateChoices> {
  if (typeof stored !== "object" || stored === null) return {};
  const s = stored as Record<string, unknown>;
  const out: Partial<GenerateChoices> = {};
  if (typeof s.style === "string" && STYLES.includes(s.style)) {
    out.style = s.style as MapSkin;
  }
  for (const key of [
    "layout",
    "planet",
    "size",
    "radius",
    "factions",
    "starting",
  ] as const) {
    if (typeof s[key] === "string") out[key] = s[key] as string;
  }
  if (typeof s.fog === "boolean") out.fog = s.fog;
  if (Number.isInteger(s.threat) && (s.threat as number) >= 0) {
    out.threat = s.threat as number;
  }
  if (s.start === "edge" || s.start === "centre") out.start = s.start;
  return out;
}

/**
 * `value` when it is one of the `options` the form offers now and is not
 * greyed out, otherwise `fallback`.
 */
export function offeredOr(
  value: string | undefined,
  options: readonly { value: string; disabled?: boolean }[],
  fallback: string,
): string {
  return value !== undefined &&
    options.some((o) => o.value === value && !o.disabled)
    ? value
    : fallback;
}
