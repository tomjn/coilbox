/**
 * Formatters shared across the app (issue #2426). Byte sizes and match-clock
 * durations each had several near-identical implementations that disagreed on
 * unit ladders and decimal rules. `downloads/pages/MapsPage.tsx` inlined its
 * own byte math that never got past MB, so a 3 GB map read as "3072.0 MB".
 * This is the one place both now live.
 */

/**
 * Human-readable byte size (base-1024), e.g. `1.5 MB`.
 *
 * `n` is optional and nullable so a caller can pass an archive's
 * possibly-missing size straight through: missing reads as `null`, not
 * `"0 B"`, so a caller can tell "no size known" from "an empty file". Passed a
 * definite `number` (the common case), the return is always a `string`. A
 * non-finite or negative number reads as `"0 B"` rather than propagating
 * `"NaN B"` onto the screen.
 */
export function formatBytes(n: number): string;
export function formatBytes(n?: number | null): string | null;
export function formatBytes(n?: number | null): string | null {
  if (n == null) return null;
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * Seconds to `mm:ss` (or `h:mm:ss`), e.g. `65` -> `1:05`, `3725` -> `1:02:05`.
 *
 * A match-clock duration. Kept separate from `downloads/downloadRate.ts`'s
 * `formatDuration`, which is a deliberately different `2h 5m` style for a
 * download's time remaining, not a match time.
 */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
