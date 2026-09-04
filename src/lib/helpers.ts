/**
 * Small one-line helpers duplicated across plugin folders, grouped here
 * since each is unrelated but too small to earn its own file (issue #2434).
 */

/** Constrain `v` to `[lo, hi]`. A reversed `lo`/`hi` resolves to `hi`, and
 *  `NaN` propagates rather than clamping (see `helpers.test.ts`). */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The last path segment, from a path using `/` or `\` as the separator. */
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** Normalise a thrown value to a display string. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
