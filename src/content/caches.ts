/**
 * Cache-reclaim helpers (frontend, pure). Format and classify a cache-reclaim
 * summary. The side-effecting command lives in `bindings.ts`; keeping these here
 * (free of binding imports) makes them unit-testable.
 */

import { plural, t } from "@lingui/core/macro";
import { formatBytes } from "@/lib/format";
import type { CacheReclaimSummary } from "./bindings";

/** True when a summary found nothing to reclaim. */
export function isEmpty(s: CacheReclaimSummary): boolean {
  return s.totalBytes === 0 && s.totalFiles === 0;
}

/** One-line description of what a reclaim (dry-run or applied) covers. */
export function summarizeCaches(s: CacheReclaimSummary): string {
  if (isEmpty(s)) return t`Caches are already empty - nothing to reclaim.`;
  const fileCount = s.totalFiles;
  const size = formatBytes(s.totalBytes);
  return s.applied
    ? plural(fileCount, {
        one: `Cleared # file (${size}).`,
        other: `Cleared # files (${size}).`,
      })
    : plural(fileCount, {
        one: `Can reclaim # file (${size}).`,
        other: `Can reclaim # files (${size}).`,
      });
}

/** Non-empty caches, largest first, for the per-cache breakdown. */
export function nonEmptyCaches(
  s: CacheReclaimSummary,
): CacheReclaimSummary["caches"] {
  return s.caches.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}
