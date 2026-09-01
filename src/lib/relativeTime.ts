/**
 * How long ago a stored ISO timestamp was, in the shortest form that still says
 * it. Written for list rows (issue #2187), where the job is separating two
 * documents with the same name, not reporting a precise time.
 *
 * Returns null when there is no usable timestamp, so a caller drops the whole
 * segment rather than printing "Invalid Date". A campaign or scenario that was
 * written by an older build, or hand-edited, can carry an empty `updatedAt`.
 *
 * Past a month the relative form stops helping ("412d ago" is not a fact anyone
 * reads), so it becomes a plain date in the user's locale.
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
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { dateStyle: "medium" });
}
