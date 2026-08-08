import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "./bindings";

/**
 * What the match statistics section on replay detail shows, worked out here so
 * the component only has to render it.
 *
 * Two rules run through all of it:
 *
 * - No metric is named. Which figures are headlines is a flag in the registry
 *   (`crates/tauri-plugin-coilbox-content/src/metrics.rs`), read at runtime, so
 *   this file has no list to keep in step with it.
 * - Every sample field is a running total for the match so far, so a match total
 *   is the last sample of each team's series added up, never a sum over samples.
 */

/** Seconds to `mm:ss` (or `h:mm:ss`). */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human-readable result line from the winning ally teams. */
export function resultLabel(info: DemoInfo): string {
  // False either because the recording never reached a game over, or because
  // its trailer is in a format coilbox doesn't read and there was no demotool
  // fallback to ask, so this doesn't name a specific reason.
  if (!info.winnersKnown) return "Unknown";
  if (info.winningAllyTeams.length === 0) return "Nobody won";
  const ids = info.winningAllyTeams.map((a) => `Ally ${a}`).join(", ");
  return `${ids} won`;
}

/** How many seats played: humans who weren't spectating, plus every bot. */
export function seatCount(info: DemoInfo): number {
  const seated = info.players.filter((p) => !p.spectator).length;
  return seated + (info.ais?.length ?? 0);
}

/**
 * Whether this replay measured anything. A recording that was aborted, or one
 * the engine never wrote statistics for, still carries a trailer: it says so by
 * giving every team an empty series.
 */
export function hasStatistics(trailer: DemoTrailer): boolean {
  return trailer.teams.some((t) => t.samples.length > 0);
}

/**
 * A team's figure for the whole match: its last sample, since every field is a
 * running total. Zero for a team the engine recorded nothing for.
 */
export function teamTotal(samples: TeamStatSample[], key: MetricKey): number {
  const last = samples.at(-1);
  return last ? last[key] : 0;
}

/** One metric summed across every team, which is what a headline tile shows. */
export function matchTotal(trailer: DemoTrailer, key: MetricKey): number {
  return trailer.teams.reduce((sum, t) => sum + teamTotal(t.samples, key), 0);
}

/** `1234567` becomes `1.2M`. A figure this size is read at a glance, not counted. */
export function formatTotal(value: number): string {
  const v = Math.round(value);
  const abs = Math.abs(v);
  const short = (divisor: number, suffix: string) => {
    const n = v / divisor;
    // One decimal, and no bare `.0`, so it reads as `12M` rather than `12.0M`.
    const text =
      Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
    return `${text}${suffix}`;
  };
  if (abs >= 1_000_000) return short(1_000_000, "M");
  if (abs >= 10_000) return short(1_000, "k");
  return v.toLocaleString();
}

/** A headline tile: one registry metric, totalled across the match. */
export interface HeadlineTotal {
  metric: Metric;
  /** The raw total, for anything that wants to compare it rather than read it. */
  value: number;
  text: string;
}

/**
 * The tiles the registry asks for, in registry order. `headline` is the flag
 * that decides, so a metric promoted in `metrics.rs` appears here with no
 * frontend change at all.
 */
export function headlineTotals(
  trailer: DemoTrailer,
  metrics: Metric[],
): HeadlineTotal[] {
  return metrics
    .filter((m) => m.headline && m.surfaced)
    .map((metric) => {
      const value = matchTotal(trailer, metric.key);
      return { metric, value, text: formatTotal(value) };
    });
}
