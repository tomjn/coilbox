import type { Campaign, CampaignProgress } from "./model";

/**
 * The mission to resume for a campaign (issue #374's "continue playing"
 * affordance), or `undefined` if there's nothing to resume: no progress yet,
 * the last-played mission was itself already completed (nothing left hanging
 * mid-attempt), or it references a mission the campaign no longer has (an
 * authored mission removed after it was played).
 */
export function resumeMissionId(
  campaign: Campaign,
  progress: CampaignProgress | undefined,
): string | undefined {
  const missionId = progress?.lastPlayedMissionId;
  if (!missionId) return undefined;
  if (progress.completedMissionIds.includes(missionId)) return undefined;
  if (!campaign.missions.some((m) => m.id === missionId)) return undefined;
  return missionId;
}

/** A mission's play state, derived from the campaign order and saved progress. */
export type MissionState = "locked" | "available" | "complete";

/**
 * Derive every mission's play state for a campaign given its saved progress.
 *
 * v1 (linear) rule, walking the array in play order:
 *   - complete  — the mission's id is in `completedMissionIds`.
 *   - available — it's the first mission, OR the previous mission is complete, OR
 *     the mission is skippable and the previous mission is itself available.
 *   - locked    — otherwise.
 *
 * The skippable clause lets a run advance past an optional mission the player
 * hasn't finished: a skippable mission whose predecessor is merely *available*
 * (reached but not beaten) is itself available, so the chain doesn't dead-end.
 */
export function missionStates(
  campaign: Campaign,
  progress: CampaignProgress | undefined,
): Map<string, MissionState> {
  const completed = new Set(progress?.completedMissionIds ?? []);
  const states = new Map<string, MissionState>();

  let prevState: MissionState | undefined;
  for (let i = 0; i < campaign.missions.length; i++) {
    const mission = campaign.missions[i];
    let state: MissionState;
    if (completed.has(mission.id)) {
      state = "complete";
    } else if (
      i === 0 ||
      prevState === "complete" ||
      (mission.skippable && prevState === "available")
    ) {
      state = "available";
    } else {
      state = "locked";
    }
    states.set(mission.id, state);
    prevState = state;
  }

  return states;
}
