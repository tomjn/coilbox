/**
 * Attaching a scenario to a campaign mission, and telling an author when the
 * copy they attached has fallen behind the scenario they went on editing.
 *
 * A mission wraps a scenario and adds presentation. Attaching copies the whole
 * scenario document into the mission, the way `missionFromPreset` copies a
 * preset's setup into `snapshot`, so a campaign plays what its author attached
 * rather than whatever the source document happens to say later.
 *
 * The scenario's own setup becomes the mission's `snapshot`, because there can
 * only be one answer to which game and map a mission needs. Everything reading
 * `snapshot` (the install gate, the map previews, the unit-restriction picker)
 * therefore keeps working untouched.
 */

import type { SkirmishDraft } from "../play/drafts";
import type { Scenario } from "../scenario/model";
import type { Campaign, CampaignMission } from "./model";

/**
 * What a mission's attached scenario is, relative to the scenarios stored on
 * this machine.
 *
 * `orphaned` is not an error. The snapshot is the whole document, so a mission
 * whose source scenario was deleted, or which arrived from someone else's
 * export, still plays. There is just nothing to compare it against.
 */
export type ScenarioAttachment =
  | { state: "none" }
  | { state: "current"; snapshot: Scenario }
  | { state: "orphaned"; snapshot: Scenario }
  | { state: "stale"; snapshot: Scenario; live: Scenario };

/** A true copy of a scenario's setup, for a mission's launch snapshot. */
function snapshotSetup(scenario: Scenario): SkirmishDraft {
  return structuredClone(scenario.setup);
}

/**
 * Copy a scenario into a mission. Both the document and the setup it launches
 * with are deep-copied, so later edits to the source scenario never reach
 * through into an already-attached mission.
 */
export function attachScenario(
  mission: CampaignMission,
  scenario: Scenario,
): CampaignMission {
  return {
    ...mission,
    scenario: structuredClone(scenario),
    snapshot: snapshotSetup(scenario),
  };
}

/**
 * Drop a mission's scenario. The snapshot stays, so the mission goes back to
 * being the preset-only kind and still launches as an ordinary skirmish.
 */
export function detachScenario(mission: CampaignMission): CampaignMission {
  const { scenario: _dropped, ...rest } = mission;
  return rest;
}

/** A fresh mission built around a scenario, titled after it. */
export function missionFromScenario(scenario: Scenario): CampaignMission {
  return {
    id: crypto.randomUUID(),
    title: scenario.name,
    briefing: "",
    objectives: [],
    snapshot: snapshotSetup(scenario),
    scenario: structuredClone(scenario),
    disabledUnits: [],
    skippable: false,
  };
}

/**
 * True when any campaign has a mission carrying a snapshot of this scenario.
 *
 * Deleting a scenario also deletes its dialogue clips, which an attached
 * mission still loads by file name, so this is what decides whether the clips
 * outlive the document (issue #866). Bundled campaigns count: they play here
 * too.
 */
export function scenarioIsAttached(
  campaigns: Campaign[],
  scenarioId: string,
): boolean {
  return campaigns.some((campaign) =>
    campaign.missions.some((m) => m.scenario?.id === scenarioId),
  );
}

/**
 * What a mission's attached scenario is, given every scenario stored here.
 *
 * Staleness is `updatedAt` against `updatedAt`, which is what the editor writes
 * on every save and what an author means by "I changed it since". Comparing the
 * documents themselves would call an edit-and-undo a change, and would still
 * not tell them anything the timestamp does not.
 */
export function scenarioAttachment(
  mission: CampaignMission,
  scenarios: Scenario[],
): ScenarioAttachment {
  const snapshot = mission.scenario;
  if (!snapshot) return { state: "none" };
  const live = scenarios.find((s) => s.id === snapshot.id);
  if (!live) return { state: "orphaned", snapshot };
  if (live.updatedAt !== snapshot.updatedAt) {
    return { state: "stale", snapshot, live };
  }
  return { state: "current", snapshot };
}
