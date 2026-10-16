/**
 * What the Test drawer says about a unit load check (issue #3319).
 *
 * The check runs the scratch game in a headless engine, spawns the unit and
 * lets it run. The Rust side reads the log and decides the outcome. This turns
 * that into the one line the drawer leads with.
 */

import type { UnitCheckReport } from "@/content/bindings";

import { SPAWN_FRAME } from "./scratchGame";
import { PREVIEW_FRAMES, PREVIEW_SECONDS } from "./scriptPlayback";

/**
 * How long the unit runs once spawned: as long as the animation preview plays
 * its script, so the engine sees the same stretch of it the viewport showed.
 */
export const CHECK_FRAMES = PREVIEW_FRAMES;

/** The frame the unit is spawned on, the scratch game's own spawn frame. */
export const CHECK_SPAWN_FRAME = SPAWN_FRAME;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The line the drawer leads with. */
export function describeCheck(report: UnitCheckReport, unit: string): string {
  switch (report.outcome) {
    case "loaded":
      return `${unit} loaded and ran for ${PREVIEW_SECONDS} seconds with no errors. How it looks is not checked.`;
    case "problems":
      return `${plural(report.problems.length, "problem", "problems")} with ${unit}.`;
    case "gameDidNotLoad":
      return `The game did not load with ${unit} in it.`;
    case "unfinished": {
      const { exit } = report;
      if (exit.cancelled) return "The check was stopped.";
      if (exit.timedOut) return "The engine ran out of time and was stopped.";
      if (exit.signal !== null)
        return `The engine crashed with signal ${exit.signal} before the check finished.`;
      return `The engine stopped with code ${exit.code ?? "unknown"} before the check finished.`;
    }
  }
}

/** The note on errors that are not about the unit, or null when there are none. */
export function describeOtherErrors(report: UnitCheckReport): string | null {
  if (report.otherErrors === 0) return null;
  return `${plural(report.otherErrors, "other error", "other errors")} in the log ${report.otherErrors === 1 ? "is" : "are"} not about this unit.`;
}
