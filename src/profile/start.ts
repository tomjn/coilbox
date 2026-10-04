import type { Campaign, CampaignMission } from "../campaign/model";

/**
 * Where a distribution wants a new player to start (issue #3378): a campaign it
 * bundles, and optionally one mission in it. Both are the `id` fields of the
 * campaign document, which is what the routes and the progress file key on.
 */
export interface StartConfig {
  /** The bundled campaign's `id`. */
  campaign: string;
  /** A mission `id` in that campaign. Omitted means the campaign's first mission. */
  mission?: string;
}

/** A loaded campaign reduced to what resolving `start` reads. */
export interface StartCampaign {
  campaign: Campaign;
  source: "local" | "bundled";
}

/**
 * What a profile's `start` key resolved to.
 *
 * `none` is a profile with no `start` key, which is every profile written before
 * the key existed. `problem` is a key that names nothing playable, in words the
 * health panel shows the author. The home page treats both the same way and
 * draws no card.
 */
export type StartResolution =
  | { status: "none" }
  | { status: "ok"; campaign: Campaign; mission: CampaignMission }
  | { status: "problem"; issue: string };

/**
 * Resolve the profile's `start` key against the loaded campaigns.
 *
 * Only a bundled campaign counts. A local campaign with the same id exists on
 * the author's machine and nowhere else, so accepting it would hide the mistake
 * from the one person who can fix it.
 *
 * Takes the raw value because `profile.json` is cast rather than validated, so
 * anything can arrive here.
 */
export function resolveStart(
  raw: unknown,
  campaigns: readonly StartCampaign[],
): StartResolution {
  if (raw === undefined || raw === null) return { status: "none" };
  const start = raw as Partial<Record<keyof StartConfig, unknown>>;
  if (
    typeof raw !== "object" ||
    typeof start.campaign !== "string" ||
    start.campaign === ""
  ) {
    return {
      status: "problem",
      issue: "`start` must be an object with a `campaign` id",
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
