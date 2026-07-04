import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { useCampaigns } from "../campaigns";

/**
 * The Campaigns landing page: lists every stored campaign (local and bundled).
 * This is the Phase 3 placeholder — cards are read-only and link nowhere yet; the
 * builder and play flow arrive in later phases.
 */
export default function CampaignsPage() {
  const { campaigns, loading, error, refresh } = useCampaigns();

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
            <li
              key={campaign.id}
              className="flex flex-col gap-1 rounded-lg border border-border/50 bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {campaign.title}
                </span>
                {source === "bundled" && (
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
                {campaign.missions.length} mission
                {campaign.missions.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!loading && (
        <button
          type="button"
          onClick={refresh}
          className="self-start text-xs text-muted-foreground hover:underline"
        >
          Refresh
        </button>
      )}
    </div>
  );
}
