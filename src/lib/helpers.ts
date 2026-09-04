/**
 * Small one-line helpers duplicated across plugin folders, grouped here
 * since each is unrelated but too small to earn its own file (issue #2434).
 */

/** Constrain `v` to `[lo, hi]`. A reversed `lo`/`hi` resolves to `hi`, and
 *  `NaN` propagates rather than clamping (see `helpers.test.ts`). */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
