import { MAP_STYLE_OPTIONS } from "../conquest/mapStyle";
import { isPlanetId } from "../conquest/planets";
import type { RunLength, RunSkin } from "./model";

/**
 * What the Warpath setup form remembers from the last run started (issue
 * #3638). One setting holds all of it, as the host form's choices are held
 * across games. Whether a game offers a remembered choice is checked where the
 * form is drawn, since that depends on the game's unlocks, sides and maps.
 * The seed is never remembered, so a new run gets a new seed.
 */
export const SETUP_CHOICES_KEY = "warpath.setup.choices";

export interface SetupChoices {
  skin: RunSkin;
  /** Cities and Territories only: a planet id, or `random`. */
  planet: string;
  /** The hand-made map picked in place of a style, or null for a style. */
  mapId: string | null;
  side: string;
  length: RunLength;
  difficulty: number;
  ascension: number;
  loadout: string;
}

const STYLES: string[] = MAP_STYLE_OPTIONS.map((o) => o.value);
const LENGTHS: string[] = ["quick", "standard", "long"];

/**
 * The choices read back from a stored value, with any field of the wrong
 * shape left out. A setting file can be edited by hand or written by another
 * version, so nothing here trusts what it finds.
 */
export function readSetupChoices(stored: unknown): Partial<SetupChoices> {
  if (typeof stored !== "object" || stored === null) return {};
  const s = stored as Record<string, unknown>;
  const out: Partial<SetupChoices> = {};
  if (typeof s.skin === "string" && STYLES.includes(s.skin)) {
    out.skin = s.skin as RunSkin;
  }
  if (s.planet === "random" || isPlanetId(s.planet)) out.planet = s.planet;
  if (typeof s.mapId === "string" || s.mapId === null) out.mapId = s.mapId;
  if (typeof s.side === "string") out.side = s.side;
  if (typeof s.length === "string" && LENGTHS.includes(s.length)) {
    out.length = s.length as RunLength;
  }
  if (Number.isInteger(s.difficulty) && (s.difficulty as number) >= 1) {
    out.difficulty = Math.min(s.difficulty as number, 5);
  }
  if (Number.isInteger(s.ascension) && (s.ascension as number) >= 0) {
    out.ascension = s.ascension as number;
  }
  if (typeof s.loadout === "string") out.loadout = s.loadout;
  return out;
}
