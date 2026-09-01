/**
 * The picture on a campaign row (issue #2187).
 *
 * An author who has drawn an emblem sees it. One who has not sees the first
 * mission's map, which is a real picture of what the campaign opens on rather
 * than the same grey glyph on every row. A campaign with neither keeps the
 * glyph, so nothing is ever an empty box.
 *
 * The minimaps are the batch `ContentStartupProvider` primes once at startup and
 * keeps for the session, so a list of these costs no worker calls however many
 * rows it has. The scenario list draws its map the same way (issue #2177), but
 * not through the same component: a scenario is its map, so a scenario row warns
 * when that map is not installed, while a campaign spans many maps and this one
 * is only standing in for a missing emblem. Warning about it would be telling an
 * author their campaign is broken because they are missing the map of mission 1.
 *
 * Nothing here takes focus. The row is a link into the editor and this sits
 * inside it.
 */

import type { MapThumbData } from "@/content/config";
import { MapThumb } from "@/content/pages/components/MapThumb";
import { campaignFallbackMap } from "../../listing";
import type { Campaign } from "../../model";
import { CampaignIconBox } from "./CampaignImage";

export function CampaignRowThumb({
  campaign,
  thumbs,
  loading,
}: {
  campaign: Campaign;
  /** Every rendered minimap for the current target, by map name. */
  thumbs: Map<string, MapThumbData>;
  /** Whether the minimaps are still rendering. */
  loading: boolean;
}) {
  const mapName = campaign.icon ? null : campaignFallbackMap(campaign);
  const thumb = mapName ? thumbs.get(mapName) : undefined;
  // Only stand the map in once there is one to draw, or one still coming. A map
  // this machine does not have never arrives, and falls through to the emblem
  // box, which is the campaign glyph rather than a map glyph.
  if (mapName && (thumb || loading)) {
    return (
      <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/50">
        <MapThumb
          url={thumb?.url}
          width={thumb?.width}
          height={thumb?.height}
          alt=""
          loading={!thumb}
        />
      </div>
    );
  }
  return <CampaignIconBox campaignId={campaign.id} icon={campaign.icon} />;
}
