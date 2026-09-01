/**
 * What a campaign row says about a campaign (issue #2187).
 *
 * The twin of `scenario/listing.ts`, and kept apart from the page for the same
 * reason: the questions a row asks are worth a plain unit test, and the answers
 * are the same wherever a campaign is listed.
 *
 * A scenario row can name its game and its map because a scenario is one setup.
 * A campaign is a sequence of them, so the row answers the version of that
 * question a campaign can answer: which game its missions are on, and how many
 * games that is when they are not all on one.
 *
 * It also answers what order the rows come in (issue #2213), which is a question
 * about the list rather than about any one campaign, but is read off the same
 * fields and is worth the same plain unit test.
 */

import { relativeTime } from "../lib/relativeTime";
import type { Campaign } from "./model";

/**
 * Which game a campaign's missions are on, or null when nothing has been
 * attached yet and there is no answer.
 *
 * Every mission snapshots its own game, so a campaign can legitimately span
 * several. Rather than calling that "Mixed", it is counted: "3 games" says how
 * mixed, and an author who wrote a campaign meant to sit on one game can see at
 * a glance that it does not.
 */
export function campaignGameLabel(campaign: Campaign): string | null {
  const names = new Set(
    campaign.missions.map((m) => m.snapshot?.gameName).filter(Boolean),
  );
  if (names.size === 0) return null;
  if (names.size === 1) return [...names][0] as string;
  return `${names.size} games`;
}

/**
 * The row's second line: the game, the size of the campaign, and when it was
 * last written. Segments with no answer are dropped rather than printed empty,
 * so a campaign with no missions reads "0 missions" rather than leading with a
 * gap where its game would be.
 */
export function campaignSummary(
  campaign: Campaign,
  now: number = Date.now(),
): string {
  const parts: string[] = [];
  const game = campaignGameLabel(campaign);
  if (game) parts.push(game);
  const count = campaign.missions.length;
  parts.push(`${count} mission${count === 1 ? "" : "s"}`);
  const edited = relativeTime(campaign.updatedAt, now);
  if (edited) parts.push(`edited ${edited}`);
  return parts.join(" · ");
}

/**
 * Whether a campaign can be played from its first mission to its last.
 *
 * Two things stop it, and both are reachable without leaving the builder:
 *
 * - No missions at all. A campaign starts this way, and one that was never
 *   finished stays this way.
 * - A mission whose snapshot names no game or no map. The preset picker offers
 *   a preset reading "No game · No map" as readily as a complete one, and the
 *   snapshot is a copy of whatever was picked. Play order is the array order, so
 *   one such mission blocks every mission after it.
 *
 * A mission with no attached scenario is not one of them. That is a preset-only
 * mission, which plays as an ordinary skirmish by design (see
 * `CampaignMission.scenario`), so a campaign made entirely of them is finished.
 */
export function campaignIsPlayable(campaign: Campaign): boolean {
  return campaignUnplayableReason(campaign) === null;
}

/**
 * The same answer as {@link campaignIsPlayable}, in words a player can act on,
 * or null when the campaign plays (issue #2219).
 *
 * The builder's Draft badge only has to say "this one is not finished", because
 * the author is one click from the editor that shows which mission is short.
 * The play list has no such click: the Campaign Builder is advanced-mode only
 * and a distribution can hide it outright, so a badge on its own would name a
 * problem the reader cannot even go and look at. Naming the mission is the
 * difference between a dead end and a to-do.
 *
 * The position is the mission's place in the sequence, counting from one,
 * because that is how the detail page numbers them.
 */
export function campaignUnplayableReason(campaign: Campaign): string | null {
  if (campaign.missions.length === 0) return "No missions yet";
  const at = campaign.missions.findIndex(
    (m) => !m.snapshot?.gameName || !m.snapshot?.mapName,
  );
  if (at === -1) return null;
  const snapshot = campaign.missions[at].snapshot;
  const missing = [
    !snapshot?.gameName && "game",
    !snapshot?.mapName && "map",
  ].filter(Boolean);
  return `Mission ${at + 1} has no ${missing.join(" or ")}`;
}

/** Local campaigns before bundled ones, as the plugin already reads them. */
const sourceRank = { local: 0, bundled: 1 } as const;

/**
 * The campaign list in the order an author wants to read it: their own
 * campaigns first, newest edit at the top of each group.
 *
 * The timestamp rule is `listScenarios`'s, so the two builders agree about what
 * "first" means and the campaign just saved is where the scenario just saved
 * would be. What differs is the grouping. `listScenarios` sorts local and
 * bundled together, which is fine there because the scenario list is grouped by
 * game and can be filtered by source. The campaign list is one flat list, so a
 * distribution bundling ten campaigns packaged this morning would push an
 * author's own work off the bottom of the screen. A bundled campaign's
 * `updatedAt` is whoever packaged the distribution last saving it, which is not
 * a date the reader did anything on, so it does not get to outrank one they did.
 *
 * A campaign with no `updatedAt` sorts last within its group, which is where a
 * campaign nobody can date belongs. Nothing coilbox writes is in that state:
 * every save stamps the field. A hand-authored document, or one bundled by a
 * distribution that wrote the JSON itself, can leave it out, and
 * `parseCampaignJson` reads that as the empty string rather than refusing the
 * document. The empty string sorts below every real timestamp for free, and the
 * sort is stable, so those campaigns hold the order they were read in rather
 * than shuffling between sessions.
 */
export function sortCampaigns<
  T extends { campaign: Campaign; source: "local" | "bundled" },
>(loaded: readonly T[]): T[] {
  return [...loaded].sort(
    (a, b) =>
      sourceRank[a.source] - sourceRank[b.source] ||
      b.campaign.updatedAt.localeCompare(a.campaign.updatedAt),
  );
}

/**
 * The map a campaign's row can draw when the campaign has no emblem of its own:
 * the first mission's, because that is the one an author sees first and the one
 * the campaign opens on. Null when there are no missions, or the first has no
 * map.
 */
export function campaignFallbackMap(campaign: Campaign): string | null {
  return campaign.missions[0]?.snapshot?.mapName || null;
}
