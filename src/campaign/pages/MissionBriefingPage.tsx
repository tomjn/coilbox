import { Button, buttonVariants, cn } from "@picoframe/frame";
import {
  ArrowLeft,
  ChevronRight,
  Play,
  RotateCcw,
  Skull,
  Target,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useCampaigns } from "../campaigns";
import type { Campaign, CampaignMission } from "../model";
import { type MissionRequirement, useMissionRun } from "../run";
import { PanoramaScroller } from "./components/PanoramaScroller";

/**
 * The mission briefing and play flow. A full-bleed panorama (or a dark gradient
 * fallback) backs the page under a scrim; the overlaid content moves through the
 * phases {@link useMissionRun} exposes — briefing → result → victory/defeat —
 * without ever leaving the page, so the launch promise and its exit code stay in
 * one place.
 */
export default function MissionBriefingPage() {
  const { id, missionId } = useParams();
  // Key on the mission so navigating to the next mission's briefing (from the
  // victory screen) remounts with a fresh phase instead of inheriting "victory".
  return (
    <MissionBriefing key={`${id}:${missionId}`} id={id} missionId={missionId} />
  );
}

function MissionBriefing({
  id,
  missionId,
}: {
  id?: string;
  missionId?: string;
}) {
  const { campaigns, loading } = useCampaigns();
  const loaded = campaigns.find((c) => c.campaign.id === id);
  const mission = loaded?.campaign.missions.find((m) => m.id === missionId);

  if (loading) {
    return (
      <div className="flex h-full flex-col p-4">
        <BackLink campaignId={id} />
      </div>
    );
  }

  if (!loaded || !mission) {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <BackLink campaignId={id} />
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            This mission isn't part of the campaign.
          </p>
        </div>
      </div>
    );
  }

  return <MissionStage campaign={loaded.campaign} mission={mission} />;
}

function MissionStage({
  campaign,
  mission,
}: {
  campaign: Campaign;
  mission: CampaignMission;
}) {
  const run = useMissionRun(campaign, mission);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Background: full-bleed panorama, or a dark gradient when there's none. */}
      <div className="absolute inset-0" aria-hidden>
        {mission.panorama ? (
          <PanoramaScroller
            fill
            campaignId={campaign.id}
            panorama={mission.panorama}
            className="h-full w-full rounded-none"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-slate-900 to-slate-950" />
        )}
      </div>
      {/* Scrim: darken for text contrast, heaviest at the bottom. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/40"
        aria-hidden
      />

      <div className="relative z-10 flex h-full min-h-0 flex-col p-4">
        <BackLink campaignId={campaign.id} />

        <div className="flex min-h-0 flex-1 items-end">
          {run.phase === "briefing" && (
            <Briefing campaign={campaign} mission={mission} run={run} />
          )}
          {run.phase === "result" && <ResultPrompt run={run} />}
          {run.phase === "victory" && <Victory campaign={campaign} run={run} />}
          {run.phase === "defeat" && <Defeat run={run} />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Phases
 * -------------------------------------------------------------------------- */

function Briefing({
  campaign,
  mission,
  run,
}: {
  campaign: Campaign;
  mission: CampaignMission;
  run: ReturnType<typeof useMissionRun>;
}) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border/50 bg-card/80 p-5 backdrop-blur-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {campaign.title}
        </span>
        <h1 className="text-2xl font-semibold">{mission.title}</h1>
        {mission.subtitle && (
          <p className="text-sm text-muted-foreground">{mission.subtitle}</p>
        )}
      </div>

      {mission.briefing && (
        <p className="max-h-40 overflow-auto whitespace-pre-line text-sm leading-relaxed text-foreground/90">
          {mission.briefing}
        </p>
      )}

      {mission.objectives.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Objectives
          </span>
          <ul className="flex flex-col gap-1.5">
            {mission.objectives.map((o) => (
              <li key={o} className="flex items-start gap-2 text-sm">
                <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {run.error}
        </p>
      )}

      <StartArea run={run} />
    </div>
  );
}

/** The Start button plus the reasons it might be unavailable. */
function StartArea({ run }: { run: ReturnType<typeof useMissionRun> }) {
  if (run.noEngine) {
    return (
      <p className="rounded-md border border-border/50 bg-background/60 p-3 text-sm text-muted-foreground">
        No engine found. Add a content folder with an engine in{" "}
        <span className="font-medium">Settings → Content Folders</span> first.
      </p>
    );
  }

  if (run.missing) {
    return <MissingRequirement missing={run.missing} />;
  }

  return (
    <div className="flex items-center gap-3">
      <Button onClick={run.start} disabled={!run.canStart}>
        <Play className="size-4" />{" "}
        {run.running
          ? "Game running…"
          : run.scanLoading
            ? "Loading content…"
            : "Start Mission"}
      </Button>
    </div>
  );
}

/** "Requires <name>" with a link to the matching Downloads page. */
function MissingRequirement({ missing }: { missing: MissionRequirement }) {
  const to = missing.kind === "map" ? "/downloads/maps" : "/downloads/games";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <span className="text-amber-700 dark:text-amber-400">
        Requires <span className="font-medium">{missing.name}</span>
      </span>
      <Link
        to={to}
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        Get it in Downloads <ChevronRight className="size-3.5" />
      </Link>
    </div>
  );
}

function ResultPrompt({ run }: { run: ReturnType<typeof useMissionRun> }) {
  return (
    <PhaseCard>
      <h2 className="text-xl font-semibold">How did it go?</h2>
      <p className="text-sm text-muted-foreground">
        Report the outcome to record your progress.
      </p>
      {run.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {run.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={run.recordVictory} disabled={run.saving}>
          <Trophy className="size-4" /> Victory
        </Button>
        <Button
          variant="outline"
          onClick={run.recordDefeat}
          disabled={run.saving}
        >
          <Skull className="size-4" /> Defeat
        </Button>
      </div>
    </PhaseCard>
  );
}

function Victory({
  campaign,
  run,
}: {
  campaign: Campaign;
  run: ReturnType<typeof useMissionRun>;
}) {
  const next = run.nextMission;
  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-amber-500" />
        <h2 className="text-xl font-semibold">Victory</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {next
          ? "Mission complete. The next mission is ready."
          : "Mission complete — you've finished the campaign!"}
      </p>
      <div className="flex flex-wrap gap-3">
        {next ? (
          <Link
            to={`/campaign/${encodeURIComponent(campaign.id)}/briefing/${encodeURIComponent(
              next.id,
            )}`}
            className={cn(buttonVariants())}
          >
            <Play className="size-4" /> Continue
          </Link>
        ) : null}
        <Link
          to={`/campaign/${encodeURIComponent(campaign.id)}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to campaign
        </Link>
      </div>
    </PhaseCard>
  );
}

function Defeat({ run }: { run: ReturnType<typeof useMissionRun> }) {
  const { id } = useParams();
  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <Skull className="size-6 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Defeat</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        No progress lost — regroup and try again.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={run.reset}>
          <RotateCcw className="size-4" /> Retry
        </Button>
        <Link
          to={`/campaign/${encodeURIComponent(id ?? "")}`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to campaign
        </Link>
      </div>
    </PhaseCard>
  );
}

function PhaseCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border/50 bg-card/85 p-5 backdrop-blur-sm">
      {children}
    </div>
  );
}

function BackLink({ campaignId }: { campaignId?: string }) {
  return (
    <Link
      to={`/campaign/${encodeURIComponent(campaignId ?? "")}`}
      className="inline-flex w-fit items-center gap-1 rounded bg-black/30 px-2 py-1 text-xs text-white backdrop-blur-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      <ArrowLeft className="size-3.5" /> Back
    </Link>
  );
}
