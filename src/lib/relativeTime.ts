import { t } from "@lingui/core/macro";
import { getLocale } from "../i18n";
import { formatDate } from "./format";

/**
 * How long ago a stored ISO timestamp was, in the shortest form that still says
 * it. Written for list rows (issue #2187), where the job is separating two
 * documents with the same name, not reporting a precise time.
 *
 * Returns null when there is no usable timestamp, so a caller drops the whole
 * segment rather than printing "Invalid Date". A campaign or scenario that was
 * written by an older build, or hand-edited, can carry an empty `updatedAt`.
 *
 * Past a month the relative form stops helping ("412 days ago" is not a fact
 * anyone reads), so it becomes a plain date in the app language.
 */
export function relativeTime(
  iso: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  // A document written on another machine can carry a timestamp slightly ahead
  // of this clock. "in 3 minutes" would be a second vocabulary for what is
  // really just now, so a future time is clamped to now.
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < SECONDS_PER_DAY * 30) return agoFromSeconds(seconds);
  return formatDate(then, { dateStyle: "medium" });
}

const SECONDS_PER_DAY = 86_400;

/**
 * `seconds` ago as a sentence fragment in the app language: "now", "2 minutes
 * ago", "vor 3 Tagen". Counts in the largest unit that has a whole number in
 * it and rounds down, so a unit is only claimed once it has passed.
 */
export function agoFromSeconds(seconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
  if (seconds < 60) return rtf.format(0, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

/** "refreshed 3 minutes ago" for a rapid index fetched `ageSecs` seconds ago. */
export function refreshedLabel(ageSecs: number): string {
  const ago = agoFromSeconds(ageSecs);
  return t`refreshed ${ago}`;
}
