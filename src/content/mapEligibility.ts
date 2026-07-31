import { useSetting } from "@picoframe/frame";
import { useCallback, useMemo } from "react";
import { getProfileMapExclusions } from "../profile/profile";
import { type MapExclusion, useCatalogMapExclusions } from "./branding";

/**
 * Which installed maps warpath and galactic conquest are allowed to use.
 *
 * Three sources exclude maps and they are purely additive: the branding catalog
 * (curated, remote), the distribution profile (a white-label build's own list),
 * and the player's opt-outs. None of them re-enables a map another one excluded,
 * so the player toggle is an opt-out and never an opt-in.
 *
 * The scope is deliberately narrow. An excluded map stays listed in Content and
 * stays playable in skirmish and multiplayer: it is only kept out of the two
 * modes that pick maps on the player's behalf.
 */

/** Frame-settings key holding the player's own opt-outs, by spring name. */
export const PLAYER_EXCLUSIONS_KEY = "content.excludedMaps";

/** Which layer excluded a map. Decides what the map detail page can offer. */
export type ExclusionSource = "catalog" | "profile" | "player";

export interface MapExclusionVerdict {
  source: ExclusionSource;
  /** The matching rule's id. Absent for a player opt-out, which has no rule. */
  ruleId?: string;
  reason?: string;
}

/** A rule with its regex precompiled (invalid regex -> undefined, rule kept). */
export interface CompiledExclusion extends MapExclusion {
  compiledRegex?: RegExp;
}

/** Precompile a rule list. Mirrors the branding entries' `compile`: a bad regex
 * warns and disables that half of the rule rather than dropping the whole rule,
 * so its `names` still apply. */
export function compileExclusions(rules: MapExclusion[]): CompiledExclusion[] {
  return rules.map((r) => {
    let compiledRegex: RegExp | undefined;
    if (r.match.regex) {
      try {
        compiledRegex = new RegExp(r.match.regex, "i");
      } catch {
        console.warn(`maps: exclusion "${r.id}" has an invalid regex, skipped`);
      }
    }
    return { ...r, compiledRegex };
  });
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The first rule excluding this spring name, if any. Exact names are checked
 * before the regex, matching how branding entries resolve. */
export function findExclusion(
  name: string,
  rules: CompiledExclusion[],
): CompiledExclusion | undefined {
  for (const r of rules) {
    if (r.match.names?.some((n) => eq(n, name))) return r;
    if (r.compiledRegex?.test(name)) return r;
  }
  return undefined;
}

/**
 * Resolve every layer for one map. Catalog first, then profile, then the player,
 * so the reason shown is the most authoritative one. Returns null when the map is
 * eligible.
 */
export function verdictFor(
  name: string,
  catalog: CompiledExclusion[],
  profile: CompiledExclusion[],
  player: string[],
): MapExclusionVerdict | null {
  const fromCatalog = findExclusion(name, catalog);
  if (fromCatalog) {
    return {
      source: "catalog",
      ruleId: fromCatalog.id,
      reason: fromCatalog.reason,
    };
  }
  const fromProfile = findExclusion(name, profile);
  if (fromProfile) {
    return {
      source: "profile",
      ruleId: fromProfile.id,
      reason: fromProfile.reason,
    };
  }
  if (player.some((p) => eq(p, name))) return { source: "player" };
  return null;
}

export interface MapEligibility {
  /** Excluded from warpath/conquest by any layer. */
  isExcluded: (name: string) => boolean;
  /** Which layer excluded it and why, or null when it is eligible. */
  verdictFor: (name: string) => MapExclusionVerdict | null;
  /** Drop excluded maps from a generation pool, keeping the caller's own shape. */
  eligible: <T extends { name: string }>(maps: T[]) => T[];
  /** The player's own opt-outs. Catalog and profile exclusions are not in here. */
  playerExcluded: string[];
  /** Add or remove one of the player's opt-outs. */
  setPlayerExcluded: (name: string, excluded: boolean) => void;
}

/**
 * The merged exclusion state. The catalog half is empty until the remote catalog
 * resolves, so a galaxy generated in that window can still contain an excluded
 * map. That is what the mid-run swap in `conquest/generate` covers.
 */
export function useMapEligibility(): MapEligibility {
  const catalogRules = useCatalogMapExclusions();
  const [playerExcluded, setPlayer] = useSetting<string[]>(
    PLAYER_EXCLUSIONS_KEY,
    [],
  );

  const catalog = useMemo(
    () => compileExclusions(catalogRules),
    [catalogRules],
  );
  // The profile is loaded once at startup and never changes, so this compiles
  // once rather than tracking a dependency.
  const profile = useMemo(
    () => compileExclusions(getProfileMapExclusions()),
    [],
  );

  const verdict = useCallback(
    (name: string) => verdictFor(name, catalog, profile, playerExcluded),
    [catalog, profile, playerExcluded],
  );

  const isExcluded = useCallback((name: string) => !!verdict(name), [verdict]);

  const eligible = useCallback(
    <T extends { name: string }>(maps: T[]) =>
      maps.filter((m) => !verdict(m.name)),
    [verdict],
  );

  const setPlayerExcluded = useCallback(
    (name: string, excluded: boolean) => {
      const without = playerExcluded.filter((n) => !eq(n, name));
      setPlayer(excluded ? [...without, name] : without);
    },
    [setPlayer, playerExcluded],
  );

  return {
    isExcluded,
    verdictFor: verdict,
    eligible,
    playerExcluded,
    setPlayerExcluded,
  };
}
