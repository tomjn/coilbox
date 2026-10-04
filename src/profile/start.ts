import type { Campaign, CampaignMission } from "../campaign/model";
import { isSetUp } from "../scenario/listing";
import type { Scenario } from "../scenario/model";

/**
 * Where a distribution wants a new player to start (issue #3378): a campaign it
 * bundles, and optionally one mission in it. Both are the `id` fields of the
 * campaign document, which is what the routes and the progress file key on.
 *
 * Or a scenario it bundles on its own, with no campaign around it (issue
 * #3549). One or the other, never both.
 */
export interface StartConfig {
  /** The bundled campaign's `id`. */
  campaign?: string;
  /** A mission `id` in that campaign. Omitted means the campaign's first mission. */
  mission?: string;
  /** The bundled scenario's `id`, in place of `campaign`. */
  scenario?: string;
}

/** A loaded campaign reduced to what resolving `start` reads. */
export interface StartCampaign {
  campaign: Campaign;
  source: "local" | "bundled";
}

/** A loaded scenario reduced to what resolving `start` reads. */
export interface StartScenario {
  scenario: Scenario;
  source: "local" | "bundled" | "game";
}

/**
 * What a profile's `start` key resolved to.
 *
 * `none` is a profile with no `start` key, which is every profile written before
 * the key existed. `problem` is a key that names nothing playable, in words the
 * health panel shows the author. The home page treats both the same way and
 * draws no card.
 *
 * `ok` is a campaign mission and `scenario` is a scenario bundled on its own.
 * Two statuses rather than one with optional fields, so code that reads the
 * mission cannot be handed a scenario by mistake.
 */
export type StartResolution =
  | { status: "none" }
  | { status: "ok"; campaign: Campaign; mission: CampaignMission }
  | { status: "scenario"; scenario: Scenario }
  | { status: "problem"; issue: string };

/**
 * Resolve the profile's `start` key against the loaded campaigns and scenarios.
 *
 * Only a bundled campaign or scenario counts. A local one with the same id
 * exists on the author's machine and nowhere else, so accepting it would hide
 * the mistake from the one person who can fix it.
 *
 * Takes the raw value because `profile.json` is cast rather than validated, so
 * anything can arrive here.
 */
export function resolveStart(
  raw: unknown,
  campaigns: readonly StartCampaign[],
  scenarios: readonly StartScenario[] = [],
): StartResolution {
  if (raw === undefined || raw === null) return { status: "none" };
  const start = raw as Partial<Record<keyof StartConfig, unknown>>;
  if (typeof raw === "object" && start.scenario !== undefined) {
    return resolveStartScenario(start, scenarios);
  }
  if (
    typeof raw !== "object" ||
    typeof start.campaign !== "string" ||
    start.campaign === ""
  ) {
    return {
      status: "problem",
      issue:
        "`start` must be an object with a `campaign` id or a `scenario` id",
    };
  }
  if (start.mission !== undefined && typeof start.mission !== "string") {
    return { status: "problem", issue: "`start.mission` must be a mission id" };
  }
  const found = campaigns.find((c) => c.campaign.id === start.campaign);
  if (!found) {
    return {
      status: "problem",
      issue: `start campaign '${start.campaign}' is not bundled. Put its export in .coilbox/campaigns/ and use the \`id\` from that file`,
    };
  }
  if (found.source !== "bundled") {
    return {
      status: "problem",
      issue: `start campaign '${start.campaign}' is a local campaign, not a bundled one. Players will not have it until its export is in .coilbox/campaigns/`,
    };
  }
  const { campaign } = found;
  if (start.mission === undefined) {
    const first = campaign.missions[0];
    if (!first) {
      return {
        status: "problem",
        issue: `start campaign '${campaign.title}' has no missions`,
      };
    }
    return { status: "ok", campaign, mission: first };
  }
  const mission = campaign.missions.find((m) => m.id === start.mission);
  if (!mission) {
    return {
      status: "problem",
      issue: `start mission '${start.mission}' is not in campaign '${campaign.title}'`,
    };
  }
  return { status: "ok", campaign, mission };
}

/** The `scenario` form of `start`, once the key is known to be there. */
function resolveStartScenario(
  start: Partial<Record<keyof StartConfig, unknown>>,
  scenarios: readonly StartScenario[],
): StartResolution {
  if (start.campaign !== undefined) {
    return {
      status: "problem",
      issue:
        "`start` names both a `campaign` and a `scenario`. Keep one of them",
    };
  }
  if (start.mission !== undefined) {
    return {
      status: "problem",
      issue: "`start.mission` goes with `campaign`, not with `scenario`",
    };
  }
  const id = start.scenario;
  if (typeof id !== "string" || id === "") {
    return {
      status: "problem",
      issue: "`start.scenario` must be a scenario id",
    };
  }
  const named = scenarios.filter((s) => s.scenario.id === id);
  const found = named.find((s) => s.source === "bundled");
  if (!found) {
    return {
      status: "problem",
      issue:
        named.length > 0
          ? `start scenario '${id}' is not a bundled one. Players will not have it until its export is in .coilbox/scenarios/`
          : `start scenario '${id}' is not bundled. Put its export in .coilbox/scenarios/ and use the \`id\` from that file`,
    };
  }
  if (!isSetUp(found.scenario)) {
    return {
      status: "problem",
      issue: `start scenario '${found.scenario.name}' names no game and map, so there is nothing to play`,
    };
  }
  return { status: "scenario", scenario: found.scenario };
}
