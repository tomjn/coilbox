import { t } from "@lingui/core/macro";
import type { SummaryRead } from "@/content/replaySummaryRead";

/** Why a replay could not be summed up, for the replay's page and for the
 *  background sender (issues #5493 and #5494). */
export function describeSummaryProblem(
  problem: Extract<SummaryRead, { problem: unknown }>["problem"],
): string {
  switch (problem.kind) {
    case "unfinished":
      return t`The recording stops before the end of the match, and the hub only takes a whole match.`;
    case "incompleteOrders":
      return t`Coilbox could not read every build order in this replay, and the hub checks all of them.`;
    case "noTeam": {
      const { name } = problem;
      return t`The replay does not say which team ${name} was on.`;
    }
    case "unknownUnit":
      return t`Coilbox cannot say what every unit built in this match is or costs. Install the game it was played on, then try again.`;
    case "otherBuild":
      return t`Another version of the game is installed, so Coilbox cannot say which unit each build order was for. Install the version it was played on, then try again.`;
    case "noSides":
      return t`Coilbox could not read the game's factions, which the hub checks. Install the game it was played on, then try again.`;
  }
}
