import type { Report } from "./bindings";

/** Aggregate headline figures derived from a report's per-command stats and counters. */
export interface ReportSummary {
  totalRequests: number;
  /** Aggregate throughput: sum of per-command requests/second. */
  throughput: number;
  totalErrors: number;
  /** requests / (requests + errors); null when there is nothing to divide. */
  successRate: number | null;
  durationSec: number;
}

/** A counter key counts as an error when it mentions error/timeout/fail. */
export function isErrorCounter(key: string): boolean {
  return /(error|timeout|fail)/i.test(key);
}

/** Derive headline figures shown in the summary band. */
export function summarize(report: Report): ReportSummary {
  const totalRequests = report.commands.reduce((sum, c) => sum + c.count, 0);
  const throughput = report.commands.reduce((sum, c) => sum + c.per_second, 0);
  const totalErrors = Object.entries(report.counters)
    .filter(([k]) => isErrorCounter(k))
    .reduce((sum, [, v]) => sum + v, 0);
  const denom = totalRequests + totalErrors;
  return {
    totalRequests,
    throughput,
    totalErrors,
    successRate: denom > 0 ? totalRequests / denom : null,
    durationSec: report.duration_sec,
  };
}

/** A parsed TASSERVER greeting line, or just the raw string when the shape is unfamiliar. */
export interface ParsedGreeting {
  raw: string;
  /** Present only when the line matched the documented `TASSERVER` shape. */
  fields?: {
    protocolVersion: string;
    springVersion: string;
    udpPort: string;
    serverMode: string;
  };
}

/**
 * Parse a lobby-server greeting. The Spring lobby protocol opens with
 * `TASSERVER <protocolVersion> <springVersion> <udpPort> <serverMode>`.
 * We only break out those fields when the line matches exactly; otherwise the
 * caller shows the raw greeting unchanged (no guessing at unknown formats).
 */
export function parseGreeting(raw: string): ParsedGreeting {
  const t = raw.trim().split(/\s+/);
  if (t[0] !== "TASSERVER" || t.length < 5) return { raw };
  return {
    raw,
    fields: {
      protocolVersion: t[1],
      springVersion: t[2],
      udpPort: t[3],
      serverMode: t[4],
    },
  };
}

/** A run that ended well short of its requested window, with failures to explain it. */
export interface EarlyTermination {
  /** Actual elapsed run time, seconds. */
  actualSec: number;
  /** Requested ramp + hold window, seconds. */
  expectedSec: number;
  /** Commands that recorded failures, most-failed first. */
  failedCommands: { command: string; errors: number }[];
}

/**
 * Detect a run that finished well before its requested `ramp + hold` window
 * *and* recorded failures — the signature of connections that established but
 * couldn't stay open (e.g. every login denied), so the hold phase never ran.
 * Returns null when the window can't be derived, the run lasted ~as long as
 * requested, or there were no failures (e.g. a clean user cancel).
 */
export function detectEarlyTermination(
  report: Report,
): EarlyTermination | null {
  const ramp = report.params?.ramp
    ? parseDurationSec(report.params.ramp)
    : null;
  const hold = report.params?.duration
    ? parseDurationSec(report.params.duration)
    : null;
  if (ramp == null || hold == null) return null;
  const expectedSec = ramp + hold;
  // Healthy runs last ~the full window (seeding/setup only adds time); only flag
  // a clear shortfall.
  if (report.duration_sec >= expectedSec * 0.85) return null;

  const failedCommands = report.commands
    .filter((c) => (c.error_count ?? 0) > 0)
    .map((c) => ({ command: c.command, errors: c.error_count ?? 0 }))
    .sort((a, b) => b.errors - a.errors);
  const hasCounterErrors = Object.entries(report.counters).some(
    ([k, v]) => isErrorCounter(k) && v > 0,
  );
  if (failedCommands.length === 0 && !hasCounterErrors) return null;

  return { actualSec: report.duration_sec, expectedSec, failedCommands };
}

/** Live progress emitted by the uberstress sidecar during a run. */
export interface RunProgress {
  /** Seconds since the scenario started. */
  t: number;
  /** Total successful command observations so far. */
  sent: number;
  /** Commands/second over the last tick. */
  rate: number;
  /** Total error-type counters so far. */
  errors: number;
}

/** Marker prefix the sidecar uses for machine-readable progress lines on stderr. */
export const PROGRESS_PREFIX = "@us:progress ";

/**
 * Parse a streamed log line as a sidecar progress payload, or null when it is
 * an ordinary log line. Lets the Run page route telemetry to a live panel
 * instead of the raw log.
 */
export function parseProgressLine(line: string): RunProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  try {
    const o = JSON.parse(line.slice(PROGRESS_PREFIX.length));
    if (typeof o.sent !== "number") return null;
    return {
      t: typeof o.t === "number" ? o.t : 0,
      sent: o.sent,
      rate: typeof o.rate === "number" ? o.rate : 0,
      errors: typeof o.errors === "number" ? o.errors : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a Go duration string (e.g. `30s`, `10s`, `200ms`, `1m30s`) into seconds.
 * Returns null when the string can't be parsed, so callers can fall back.
 */
export function parseDurationSec(s: string): number | null {
  const text = s.trim();
  if (!text) return null;
  const unit: Record<string, number> = {
    ns: 1e-9,
    us: 1e-6,
    µs: 1e-6,
    ms: 1e-3,
    s: 1,
    m: 60,
    h: 3600,
  };
  const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    matched = true;
    total += Number.parseFloat(m[1]) * unit[m[2]];
    m = re.exec(text);
  }
  return matched ? total : null;
}
