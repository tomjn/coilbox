/**
 * A small badge marking loose `.sdd` (uncompressed directory) content, to
 * distinguish work-in-progress maps/games from packaged `.sd7`/`.sdz` archives.
 */
export function SddBadge() {
  return (
    <span
      className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[0.625rem] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
      title="Loose .sdd directory (uncompressed)"
    >
      SDD
    </span>
  );
}
