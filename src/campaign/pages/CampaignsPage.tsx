import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { CONTINUE_BADGE_CLASS } from "@/components/ContinueBadge";
import { mostRecentOpen } from "@/lib/recency";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { useCampaignProgress, useCampaigns } from "../campaigns";
import type { Campaign } from "../model";
import { resumeMissionId } from "../progress";
import { CampaignIconBox } from "./components/CampaignImage";

/** The single most recently touched campaign with an incomplete mission to
 * resume (issue #374's "continue playing" affordance), or `undefined` if none
 * qualify. Nothing qualifies when no campaign has been played, or when every
 * last-played mission was itself finished. */
function findResumeTarget(
  campaigns: { campaign: Campaign }[],
  progress: ReturnType<typeof useCampaignProgress>["progress"],
): { campaignId: string; missionId: string } | undefined {
  const candidates = campaigns.flatMap(({ campaign }) => {
    const entry = progress.campaigns[campaign.id];
    const missionId = resumeMissionId(campaign, entry);
    if (!missionId || !entry) return [];
    return [{ campaignId: campaign.id, missionId, updatedAt: entry.updatedAt }];
  });
  return mostRecentOpen(
    candidates,
    () => true,
    (c) => Date.parse(c.updatedAt),
  );
}

/**
 * The Campaigns landing page: lists every stored campaign (local and bundled),
 * each card linking to its detail page and showing how many missions are
 * complete. Progress comes from {@link useCampaignProgress}, which reloads on
 * mount so returning here after a mission reflects the new count.
 */
export default function CampaignsPage() {
  const { campaigns, loading, error } = useCampaigns();
  const { progress } = useCampaignProgress();

  const resumeTarget = useMemo(
    () => findResumeTarget(campaigns, progress),
    [campaigns, progress],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          Authored sequences of skirmish missions. Play a campaign mission by
          mission, tracking your progress as you go.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : campaigns.length === 0 ? (
        <EmptyState label="No campaigns yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {campaigns.map(({ campaign, source }) => (
            <li key={campaign.id}>
              <CampaignCard
                campaign={campaign}
                bundled={source === "bundled"}
                completed={completedCount(
                  campaign,
                  progress.campaigns[campaign.id],
                )}
                continueMissionId={
                  resumeTarget?.campaignId === campaign.id
                    ? resumeTarget.missionId
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Count how many of a campaign's missions are recorded complete. */
function completedCount(
  campaign: Campaign,
  entry: { completedMissionIds: string[] } | undefined,
): number {
  if (!entry) return 0;
  const done = new Set(entry.completedMissionIds);
  return campaign.missions.filter((m) => done.has(m.id)).length;
}

function CampaignCard({
  campaign,
  bundled,
  completed,
  continueMissionId,
}: {
  campaign: Campaign;
  bundled: boolean;
  completed: number;
  /** Set only for the single most-recently-touched campaign with something to
   * resume (issue #374): swaps the trailing chevron for a "Continue" link
   * straight into that mission's briefing, skipping the detail page. */
  continueMissionId?: string;
}) {
  const total = campaign.missions.length;
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50">
      <Link
        to={`/campaign/${encodeURIComponent(campaign.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none">
          <CampaignIconBox campaignId={campaign.id} icon={campaign.icon} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {campaign.title}
            </span>
            {bundled && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Bundled
              </span>
            )}
          </div>
          {campaign.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {campaign.description}
            </p>
          )}
          <span className="text-xs text-muted-foreground">
            {completed}/{total} mission{total === 1 ? "" : "s"}
          </span>
        </div>
      </Link>
      {continueMissionId ? (
        <Link
          to={`/campaign/${encodeURIComponent(campaign.id)}/${encodeURIComponent(continueMissionId)}`}
          className={cn(CONTINUE_BADGE_CLASS, "hover:bg-primary/25")}
        >
          Continue
        </Link>
      ) : (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}
