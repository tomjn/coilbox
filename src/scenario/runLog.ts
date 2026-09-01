/**
 * What the engine's log said about a test run (issue #2165).
 *
 * A mission that spawned nothing exits with code 0, so the exit status cannot
 * tell it from a mission that worked. The only thing that can is what the
 * runtime wrote on its way past: the spawn it could not make, the group it was
 * asked to order and had nothing to order. Those lines are already in the
 * engine's infolog. Nothing read them.
 *
 * Pure, and kept apart from the drawer that calls it for the same reason
 * `crash.ts` sits apart from `useCrashTriage`: the interesting part is which
 * lines belong to this run and which of those are the mission's own, and both
 * are answerable without an engine.
 *
 * This is the author's, not the player's. See `wording.ts` for that line.
 */

import type { InfologTail } from "@/play/bindings";
import { classifyLine } from "@/play/crash";

/**
 * The section the mission runtime logs under, as Spring's formatter writes it.
 *
 * The engine puts the section in brackets before the level, so a runtime line
 * reads `[coilbox-mission] Error: ...`. It is the same string
 * `scripts/mission-sf-proof.sh` greps a real infolog for.
 */
export const MISSION_SECTION = "[coilbox-mission]";

/** The error and warning lines from one run, the mission's own kept apart. */
export interface RunLog {
  /** Where the log was read from, so the author can open it. */
  path: string;
  /** Lines the mission runtime wrote. What the author came for. */
  mission: string[];
  /** Every other error or warning the engine logged during the run. */
  engine: string[];
}

/**
 * Whether a log belongs to the run that just finished.
 *
 * Same rule as the crash drawer's: an engine that dies before it opens its log
 * leaves the previous session's behind, and showing that is worse than showing
 * nothing because it reads as evidence.
 */
export function logBelongsToRun(
  log: InfologTail,
  startedAtMs: number,
): boolean {
  return log.modifiedMs >= startedAtMs;
}

/** Whether the mission runtime wrote this line, rather than the engine. */
export function isMissionLine(line: string): boolean {
  return line.includes(MISSION_SECTION);
}

/**
 * The run's error and warning lines, split by who wrote them.
 *
 * Warnings are kept as well as errors. The runtime files an author's mistake at
 * whichever of the two fits, and the engine's own warnings are how a missing
 * sound or an unreadable model shows up, which is the other half of "the author
 * placed something and it did not arrive".
 *
 * The level is read by {@link classifyLine} rather than by looking for the word
 * "error" in the text, because a real engine warning contains it.
 */
export function readRunLog(
  log: InfologTail | null,
  startedAtMs: number,
): RunLog | null {
  if (log == null || !logBelongsToRun(log, startedAtMs)) return null;

  const mission: string[] = [];
  const engine: string[] = [];
  for (const line of log.lines) {
    const kind = classifyLine(line);
    if (kind === "normal") continue;
    (isMissionLine(line) ? mission : engine).push(line);
  }
  return { path: log.path, mission, engine };
}
