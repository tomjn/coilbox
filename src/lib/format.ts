/**
 * Formatters shared across the app (issue #2426). Byte sizes and match-clock
 * durations each had several near-identical implementations that disagreed on
 * unit ladders and decimal rules. `downloads/pages/MapsPage.tsx` inlined its
 * own byte math that never got past MB, so a 3 GB map read as "3072.0 MB".
 * This is the one place both now live.
 */

import { getLocale } from "../i18n";

/**
 * `n` in the app language, e.g. `1,234.5` under `en` and `1.234,5` under `de`.
 * `opts` is `Intl.NumberFormatOptions`.
 */
export function formatNumber(
  n: number,
  opts?: Intl.NumberFormatOptions,
): string {
  return n.toLocaleString(getLocale(), opts);
}

/** `n` with exactly `digits` decimals, the way `toFixed` writes it but with the app language's separator. */
export function formatFixed(n: number, digits: number): string {
  return formatNumber(n, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** `n` shortened for a glance, e.g. `12.3K` under `en`. */
export function formatCompact(
  n: number,
  opts?: Intl.NumberFormatOptions,
): string {
  return formatNumber(n, { notation: "compact", ...opts });
}

type DateInput = Date | number | string;

/** The date part of `d` in the app language. `opts` is `Intl.DateTimeFormatOptions`. */
export function formatDate(
  d: DateInput,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(d).toLocaleDateString(getLocale(), opts);
}

/** The time part of `d` in the app language. */
export function formatTime(
  d: DateInput,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(d).toLocaleTimeString(getLocale(), opts);
}

/** Both the date and the time of `d` in the app language. */
export function formatDateTime(
  d: DateInput,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(d).toLocaleString(getLocale(), opts);
}

const BYTE_UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/**
 * Human-readable byte size (base-1024), e.g. `1.5 MB` under `en` and `1,5 MB`
 * under `de`.
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
  if (n < 1024) return `${formatNumber(n)} B`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v < 10 ? 1 : 0;
  return new Intl.NumberFormat(getLocale(), {
    style: "unit",
    unit: BYTE_UNITS[i],
    unitDisplay: "short",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .formatToParts(v)
    .map((p) => (p.type === "unit" && p.value === "kB" ? "KB" : p.value))
    .join("");
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
