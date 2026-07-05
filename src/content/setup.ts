import type { ContentState } from "./bindings";

/** What first-run setup still needs, plus the OS-standard folder path to offer. */
export interface SetupStatus {
  needsFolder: boolean;
  needsEngine: boolean;
  complete: boolean;
  standardPath?: string;
}

/**
 * Pure: what's missing for a playable setup, given content state + the standard
 * path. Kept framework-free (type-only import) so it's unit-testable without
 * pulling in `@picoframe/frame` and the rest of `config.ts`.
 */
export function deriveSetup(
  state: ContentState | null,
  standardPath?: string,
): SetupStatus {
  const roots = state?.roots ?? [];
  const needsFolder = roots.length === 0;
  const hasEngine = roots.some((r) => r.engines.length > 0);
  const needsEngine = !needsFolder && !hasEngine;
  return {
    needsFolder,
    needsEngine,
    complete: !needsFolder && hasEngine,
    standardPath,
  };
}
