import type { LaunchOutcome } from "./bindings";

/**
 * Pure engine-crash logic (issue #379), kept apart from the Tauri-calling
 * orchestration in `useCrashTriage` for the same reason as `debrief.ts` and
 * `detect.ts`: directly unit-testable without mocking plugin commands.
 */

/** How a run ended, as far as the UI cares. */
export type ExitKind = "clean" | "cancelled" | "signal" | "failed";

/**
 * Classify a finished run.
 *
 * A cancel is not a crash: the user asked for it, and `playCancel` removes the
 * child before it is reaped, so no exit status ever comes back. That absence is
 * the signature, which is why "both null" means cancelled rather than unknown.
 */
export function classifyExit(o: LaunchOutcome): ExitKind {
  if (o.signal != null) return "signal";
  if (o.exitCode == null) return "cancelled";
  return o.exitCode === 0 ? "clean" : "failed";
}

/** Whether a finished run is worth showing the player a log for. */
export function isAbnormal(o: LaunchOutcome): boolean {
  const kind = classifyExit(o);
  return kind === "signal" || kind === "failed";
}

/** The signals an engine actually dies from, so the report can name them
 * instead of printing a bare number nobody can look up mid-crash. */
const SIGNAL_NAMES: Record<number, string> = {
  2: "SIGINT",
  4: "SIGILL",
  6: "SIGABRT",
  8: "SIGFPE",
  9: "SIGKILL",
  11: "SIGSEGV",
  13: "SIGPIPE",
  15: "SIGTERM",
};

/** One line saying how the engine ended, for the drawer heading and the report. */
export function describeExit(o: LaunchOutcome): string {
  switch (classifyExit(o)) {
    case "signal": {
      const name = SIGNAL_NAMES[o.signal as number];
      const sig = name ? `${o.signal} (${name})` : String(o.signal);
      return `The engine crashed. It was killed by signal ${sig}.`;
    }
    case "failed":
      return `The engine stopped with an error. It exited with code ${o.exitCode}.`;
    case "cancelled":
      return "The game was cancelled.";
    default:
      return "The engine exited normally.";
  }
}

/** How a log line reads, for highlighting. */
export type LineKind = "error" | "warning" | "normal";

/** Every bracketed group a line opens with: the `[t=…]` stamp, the `[f=…]` frame
 * an in-game line adds beside it, and the `[Section]` the formatter writes. */
const BRACKETS = /^(?:\[[^\]]*\]\s*)*/;

/** The level the engine's formatter writes before the message, when it writes
 * one at all. */
const LEVEL = /^(\w+):/;

/**
 * Classify a log line by the engine's own level prefix.
 *
 * The formatter writes an optional `[Section]`, then the level and a colon, and
 * only for levels above Notice (`DefaultFormatter.cpp:52-64`). So the marker is
 * exact. Searching for the word "error" anywhere in the line would be wrong, and
 * a real line proves it:
 *
 *     [t=00:00:03.594541] Warning: [IsPathOnSpinningDisk] Error 'No such file...'
 *
 * That is a warning whose text happens to contain "Error". Reading the level
 * rather than the message gets it right.
 *
 * The leading brackets are stripped rather than matched one by one, because an
 * in-game line runs two stamps together (`[t=…][f=…] Error: …`) and messages
 * often start with a `[FunctionName]` tag of their own.
 *
 * A crash stack trace is logged at Error level, so its heading matches here. Its
 * continuation lines carry no prefix and read as normal, which is right:
 * highlighting every frame would highlight the whole tail.
 */
export function classifyLine(line: string): LineKind {
  const level = LEVEL.exec(line.replace(BRACKETS, ""))?.[1];
  if (level === "Error" || level === "Fatal") return "error";
  if (level === "Warning" || level === "Deprecated") return "warning";
  return "normal";
}

/** What a crash report says, beyond the log itself. */
export interface CrashReport {
  outcome: LaunchOutcome;
  /** What was being run: "skirmish", "replay" and so on. */
  runKind: string;
  game?: string;
  map?: string;
  engine?: string;
  /** The replay or savegame being played back, when that is what died. */
  file?: string;
  /** Absolute path of the log the lines came from, when one was found. */
  logPath?: string;
  lines: string[];
}

/** How many trailing lines a report carries. Enough for a stack trace, which is
 * the thing somebody is being asked to paste. */
const REPORT_TAIL = 60;

/**
 * A plain-text crash report to paste into Discord or a bug report.
 *
 * It leads with the error lines, because they are what somebody reading it
 * needs, and follows with the tail for context. It is not trimmed to Discord's
 * 2000 character limit: a stack trace does not fit in one, and quietly cutting
 * the trace would defeat the point of sending it.
 */
export function buildCrashReport(r: CrashReport): string {
  const out: string[] = [
    "Coilbox engine crash report",
    "",
    describeExit(r.outcome),
  ];
  out.push(`Run: ${r.runKind}`);
  if (r.game) out.push(`Game: ${r.game}`);
  if (r.map) out.push(`Map: ${r.map}`);
  if (r.file) out.push(`File: ${r.file}`);
  if (r.engine) out.push(`Engine: ${r.engine}`);
  out.push(`Log: ${r.logPath ?? "none found"}`);

  const errors = r.lines.filter((l) => classifyLine(l) === "error");
  if (errors.length > 0) {
    out.push("", `Error lines (${errors.length}):`, ...errors);
  }

  if (r.lines.length > 0) {
    const tail = r.lines.slice(-REPORT_TAIL);
    out.push("", `Last ${tail.length} lines:`, ...tail);
  }
  return out.join("\n");
}
