import { buttonVariants, cn } from "@picoframe/frame";
import { PencilRuler } from "lucide-react";
import { Link } from "react-router";
import { PhaseCard } from "./PhaseCard";

/**
 * What the briefing shows in place of the mission when the mission was never
 * finished: its snapshot names no game, or no map, or neither (issue #2245).
 *
 * It reads as the twin of the missing-install gate and is deliberately not one.
 * That gate offers a download, and this one must not: there is no map called ""
 * to fetch, and the briefing used to offer to fetch it anyway. The only fix is
 * to the campaign, so the only way on from here is back.
 *
 * `reason` is the campaign list's sentence for this mission, so a player who
 * read "Mission 3 has no map" on the list reads the same words here.
 */
export function MissionUnfinishedGate({
  campaignId,
  reason,
}: {
  campaignId: string;
  reason: string;
}) {
  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <PencilRuler className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Unfinished mission</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{reason}</span>, so there
        is nothing to launch it with. Whoever wrote the campaign left this
        mission short of it, and only editing the campaign can fill it in.
        Nothing here is missing from your install and there is nothing to
        download.
      </p>
      <Link
        to={`/campaign/${encodeURIComponent(campaignId)}`}
        className={cn(buttonVariants({ variant: "outline" }), "w-fit")}
      >
        Back to campaign
      </Link>
    </PhaseCard>
  );
}
