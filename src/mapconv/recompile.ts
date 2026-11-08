import type { AdvancedCompileOpts } from "./pages/components/AdvancedOptions";

/** The optional source images the Compile page can take from a map folder. */
export const SOURCE_KEYS = [
  "heightmap",
  "metalmap",
  "typemap",
  "minimap",
  "vegmap",
  "features",
] as const;

export type SuggestedSources = Partial<
  Record<(typeof SOURCE_KEYS)[number], string>
>;

/**
 * Recompile starts from a clean slate: every source and the height range go,
 * so a map that lacks one is left empty instead of keeping the previous map's.
 */
export function clearedForRecompile(a: AdvancedCompileOpts) {
  return {
    ...a,
    heightmap: "",
    metalmap: "",
    typemap: "",
    minimap: "",
    vegmap: "",
    features: "",
    minh: "",
    maxh: "",
    noclamp: false,
  };
}

/**
 * Fill the empty sources from the folder's files. A heightmap that came from a
 * decompile already holds the map's own heights, so `fromDecompile` also turns
 * clamping off: `mapcompile` would otherwise stretch it to the full range.
 */
export function fillSources(
  a: AdvancedCompileOpts,
  s: SuggestedSources,
  fromDecompile: boolean,
) {
  const merged = { ...a };
  for (const k of SOURCE_KEYS) {
    if (!merged[k] && s[k]) merged[k] = s[k] as string;
  }
  if (fromDecompile && s.heightmap && merged.heightmap === s.heightmap) {
    merged.noclamp = true;
  }
  return merged;
}

/**
 * Picking a different heightmap by hand ends the no-clamp that Recompile set
 * for the decompiled one. `autoFor` is the heightmap that set it. Ticking the
 * box by hand makes the choice the mapper's, so it is never undone.
 */
export function settleNoclamp(
  prev: AdvancedCompileOpts,
  next: AdvancedCompileOpts,
  autoFor: string | null,
): { opts: AdvancedCompileOpts; autoFor: string | null } {
  if (autoFor === null) return { opts: next, autoFor };
  if (next.noclamp !== prev.noclamp) return { opts: next, autoFor: null };
  if (next.heightmap !== autoFor) {
    return { opts: { ...next, noclamp: false }, autoFor: null };
  }
  return { opts: next, autoFor };
}
