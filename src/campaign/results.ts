import { DIFFICULTIES, type Difficulty } from "../scenario/model";
import type {
  Campaign,
  CampaignMission,
  CampaignProgress,
  ProgressFile,
} from "./model";
import { missionStates } from "./progress";

/**
 * Pure progress transitions for the play flow, kept apart from the run hook so the
 * win/loss bookkeeping is directly unit-testable (no React / frame imports).
 * Progress is stored as one opaque document keyed by campaign id (see model.ts);
 * each transition returns a fresh document, never mutating its input.
 */

/**
 * The campaign's progress entry, or an empty one when it hasn't been played.
 * The transitions below spread it rather than rebuilding it field by field, so
 * what the run carries that has nothing to do with winning, its difficulty,
 * survives a win and a loss.
 */
function entry(file: ProgressFile, campaignId: string): CampaignProgress {
  return (
    file.campaigns[campaignId] ?? { completedMissionIds: [], updatedAt: "" }
  );
}

/**
 * Record a mission win: add its id to `completedMissionIds` (deduped) and mark it
 * as last-played. Returns a new {@link ProgressFile}.
 */
export function applyVictory(
  file: ProgressFile,
  campaignId: string,
  missionId: string,
  now: string = new Date().toISOString(),
): ProgressFile {
  const prev = entry(file, campaignId);
  const completed = new Set(prev.completedMissionIds);
  completed.add(missionId);
  return {
    schemaVersion: 1,
    campaigns: {
      ...file.campaigns,
      [campaignId]: {
        ...prev,
        completedMissionIds: [...completed],
        lastPlayedMissionId: missionId,
        updatedAt: now,
      },
    },
  };
}

/**
 * Record a mission loss: update `lastPlayedMissionId` only, leaving completion
 * untouched (a defeat never advances the campaign). Returns a new
 * {@link ProgressFile}.
 */
export function applyDefeat(
  file: ProgressFile,
  campaignId: string,
  missionId: string,
  now: string = new Date().toISOString(),
): ProgressFile {
  const prev = entry(file, campaignId);
  return {
    schemaVersion: 1,
    campaigns: {
      ...file.campaigns,
      [campaignId]: { ...prev, lastPlayedMissionId: missionId, updatedAt: now },
    },
  };
}

/**
 * The difficulty this run is being played at, or undefined when nobody chose
 * (issue #2220).
 *
 * The progress document is stored as opaque JSON and read back without
 * validation, so the narrowing happens here: a level this build cannot rank is
 * read as no choice rather than passed on to the engine, where it would become a
 * modoption the runtime warns about and then ignores.
 */
export function runDifficulty(
  file: ProgressFile,
  campaignId: string,
): Difficulty | undefined {
  const said = file.campaigns[campaignId]?.difficulty;
  return DIFFICULTIES.find((level) => level === said);
}

/**
 * Record the difficulty for a campaign run, leaving its completions alone.
 *
 * Changeable at any point in the run, which is the whole reason the choice is
 * worth having: a player who finds mission 4 too hard drops the level and plays
 * mission 4 again. The missions already beaten stay beaten, because they were.
 */
export function chooseDifficulty(
  file: ProgressFile,
  campaignId: string,
  difficulty: Difficulty,
  now: string = new Date().toISOString(),
): ProgressFile {
  return {
    schemaVersion: 1,
    campaigns: {
      ...file.campaigns,
      [campaignId]: { ...entry(file, campaignId), difficulty, updatedAt: now },
    },
  };
}

/**
 * The next mission to offer after finishing `afterId`: the first mission *later
 * in play order* that is now available, or `null` when there's none (the last
 * mission, or a locked gap) — which the UI reads as "campaign complete".
 */
export function nextAvailableMission(
  campaign: Campaign,
  progress: CampaignProgress | undefined,
  afterId: string,
): CampaignMission | null {
  const states = missionStates(campaign, progress);
  const from = campaign.missions.findIndex((m) => m.id === afterId);
  for (let i = from + 1; i < campaign.missions.length; i++) {
    const m = campaign.missions[i];
    if (states.get(m.id) === "available") return m;
  }
  return null;
}
