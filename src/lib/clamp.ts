// Kept apart from helpers.ts, which imports i18n: the Conquest land worker
// uses clamp, and a worker bundle cannot load the .po catalogs.

/** Constrain `v` to `[lo, hi]`. A reversed `lo`/`hi` resolves to `hi`, and
 *  `NaN` propagates rather than clamping (see `helpers.test.ts`). */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
