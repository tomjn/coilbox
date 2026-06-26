import { useSetting } from "@picoframe/frame";
import type { MapAppearance, MapInfo } from "./bindings";
import {
  type AdvancedCompileOpts,
  defaultAdvanced,
} from "./pages/components/AdvancedOptions";

/**
 * Working drafts for the Compile and Decompile pages, persisted through the
 * frame settings store. The pages hold their inputs in local state for snappy
 * editing; these drafts back that state so navigating away (or restarting)
 * doesn't lose the form — and, because the 3D preview is path-driven, restoring
 * the paths brings the preview back for free.
 */

export interface CompileDraft {
  maintexture: string;
  outDir: string;
  outSuffix: string;
  /** Compression type as a string; falls back to the config default when unset. */
  ct?: string;
  advanced: AdvancedCompileOpts;
}

export const defaultCompileDraft: CompileDraft = {
  maintexture: "",
  outDir: "",
  outSuffix: "",
  advanced: defaultAdvanced,
};

export function useCompileDraft() {
  return useSetting<CompileDraft>("mapconv.compileDraft", defaultCompileDraft);
}

/** The decompile result panel's data — persisted so its preview survives nav. */
export interface DecompileResult {
  directory: string;
  mapInfo?: MapInfo | null;
  minimap?: string | null;
  appearance?: MapAppearance | null;
}

export interface DecompileDraft {
  inputPath: string;
  result: DecompileResult | null;
}

export const defaultDecompileDraft: DecompileDraft = {
  inputPath: "",
  result: null,
};

export function useDecompileDraft() {
  return useSetting<DecompileDraft>(
    "mapconv.decompileDraft",
    defaultDecompileDraft,
  );
}
