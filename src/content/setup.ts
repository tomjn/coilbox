import type { ContentState } from "./bindings";

/** What first-run setup still needs, plus the OS-standard folder path to offer. */
export interface SetupStatus {
  needsFolder: boolean;
  needsEngine: boolean;
  complete: boolean;
  standardPath?: string;
  /**
   * A configured content folder that has since been deleted from disk. Present
   * only when a manual root no longer exists, so the setup card can offer to
   * recreate it at its original path rather than fall back to the standard one.
   */
  missingRoot?: { path: string };
}

/**
 * Pure: what's missing for a playable setup, given content state + the standard
 * path. Kept framework-free (type-only import) so it's unit-testable without
 * pulling in `@picoframe/frame` and the rest of `config.ts`.
 *
 * A root only counts once it actually exists on disk and validates — the backend
 * re-checks this on every load, so a folder or engine deleted between runs drops
 * out of the gate here instead of leaving setup wrongly "complete".
 */
export function deriveSetup(
  state: ContentState | null,
  standardPath?: string,
): SetupStatus {
  const roots = state?.roots ?? [];
  const usable = roots.filter((r) => r.exists && r.valid);
  const needsFolder = usable.length === 0;
  const hasEngine = usable.some((r) => r.engines.length > 0);
  const needsEngine = !needsFolder && !hasEngine;
  const missingRoot = roots.find((r) => !r.exists && r.source === "manual");
  return {
    needsFolder,
    needsEngine,
    complete: !needsFolder && hasEngine,
    standardPath,
    ...(missingRoot ? { missingRoot: { path: missingRoot.path } } : {}),
  };
}
