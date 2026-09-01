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
 * The map a campaign's row can draw when the campaign has no emblem of its own:
 * the first mission's, because that is the one an author sees first and the one
 * the campaign opens on. Null when there are no missions, or the first has no
 * map.
 */
export function campaignFallbackMap(campaign: Campaign): string | null {
  return campaign.missions[0]?.snapshot?.mapName || null;
}
