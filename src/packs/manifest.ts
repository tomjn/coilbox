import {
  type GameIdentity,
  parseGameIdentity,
} from "../container/gameIdentity";
import { isRealEngineVersion } from "../content/engineVersion";
import {
  type ContentRequirement,
  dedupeRequirements,
  engineVersionRequirement,
  exactMapRequirement,
} from "../content/resolveContent";
import { parsePresetJson, type SkirmishPreset } from "../play/presets";
import {
  decodePackEnvelope,
  encodePackEnvelope,
  type PackDecodeResult,
} from "./envelope";

/**
 * A shareable setup pack (issue #415): the Prism/mrpack pattern applied to
 * coilbox. References, not content. A collection of games (by installed
 * archive name, optionally with a rapid tag for downloading it fresh) and
 * maps, either optional but not both, plus optionally bundled skirmish
 * presets. Small enough to paste in chat. Importing resolves every reference
 * through issue #387's `ResolveContentGate` before anything is applied.
 */
export interface SetupPackGame extends GameIdentity {
  /** The exact installed archive/game name, matched the same way presets and
   * campaigns already do (`exactGameRequirement`'s convention). Used as the
   * download key too when `rapidTag` isn't given (best-effort by name). A pack
   * pins a build, so unlike the shared shape this is always present. */
  name: string;
  /** Rapid tag to fetch this game by, when known. Lets the recipient pull the
   * exact intended build rather than guessing from `name`. */
  rapidTag?: string;
}

/** A preset bundled with a pack. Same shape `parsePresetJson` already
 * validates for shared preset files, minus the identity/timestamp fields a
 * fresh import always mints. */
export type SetupPackPreset = NonNullable<
  ReturnType<typeof parsePresetJson>
> & {
  name: string;
};

export interface SetupPackManifest {
  /** What the collection is called, so a code pasted with no hub item behind
   * it can name itself on arrival. */
  title?: string;
  /** Only ever set by packs shared before a pack became a collection. Still
   * resolved on import, never authored. */
  engineVersion?: string;
  games?: SetupPackGame[];
  maps?: string[];
  presets?: SetupPackPreset[];
}

/** One entry of a pack's game list, or null when the shape is wrong. */
function parsePackGame(value: unknown): SetupPackGame | null {
  if (typeof value !== "object" || value === null) return null;
  const g = value as Record<string, unknown>;
  if (typeof g.name !== "string" || !g.name.trim()) return null;
  if (g.rapidTag !== undefined && typeof g.rapidTag !== "string") return null;
  // A pack shared before issue #1335 carries no shortname, which reads as an
  // identity with only a name rather than a malformed pack.
  const identity = parseGameIdentity(g) ?? {};
  return {
    name: g.name,
    ...(identity.shortname ? { shortname: identity.shortname } : {}),
    ...(typeof g.rapidTag === "string" && g.rapidTag.trim()
      ? { rapidTag: g.rapidTag }
      : {}),
  };
}

/**
 * Validate an untrusted decoded payload into a `SetupPackManifest`, or `null`
 * on any shape mismatch, including a pack holding neither a game nor a map,
 * which is a pack authoring mistake rather than something to silently accept.
 */
export function parseSetupPackManifest(
  value: unknown,
): SetupPackManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const d = value as Record<string, unknown>;

  if (d.engineVersion !== undefined && typeof d.engineVersion !== "string") {
    return null;
  }
  // A present-but-unreal engineVersion (blank, or a leaked path fragment such
  // as the legacy `.spring`) reads as "no engine pinned" rather than a
  // malformed pack (issue #1334).
  const engineVersion = isRealEngineVersion(d.engineVersion as string)
    ? (d.engineVersion as string).trim()
    : undefined;

  if (d.title !== undefined && typeof d.title !== "string") return null;
  const title =
    typeof d.title === "string" && d.title.trim() ? d.title.trim() : undefined;

  // `game` is the single-game shape every pack used before a pack became a
  // collection. Read as a one-entry list so those codes still import.
  const rawGames = Array.isArray(d.games)
    ? d.games
    : d.game !== undefined
      ? [d.game]
      : [];
  const games: SetupPackGame[] = [];
  for (const raw of rawGames) {
    const game = parsePackGame(raw);
    if (!game) return null;
    games.push(game);
  }

  let maps: string[] = [];
  if (d.maps !== undefined) {
    if (
      !Array.isArray(d.maps) ||
      !d.maps.every((m) => typeof m === "string" && m.trim())
    ) {
      return null;
    }
    maps = d.maps as string[];
  }

  // A pack with nothing in it is an authoring mistake, not something to import
  // as an empty collection.
  if (games.length === 0 && maps.length === 0) return null;

  let presets: SetupPackPreset[] | undefined;
  if (d.presets !== undefined) {
    if (!Array.isArray(d.presets)) return null;
    const parsed: SetupPackPreset[] = [];
    for (const raw of d.presets) {
      const p = parsePresetJson(JSON.stringify(raw));
      if (!p?.name?.trim()) return null;
      parsed.push(p as SetupPackPreset);
    }
    presets = parsed;
  }

  return {
    ...(title ? { title } : {}),
    ...(engineVersion ? { engineVersion } : {}),
    ...(games.length ? { games } : {}),
    ...(maps.length ? { maps } : {}),
    ...(presets ? { presets } : {}),
  };
}

/** Encode a manifest into a pasteable, versioned pack code. */
export function encodeSetupPack(manifest: SetupPackManifest): string {
  return encodePackEnvelope(manifest);
}

/** Decode and validate a pasted pack code. */
export function decodeSetupPack(
  code: string,
): PackDecodeResult<SetupPackManifest> {
  return decodePackEnvelope(code, parseSetupPackManifest);
}

/** A requirement satisfied by an exact installed-archive-name match, using the
 * pack's rapid tag (when given) as the download key instead of the name. */
function gameRequirementForPack(game: SetupPackGame): ContentRequirement {
  return {
    kind: "game",
    label: game.name,
    downloadKey: game.rapidTag ?? game.name,
    isInstalled: (installed) =>
      installed.games.some((g) => g.name === game.name),
  };
}

/** Every requirement a pack needs resolved before it can be applied: the
 * engine (when the pack pins one), each of its games, and each of its maps
 * (issue #387's list-of-requirements step). */
export function requirementsForPack(
  manifest: SetupPackManifest,
): ContentRequirement[] {
  return dedupeRequirements([
    ...(manifest.engineVersion
      ? [engineVersionRequirement(manifest.engineVersion)]
      : []),
    ...(manifest.games ?? []).map(gameRequirementForPack),
    ...(manifest.maps ?? []).map(exactMapRequirement),
  ]);
}

/**
 * A name safe to save an imported preset under without silently overwriting an
 * existing one of the same name. Presets are keyed by a fresh UUID, so nothing
 * is actually lost either way, but two presets sharing a name is confusing.
 * Appends a disambiguating counter, bumping it past any already-numbered
 * collision.
 */
export function dedupePresetName(
  existingNames: readonly string[],
  desired: string,
): string {
  if (!existingNames.includes(desired)) return desired;
  let n = 2;
  while (existingNames.includes(`${desired} (${n})`)) n++;
  return `${desired} (${n})`;
}

/** Resolve the names an imported pack's presets should be saved under, each
 * disambiguated against the recipient's existing presets (and each other, so
 * two bundled presets sharing a name don't collide on import either). */
export function namesForPackPresets(
  existing: readonly SkirmishPreset[],
  presets: readonly SetupPackPreset[],
): string[] {
  const taken = existing.map((p) => p.name);
  const names: string[] = [];
  for (const p of presets) {
    const name = dedupePresetName([...taken, ...names], p.name);
    names.push(name);
  }
  return names;
}
