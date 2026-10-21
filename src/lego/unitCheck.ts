/**
 * What the Test drawer says about a unit load check (issue #3319).
 *
 * The check runs the scratch game in a headless engine, spawns the unit and
 * lets it run. The Rust side reads the log and decides the outcome. This turns
 * that into the one line the drawer leads with.
 */

import { plural, t } from "@lingui/core/macro";
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

/** The line the drawer leads with. */
export function describeCheck(report: UnitCheckReport, unit: string): string {
  switch (report.outcome) {
    case "loaded": {
      const seconds = PREVIEW_SECONDS;
      return t`${unit} loaded and ran for ${seconds} seconds with no errors. How it looks is not checked.`;
    }
    case "problems": {
      const count = report.problems.length;
      return plural(count, {
        one: `# problem with ${unit}.`,
        other: `# problems with ${unit}.`,
      });
    }
    case "gameDidNotLoad":
      return t`The game did not load with ${unit} in it.`;
    case "unfinished": {
      const { exit } = report;
      if (exit.cancelled) return t`The check was stopped.`;
      if (exit.timedOut) return t`The engine ran out of time and was stopped.`;
      if (exit.signal !== null) {
        const signal = exit.signal;
        return t`The engine crashed with signal ${signal} before the check finished.`;
      }
      const code = exit.code ?? t`unknown`;
      return t`The engine stopped with code ${code} before the check finished.`;
    }
  }
}

/** The note on errors that are not about the unit, or null when there are none. */
export function describeOtherErrors(report: UnitCheckReport): string | null {
  const count = report.otherErrors;
  if (count === 0) return null;
  return plural(count, {
    one: "# other error in the log is not about this unit.",
    other: "# other errors in the log are not about this unit.",
  });
}

/**
 * How far the unit drove when the check ordered it to move, or null for a unit
 * the engine gave no move class (issue #3255).
 */
export function describeMove(report: UnitCheckReport): string | null {
  if (report.movedElmos === null || report.moveClass === null) return null;
  const elmos = report.movedElmos;
  const moveClass = report.moveClass;
  return plural(elmos, {
    one: `Moved # elmo on ${moveClass} when ordered to.`,
    other: `Moved # elmos on ${moveClass} when ordered to.`,
  });
}
