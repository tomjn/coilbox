import { ArrowLeft, ChevronRight, CircleCheck, Lock } from "lucide-react";
import { Link, useParams } from "react-router";
import { SkeletonList } from "../../content/pages/components/states";
import { useCampaignProgress, useCampaigns } from "../campaigns";
import type { CampaignMission } from "../model";
import { type MissionState, missionStates } from "../progress";
import { CampaignIconBox, CampaignImage } from "./components/CampaignImage";

/**
 * A campaign's detail page: the title/description header and the mission sequence
 * as an ordered list. Each mission's row reflects its play state derived from
 * saved progress ({@link missionStates}) — complete and available missions link
 * to their briefing; locked ones are dimmed and inert.
 *
 * Progress is read through {@link useCampaignProgress}, which reloads on mount, so
 * navigating back here after finishing a mission shows the freshly-unlocked next
 * mission with no manual refresh.
 */
export default function CampaignDetailPage() {
  const { id } = useParams();
  const { campaigns, loading } = useCampaigns();
  const { progress } = useCampaignProgress();

  const loaded = campaigns.find((c) => c.campaign.id === id);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        <SkeletonList />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <BackLink />
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            This campaign isn't installed.
          </p>
        </div>
      </div>
    );
  }

  const { campaign, source } = loaded;
  const states = missionStates(campaign, progress.campaigns[campaign.id]);
  const total = campaign.missions.length;
  const completed = campaign.missions.filter(
    (m) => states.get(m.id) === "complete",
  ).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="relative min-h-full">
      {/* Campaign backdrop (if any), dimmed for text contrast. A video backdrop
          renders reachable pause/mute controls, so the wrapper isn't aria-hidden;
          the empty-alt image and the dimming layer are decorative on their own. */}
      {campaign.background && (
        <div className="absolute inset-0">
          <CampaignImage
            campaignId={campaign.id}
            image={campaign.background}
            alt=""
            className="size-full object-cover"
            playback={campaign.backgroundPlayback}
            controls
            videoVariant="background"
          />
          <div
            className="pointer-events-none absolute inset-0 bg-background/85"
            aria-hidden
          />
        </div>
      )}

      <div className="relative z-10 flex flex-col gap-5 p-4">
        <BackLink />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <aside className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-start gap-3">
              <CampaignIconBox campaignId={campaign.id} icon={campaign.icon} />
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg font-semibold">{campaign.title}</h1>
                  {source === "bundled" && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Bundled
                    </span>
                  )}
                </div>
              </div>
            </div>

            {campaign.description && (
              <p className="text-sm text-muted-foreground">
                {campaign.description}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground/80">
                {completed}/{total} mission{total === 1 ? "" : "s"} complete
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </aside>

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Missions
            </h2>
            <ol className="flex flex-col gap-2">
              {campaign.missions.map((mission, i) => (
                <MissionRow
                  key={mission.id}
                  campaignId={campaign.id}
                  mission={mission}
                  index={i}
                  state={states.get(mission.id) ?? "locked"}
                />
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/campaign"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
    >
      <ArrowLeft className="size-3.5" /> Campaigns
    </Link>
  );
}

/** One mission in the sequence; links to the briefing unless it's locked. */
function MissionRow({
  campaignId,
  mission,
  index,
  state,
}: {
  campaignId: string;
  mission: CampaignMission;
  index: number;
  state: MissionState;
}) {
  const inner = (
    <>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{mission.title}</span>
        {mission.subtitle && (
          <span className="truncate text-xs text-muted-foreground">
            {mission.subtitle}
          </span>
        )}
      </div>
      <MissionStateIcon state={state} />
    </>
  );

  if (state === "locked") {
    return (
      <li
        aria-disabled
        className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 opacity-50"
      >
        {inner}
      </li>
    );
  }

  return (
    <li>
      <Link
        to={`/campaign/${encodeURIComponent(campaignId)}/${encodeURIComponent(
          mission.id,
        )}`}
        className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/50"
      >
        {inner}
      </Link>
    </li>
  );
}

function MissionStateIcon({ state }: { state: MissionState }) {
  if (state === "complete") {
    return (
      <CircleCheck
        className="ml-auto size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-label="Completed"
      />
    );
  }
  if (state === "locked") {
    return (
      <Lock
        className="ml-auto size-4 shrink-0 text-muted-foreground"
        aria-label="Locked"
      />
    );
  }
  return (
    <ChevronRight
      className="ml-auto size-4 shrink-0 text-muted-foreground"
      aria-hidden
    />
  );
}
