/**
 * Best-effort ordering for engine version strings so we can pick the "newest"
 * install. Spring/BAR versions look like `105.1.1-2511-gabc1234 BAR` (dotted
 * release, then a commit count after the first dash), with older/plainer forms
 * like `104.0.1-1828-g…` or just `104.0`. We compare the dotted numbers first,
 * then the commit count; anything unparseable falls back to a string compare.
 */

interface ParsedVersion {
  /** Leading dotted numeric components, e.g. [105, 1, 1]. */
  parts: number[];
  /** Commit count from the `-NNNN-` suffix, or 0 when absent. */
  commits: number;
  /** True when the string had no leading number (lexical fallback). */
  unparsed: boolean;
}

function parse(version: string): ParsedVersion {
  const v = version.trim();
  const dotted = v.match(/^(\d+(?:\.\d+)*)/);
  if (!dotted) return { parts: [], commits: 0, unparsed: true };
  const parts = dotted[1].split(".").map((n) => Number.parseInt(n, 10));
  const commit = v.slice(dotted[1].length).match(/^-(\d+)/);
  return {
    parts,
    commits: commit ? Number.parseInt(commit[1], 10) : 0,
    unparsed: false,
  };
}

/** Negative if a < b, positive if a > b, 0 if equal — suitable for `sort`. */
export function compareEngineVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (pa.unparsed || pb.unparsed) return a.localeCompare(b);
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return pa.commits - pb.commits;
}

/** The `id` of the highest-versioned engine, with input order as a stable tiebreak. */
export function newestEngineId(
  engines: { id: string; version: string; syncVersion?: string }[],
): string | undefined {
  let best: { id: string; label: string } | undefined;
  for (const e of engines) {
    const label = e.syncVersion ?? e.version;
    // Strict `>` keeps the earlier engine on a tie (stable).
    if (!best || compareEngineVersions(label, best.label) > 0) {
      best = { id: e.id, label };
    }
  }
  return best?.id;
}
