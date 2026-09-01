import { Button, buttonVariants, cn, useHideSidebar } from "@picoframe/frame";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Loader2,
  Play,
  RotateCcw,
  Skull,
  Target,
  Trophy,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { invalidateMapPreview, invalidateScans } from "../../content/config";
import { ReplayHistoryList } from "../../content/pages/components/ReplayHistoryList";
import { useWriteRootPath } from "../../downloads/config";
import { QueueProgress } from "../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../downloads/useQueuedDownload";
import { useStillUi } from "../../general/display";
import { usePreferredTarget } from "../../play/config";
import { useCampaigns } from "../campaigns";
import type { Campaign, CampaignMission } from "../model";
import { type MissionRequirement, useMissionRun } from "../run";
import { BriefingProse } from "./components/Briefing";
import { CampaignImage } from "./components/CampaignImage";
import {
  MissionMapBackground,
  MissionMapSideGraphic,
} from "./components/MissionMapPreview";
import { MissionMediaPlayer } from "./components/MissionMediaFields";
import {
  MissionUnitBackground,
  MissionUnitSideGraphic,
} from "./components/MissionUnitPreview";
import { PanoramaScroller } from "./components/PanoramaScroller";
import { RunDifficulty } from "./components/RunDifficulty";
import { useMissionUnit } from "./components/useMissionUnit";

/**
 * The mission briefing and play flow. A full-bleed panorama (or a dark gradient
 * fallback) backs the page under a scrim; the overlaid content moves through the
 * phases {@link useMissionRun} exposes — briefing → checking → result →
 * victory/defeat, with "checking" and "result" both skippable when the replay's
 * winner can be auto-detected — without ever leaving the page, so the launch
 * promise and its exit code stay in one place.
 */
export default function MissionBriefingPage() {
  // The panorama is full-bleed. Held here, outside the keyed remount below, so
  // the sidebar does not flash back between missions.
  useHideSidebar();
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
  // The panorama's unit, if it has one. A player whose install cannot draw it
  // (an older version of the game, a unit renamed since) gets the slot's image
  // or the gradient instead, rather than an empty backdrop.
  const unit = useMissionUnit(mission.snapshot.gameName, mission.panoramaUnit);
  // A live 3D backdrop, of either kind. Suppressed while the game or map is
  // missing: the gate below is showing instead, and there is nothing to read a
  // map or a unit out of.
  const live3d =
    !run.missing &&
    !!(mission.panoramaMap || (mission.panoramaUnit && !unit.unavailable));

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={
        campaign.accent
          ? ({ "--primary": campaign.accent } as CSSProperties)
          : undefined
      }
    >
      {/* Background: the mission map or its chosen unit as a spinning backdrop,
          else a full-bleed panorama, else a dark gradient. The 3D backdrops are
          suppressed while the game or map is missing (the gate below shows
          instead, and there is nothing to render). The wrapper is NOT
          aria-hidden: a video panorama renders reachable pause/mute controls, so
          each purely-decorative branch hides itself. */}
      <div className="absolute inset-0">
        {live3d && mission.panoramaMap ? (
          <div className="h-full w-full" aria-hidden>
            <MissionMapBackground
              mapName={mission.snapshot.mapName}
              config={mission.panoramaMap}
            />
          </div>
        ) : live3d && mission.panoramaUnit ? (
          <div className="h-full w-full" aria-hidden>
            <MissionUnitBackground
              model={unit.model}
              config={mission.panoramaUnit}
            />
          </div>
        ) : mission.panorama ? (
          <PanoramaScroller
            fill
            campaignId={campaign.id}
            panorama={mission.panorama}
            playback={mission.panoramaPlayback}
            className="h-full w-full rounded-none"
          />
        ) : (
          <div
            className="h-full w-full bg-gradient-to-br from-slate-900 to-slate-950"
            aria-hidden
          />
        )}
      </div>
      {/* Scrim: darken for text contrast, heaviest at the bottom. A live 3D
          backdrop is the subject rather than a texture behind text, so it gets a
          much lighter scrim (the briefing card carries its own contrast) — the
          image-panorama design keeps the heavier one. `pointer-events-none` so it
          doesn't swallow clicks meant for the background video's controls beneath it. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-t",
          live3d
            ? "from-background/70 via-background/10 to-transparent"
            : "from-background via-background/85 to-background/40",
        )}
        aria-hidden
      />

      <div className="relative z-10 flex h-full min-h-0 flex-col p-4">
        <BackLink campaignId={campaign.id} />

        <div className="flex min-h-0 flex-1 items-end">
          {/* A missing game/map hard-blocks the mission: the briefing and its map
              preview are withheld until the requirement is installed. */}
          {run.missing ? (
            <MissionRequiredGate
              mission={mission}
              missing={run.missing}
              run={run}
            />
          ) : (
            <>
              {run.phase === "briefing" && (
                <Briefing campaign={campaign} mission={mission} run={run} />
              )}
              {run.phase === "checking" && <Checking />}
              {run.phase === "result" && <ResultPrompt run={run} />}
              {run.phase === "victory" && (
                <Victory campaign={campaign} run={run} />
              )}
              {run.phase === "defeat" && <Defeat run={run} />}
            </>
          )}
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
  const { target } = usePreferredTarget();
  // As for the panorama: a unit the player's install cannot draw falls back to
  // the slot's still image, or to no side graphic at all.
  const unit = useMissionUnit(
    mission.snapshot.gameName,
    mission.sideGraphicUnit,
  );
  const unitGraphic = mission.sideGraphicUnit && !unit.unavailable;
  return (
    <div className="flex w-full items-end gap-4">
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
          <BriefingProse className="max-h-40 overflow-auto">
            {mission.briefing}
          </BriefingProse>
        )}

        <MissionMediaPlayer
          campaignId={campaign.id}
          voiceover={mission.voiceover}
          voiceoverPlayback={mission.voiceoverPlayback}
          cutscene={mission.cutscene}
          cutscenePlayback={mission.cutscenePlayback}
        />

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

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Battle history
          </span>
          <ReplayHistoryList
            dataDir={target?.dataDir}
            match={(p) =>
              p.mode === "campaign" &&
              p.campaignId === campaign.id &&
              p.missionId === mission.id
            }
            emptyLabel="No attempts recorded yet."
          />
        </div>

        {run.error && (
          <Alert variant="destructive" className="p-3">
            <AlertDescription className="text-destructive">
              {run.error}
            </AlertDescription>
          </Alert>
        )}

        <StartArea run={run} />
      </div>

      {/* Optional side graphic: a spinning 3D map preview, a spinning unit, or a
          still image, centered (both axes) in the space between the briefing card
          and the page's right edge. `self-stretch` overrides the row's bottom
          alignment so the region spans the card height and can centre vertically.
          Hidden on narrow screens. */}
      {mission.sideGraphicMap ? (
        <div className="hidden flex-1 items-stretch self-stretch lg:flex">
          <MissionMapSideGraphic
            mapName={mission.snapshot.mapName}
            config={mission.sideGraphicMap}
          />
        </div>
      ) : unitGraphic && mission.sideGraphicUnit ? (
        <div className="hidden flex-1 items-stretch self-stretch lg:flex">
          <MissionUnitSideGraphic
            model={unit.model}
            config={mission.sideGraphicUnit}
          />
        </div>
      ) : mission.sideGraphic ? (
        <div className="hidden flex-1 items-center justify-center self-stretch lg:flex">
          <CampaignImage
            campaignId={campaign.id}
            image={mission.sideGraphic}
            alt=""
            className="max-h-[60vh] w-72 max-w-full object-contain drop-shadow-xl"
            playback={mission.sideGraphicPlayback}
            controls
          />
        </div>
      ) : null}
    </div>
  );
}

/** The Start button plus the reasons it might be unavailable. */
function StartArea({ run }: { run: ReturnType<typeof useMissionRun> }) {
  if (run.noEngine) {
    return (
      <p className="rounded-md border border-border/50 bg-background/60 p-3 text-sm text-muted-foreground">
        No engine found. Add a content folder with an engine in{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/settings/content-folders"
        >
          Settings → Content folders
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Only for a mission that actually plays differently at each level
          (issue #2220). The choice is the run's, and it reaches the engine
          through the same `launchScenario` call the mission launches by. */}
      {run.variesByDifficulty && (
        <RunDifficulty
          value={run.difficulty}
          onChange={run.setDifficulty}
          disabled={run.running}
        />
      )}
      <div className="flex items-center gap-3">
        <Button onClick={run.start} disabled={!run.canStart}>
          <Play className="size-4 fill-current" />{" "}
          {run.running
            ? "Game running…"
            : run.scanLoading
              ? "Loading content…"
              : "Start Mission"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The hard gate shown in place of the briefing when the mission's game or map is
 * not installed. A missing map can be downloaded and installed inline (best-effort
 * by name, or the mission's `mapDownload` override); once the rescan clears the
 * requirement the briefing takes over. A missing game just links to Downloads.
 */
function MissionRequiredGate({
  mission,
  missing,
  run,
}: {
  mission: CampaignMission;
  missing: MissionRequirement;
  run: ReturnType<typeof useMissionRun>;
}) {
  const { target } = usePreferredTarget();
  const writePath = useWriteRootPath();
  const mapDl = useQueuedDownload({
    kind: "map",
    label: `Map: ${mission.snapshot.mapName}`,
    args: {
      springName: mission.mapDownload?.springName ?? mission.snapshot.mapName,
      searchUrl: mission.mapDownload?.searchUrl,
      writePath,
    },
  });

  const isMap = missing.kind === "map";
  const downloadsLink = isMap ? "/downloads/maps" : "/downloads/games";
  const downloading = mapDl.busy;
  const error = mapDl.error;

  const download = async () => {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    // Drop the stale scan + map-preview caches so the rescan sees the new map.
    invalidateScans();
    if (target?.enginePath && target?.dataDir)
      invalidateMapPreview(
        target.enginePath,
        target.dataDir,
        mission.snapshot.mapName,
      );
    await run.recheck();
  };

  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <Download className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {isMap ? "Map required" : "Game required"}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        This mission needs{" "}
        <span className="font-medium text-foreground">{missing.name}</span>{" "}
        installed before you can play it.
      </p>

      {error && (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {isMap ? (
        <div className="flex flex-col gap-2">
          <Button onClick={download} disabled={downloading}>
            {downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {mapDl.status === "queued"
              ? "Waiting for a slot…"
              : downloading
                ? "Downloading…"
                : "Download & Install"}
          </Button>
          {downloading && <QueueProgress item={mapDl} />}
          {/* Best-effort by name can miss maps whose springname differs; the manual
              Downloads page is the fallback (and the only option for games). */}
          <Link
            to={downloadsLink}
            className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            Find it in Downloads <ChevronRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <Link to={downloadsLink} className={cn(buttonVariants(), "w-fit")}>
          <Download className="size-4" /> Get it in Downloads
        </Link>
      )}
    </PhaseCard>
  );
}

/** Shown briefly while the just-finished replay is being decoded for its winner. */
function Checking() {
  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <h2 className="text-lg font-semibold">Checking result…</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Reading the replay to see how the mission went.
      </p>
      <div className="checking-shimmer h-1.5 w-full rounded-full" aria-hidden />
    </PhaseCard>
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
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="text-destructive">
            {run.error}
          </AlertDescription>
        </Alert>
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
    <PhaseCard className="result-stamp">
      <div className="flex items-center gap-2">
        <Trophy className="size-6 text-amber-500" />
        <h2 className="text-xl font-semibold">Victory</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {next
          ? "Mission complete. The next mission is ready."
          : "Mission complete — you've finished the campaign!"}
      </p>
      {run.autoDetected && <AutoDetectedNote />}
      <div className="flex flex-wrap gap-3">
        {next ? (
          <Link
            to={`/campaign/${encodeURIComponent(campaign.id)}/${encodeURIComponent(
              next.id,
            )}`}
            className={cn(buttonVariants())}
          >
            <Play className="size-4 fill-current" /> Continue
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
    <PhaseCard className="result-stamp">
      <div className="flex items-center gap-2">
        <Skull className="size-6 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Defeat</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        No progress lost — regroup and try again.
      </p>
      {run.autoDetected && <AutoDetectedNote />}
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

/** Small aside on an auto-resolved Victory/Defeat screen, so it's clear the
 * result came from the replay rather than a manual report. */
function AutoDetectedNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Result detected from the replay.
    </p>
  );
}

function PhaseCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // Cross-fade between phases (and the Victory/Defeat stamp passed in via
  // className); dropped entirely when the user prefers a still UI.
  const still = useStillUi();
  return (
    <Card
      className={cn(
        "w-full max-w-md gap-4 border-border/50 bg-card/85 p-5 shadow-none backdrop-blur-sm",
        !still && "phase-fade",
        !still && className,
      )}
    >
      {children}
    </Card>
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
