import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { useCampaignProgress, useCampaigns } from "../campaigns";
import type { Campaign } from "../model";
import { CampaignIconBox } from "./components/CampaignImage";

/**
 * The Campaigns landing page: lists every stored campaign (local and bundled),
 * each card linking to its detail page and showing how many missions are
 * complete. Progress comes from {@link useCampaignProgress}, which reloads on
 * mount so returning here after a mission reflects the new count.
 */
export default function CampaignsPage() {
  const { campaigns, loading, error } = useCampaigns();
  const { progress } = useCampaignProgress();

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
}: {
  campaign: Campaign;
  bundled: boolean;
  completed: number;
}) {
  const total = campaign.missions.length;
  return (
    <Link
      to={`/campaign/${encodeURIComponent(campaign.id)}`}
      className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/50"
    >
      <CampaignIconBox campaignId={campaign.id} icon={campaign.icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{campaign.title}</span>
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
        <span className="text-xs text-muted-foreground/80">
          {completed}/{total} mission{total === 1 ? "" : "s"}
        </span>
      </div>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}
