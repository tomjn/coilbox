import { pick, type Rng, shuffled } from "./rng";

/**
 * Naming and faction flavour for procedural galaxies. Kept apart from the
 * generator so a distribution ({@link ConquestNames} in `profile.json`) or a
 * game (the branding catalog) can supply richer, on-theme names and even a
 * game's real lore factions, while the generator stays pure and unaware of
 * where the pools came from.
 *
 * Two sources, one schema: the branding catalog gives per-game defaults and
 * `profile.json` overrides on top (see {@link resolveConquestNames}). Both are
 * optional; with neither, the built-in pools below apply.
 */

/** A game/distribution-supplied faction, assigned in order (player first). */
export interface FactionPreset {
  name: string;
  /** `#rrggbb`; falls back to the built-in palette slot. */
  color?: string;
  /** In-game side its AI participants play (e.g. "Core"). */
  side?: string;
  /** 0..1 per-enemy-phase incursion chance; falls back to the generated value. */
  aggression?: number;
}

/** Author-supplied naming pools and faction presets for generated galaxies. */
export interface ConquestNames {
  /** Full star names, consumed (uniquely) before syllable synthesis. */
  starNames?: string[];
  /** Replaces the built-in first-syllable pool for synthesized names. */
  starPrefixes?: string[];
  /** Replaces the built-in last-syllable pool for synthesized names. */
  starSuffixes?: string[];
  /** Full faction names, used in order when no {@link factions} presets given. */
  factionNames?: string[];
  /** Lore factions with colour/side/aggression, assigned in order. */
  factions?: FactionPreset[];
}

/** Naming pools with all fallbacks resolved (synthesis pools never empty). */
export interface ResolvedNames {
  starNames: string[];
  starPrefixes: string[];
  starSuffixes: string[];
  factionNames?: string[];
  factions?: FactionPreset[];
}

/**
 * Faction colours: fully saturated so territory rings and UI chips read
 * unmistakably against the muted starfield. Player first (blue).
 */
export const FACTION_COLORS = [
  "#2f7dff", // vivid blue (player default)
  "#ff3524", // red
  "#ffb300", // amber
  "#00c853", // green
] as const;

// Curated real star names: the default `starNames` pool, drawn before any
// synthesis so a galaxy reads as a real patch of sky before falling back to
// pronounceable invented names.
const STAR_NAMES = [
  "Altair",
  "Vega",
  "Deneb",
  "Rigel",
  "Antares",
  "Sirius",
  "Procyon",
  "Capella",
  "Arcturus",
  "Aldebaran",
  "Pollux",
  "Regulus",
  "Spica",
  "Bellatrix",
  "Castor",
  "Mizar",
  "Alcor",
  "Fomalhaut",
  "Achernar",
  "Canopus",
  "Betelgeuse",
  "Polaris",
  "Adhara",
  "Alnair",
  "Alnilam",
  "Alnitak",
  "Mintaka",
  "Saiph",
  "Wezen",
  "Naos",
  "Menkar",
  "Algol",
  "Hamal",
  "Denebola",
  "Alphard",
  "Sadr",
  "Merak",
  "Dubhe",
  "Phecda",
  "Alkaid",
  "Kochab",
  "Rasalhague",
  "Shaula",
  "Sargas",
  "Nunki",
  "Atria",
  "Avior",
  "Suhail",
  "Gacrux",
  "Acrux",
];

const STAR_FIRST = [
  "Al",
  "Be",
  "Cal",
  "Dra",
  "Eri",
  "Fom",
  "Gal",
  "Hel",
  "Ika",
  "Jun",
  "Kel",
  "Lyr",
  "Mira",
  "Nadi",
  "Oph",
  "Pol",
  "Quo",
  "Rig",
  "Sar",
  "Tau",
  "Ur",
  "Vel",
  "Wez",
  "Xi",
  "Yed",
  "Zos",
  "Ac",
  "Bel",
  "Cyg",
  "Dor",
  "Eph",
  "Ferr",
  "Gith",
  "Hyd",
  "Ith",
  "Kae",
  "Lac",
  "Mor",
  "Nyx",
  "Oro",
];

const STAR_LAST = [
  "an",
  "ara",
  "bar",
  "dar",
  "el",
  "eus",
  "gol",
  "ion",
  "ith",
  "mar",
  "nak",
  "os",
  "phus",
  "ran",
  "sha",
  "tis",
  "una",
  "vor",
  "wen",
  "zar",
  "eth",
  "ix",
  "orn",
  "yr",
  "ades",
  "ephon",
  "ulon",
  "aris",
  "mede",
  "quon",
];

const FACTION_ADJ = [
  "Crimson",
  "Obsidian",
  "Auric",
  "Verdant",
  "Umbral",
  "Radiant",
  "Ashen",
  "Sovereign",
  "Iron",
  "Azure",
  "Gilded",
  "Silent",
  "Fractured",
  "Eternal",
  "Wandering",
  "Molten",
  "Frozen",
  "Scarlet",
  "Hollow",
  "Vigilant",
];

const FACTION_NOUN = [
  "Dominion",
  "Concord",
  "Ascendancy",
  "Compact",
  "Hegemony",
  "Syndicate",
  "Covenant",
  "Remnant",
  "Vanguard",
  "Coalition",
  "Directorate",
  "Imperium",
  "Collective",
  "Enclave",
  "Union",
  "Order",
  "Protectorate",
  "Legion",
  "Accord",
  "Assembly",
];

/** First non-empty array among the candidates, else `undefined`. */
function firstNonEmpty<T>(...candidates: (T[] | undefined)[]): T[] | undefined {
  for (const c of candidates) if (c && c.length > 0) return c;
  return undefined;
}

/**
 * Merge two override sources per field: a `profile.json` value wins over the
 * catalog (branding) value, which wins over nothing. Empty arrays are treated
 * as absent so an override never blanks a field. Returns `undefined` when
 * neither source sets anything, so callers can skip naming entirely.
 */
export function mergeConquestNames(
  profile?: ConquestNames,
  branding?: ConquestNames,
): ConquestNames | undefined {
  if (!profile && !branding) return undefined;
  const merged: ConquestNames = {
    starNames: firstNonEmpty(profile?.starNames, branding?.starNames),
    starPrefixes: firstNonEmpty(profile?.starPrefixes, branding?.starPrefixes),
    starSuffixes: firstNonEmpty(profile?.starSuffixes, branding?.starSuffixes),
    factionNames: firstNonEmpty(profile?.factionNames, branding?.factionNames),
    factions: profile?.factions ?? branding?.factions,
  };
  return Object.values(merged).some((v) => v !== undefined)
    ? merged
    : undefined;
}

/**
 * Resolve the effective naming pools from a single (already-merged) override:
 * each provided field wins, else the built-in default. Empty arrays are
 * treated as absent so an override never blanks a synthesis pool.
 */
export function resolveConquestNames(names?: ConquestNames): ResolvedNames {
  return {
    starNames: firstNonEmpty(names?.starNames, STAR_NAMES) ?? [],
    starPrefixes: firstNonEmpty(names?.starPrefixes, STAR_FIRST) ?? STAR_FIRST,
    starSuffixes: firstNonEmpty(names?.starSuffixes, STAR_LAST) ?? STAR_LAST,
    factionNames: firstNonEmpty(names?.factionNames),
    factions: names?.factions,
  };
}

/**
 * A star namer for one generation run: hands out unique names, drawing from
 * the explicit {@link ResolvedNames.starNames} pool first (shuffled), then
 * synthesizing pronounceable names from the prefix/suffix pools, appending a
 * number as a last resort so it always terminates.
 */
export function makeStarNamer(
  rng: Rng,
  names: ResolvedNames,
): (used: Set<string>) => string {
  const pool = names.starNames.length > 0 ? shuffled(rng, names.starNames) : [];
  let poolIdx = 0;
  return (used: Set<string>): string => {
    while (poolIdx < pool.length) {
      const name = pool[poolIdx++];
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    for (let attempt = 0; ; attempt++) {
      let name = pick(rng, names.starPrefixes) + pick(rng, names.starSuffixes);
      if (attempt > 8) name = `${name} ${Math.floor(rng() * 90) + 10}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
}

/** A fully-resolved faction: name + colour, with optional side/aggression. */
export interface FactionSpec {
  name: string;
  color: string;
  side?: string;
  aggression?: number;
}

/**
 * Build `count` faction specs (player first): a preset in that slot wins for
 * every field it sets; otherwise the name comes from an explicit
 * `factionNames` list or a synthesized `<adjective> <noun>`, and the colour
 * cycles the built-in palette. Draws two shuffles up front so the synthesized
 * fallback is deterministic regardless of how many presets are supplied.
 */
export function factionSpecs(
  rng: Rng,
  names: ResolvedNames,
  count: number,
): FactionSpec[] {
  const nouns = shuffled(rng, FACTION_NOUN);
  const synthesized = shuffled(rng, FACTION_ADJ).map(
    (adj, i) => `${adj} ${nouns[i % nouns.length]}`,
  );
  const fallback =
    names.factionNames && names.factionNames.length > 0
      ? names.factionNames
      : synthesized;
  const out: FactionSpec[] = [];
  for (let i = 0; i < count; i++) {
    const preset = names.factions?.[i];
    out.push({
      name: preset?.name ?? fallback[i % fallback.length] ?? `Faction ${i + 1}`,
      color: preset?.color ?? FACTION_COLORS[i % FACTION_COLORS.length],
      side: preset?.side,
      aggression: preset?.aggression,
    });
  }
  return out;
}
