/**
 * Rapid pool housekeeping helpers (frontend, pure). The prune button is gated on
 * the download queue being idle; these functions format and classify a prune
 * summary. The side-effecting warm helper lives in `rapidPoolWarm.ts` so this
 * module stays free of binding imports (and thus unit-testable).
 */

import { formatBytes } from "@/lib/format";
import type { PruneSummary } from "./bindings";

/**
 * Pruning deletes pool blobs by refcounting against the `.sdp` files on disk, so
 * it must never race an in-flight download (which writes blobs before its `.sdp`
 * is registered). Only safe when nothing is downloading or queued.
 */
export function canPrune(active: unknown, queuedCount: number): boolean {
  return active == null && queuedCount === 0;
}

/** Total reclaimable bytes a prune summary represents. */
export function reclaimedBytes(s: PruneSummary): number {
  return s.blobBytes + s.incompleteBytes;
}

/** True when a summary found nothing to remove. */
export function isClean(s: PruneSummary): boolean {
  return s.blobs === 0 && s.incompletes === 0;
}

/** One-line description of what a prune (dry-run or applied) covers. */
export function summarize(s: PruneSummary): string {
  if (isClean(s)) return "Nothing to reclaim - the pool is tidy.";
  const parts: string[] = [];
  if (s.blobs > 0) parts.push(`${s.blobs} orphaned ${plural(s.blobs, "blob")}`);
  if (s.incompletes > 0)
    parts.push(`${s.incompletes} partial ${plural(s.incompletes, "file")}`);
  const verb = s.applied ? "Removed" : "Can reclaim";
  return `${verb} ${parts.join(" + ")} (${formatBytes(reclaimedBytes(s))}).`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
