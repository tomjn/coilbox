import { Button, useDrawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2, Play, Rocket, Share2, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { challengeExport } from "@/challenge/bindings";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { ContinueBadge } from "@/components/ContinueBadge";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogo } from "@/factions/logos";
import { mostRecentOpen } from "@/lib/recency";
import { resolveGameByShortname } from "../../conquest/model";
import { useUnitsyncScan } from "../../content/config";
import { EmptyState } from "../../content/pages/components/states";
import { useGamePresetParam } from "../../content/useGamePresetParam";
import { useImportParam } from "../../deeplink/useImportParam";
import { useRecordHubImport } from "../../hub/imports";
import { usePlayReadiness, usePreferredTarget } from "../../play/config";
import {
  encodeWarpathChallenge,
  encodeWarpathChallengeFile,
} from "../challenge";
import type { RogueliteRun } from "../model";
import { useRuns } from "../runs";
import { ImportChallengeForm } from "./components/ImportChallengeForm";
import { RunSetupForm } from "./components/RunSetupForm";

/**
 * The Warpath hub: every run in flight (resume/abandon), plus a "New warpath"
 * button that opens the setup in a right-hand drawer. Runs are keyed by id, so
 * warpaths for different games/factions coexist here — mirroring the Conquest
 * list + its "Generate a galaxy" drawer.
 */
export default function RunListPage() {
  const navigate = useNavigate();
  const drawer = useDrawer();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { runs, deleteRun } = useRuns();

  // Shared with the sidebar nav badge (issue #419) via `usePlayReadiness`, so
  // the two never disagree on whether a game is installed.
  const { hasGames } = usePlayReadiness();
  const runEntries = Object.entries(runs);

  // The single most recently updated run still in progress (issue #374's
  // "continue playing" affordance). Badged, not a separate button, since
  // every run already has its own explicit Resume button.
  const resumeRunId = useMemo(
    () =>
      mostRecentOpen(
        runEntries,
        ([, run]) => run.progress.status === "active",
        ([, run]) => Date.parse(run.updatedAt),
      )?.[0],
    [runEntries],
  );

  // A confirmed `coilbox://import` deep link (issue #388) lands here with the
  // challenge code in the query string, and with the hub item it came from
  // alongside it when the hub browse screen started it (issue #1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();

  const openSetup = (initialGameName?: string) =>
    drawer.open({
      title: "New warpath",
      width: "30rem",
      content: (
        <RunSetupForm
          initialGameName={initialGameName}
          onStarted={(id) => {
            drawer.close();
            navigate(`/warpath/${encodeURIComponent(id)}`);
          }}
        />
      ),
    });

  const openImportChallenge = (initialCode?: string) =>
    drawer.open({
      title: "Import challenge",
      width: "26rem",
      content: (
        <ImportChallengeForm
          initialCode={initialCode}
          onImported={(id) => {
            const route = `/warpath/${encodeURIComponent(id)}`;
            recordHubImport(hubItemId, [id], route);
            drawer.close();
            navigate(route);
          }}
        />
      ),
    });

  // Open the import drawer with the deep link's code prefilled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (importCode) openImportChallenge(importCode);
  }, [importCode]);

  // Game detail's "Start a warpath run" action (issue #372) lands here with
  // the game preselected in the query string. Open the setup drawer with it
  // prefilled, the same way an import code opens its own drawer above.
  const presetGame = useGamePresetParam();
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the preset arrives, not on every drawer identity change
  useEffect(() => {
    if (presetGame) openSetup(presetGame);
  }, [presetGame]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Rocket className="size-5 text-primary" aria-hidden /> Warpath
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Cross a forward-only map once — fight, take rewards, grow your
            build, and reach the warlord before your health runs out. Win or
            die, then set out again.
          </p>
        </div>
        {hasGames && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => openImportChallenge()}>
              <Download className="mr-1.5 size-4" aria-hidden /> Import
              challenge
            </Button>
            <Button onClick={() => openSetup()}>
              <Rocket className="mr-1.5 size-4" aria-hidden /> New warpath
            </Button>
          </div>
        )}
      </header>

      {!scan.data ? (
        target ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Scanning installed games…
          </div>
        ) : (
          <EmptyState
            label={
              <>
                Install an engine first (
                <Link
                  className="underline underline-offset-4"
                  to="/settings/engines"
                >
                  Settings → Engines
                </Link>
                ).
              </>
            }
          />
        )
      ) : !hasGames ? (
        <EmptyState
          label={
            <>
              No games installed. Add one from{" "}
              <Link
                className="underline underline-offset-4"
                to="/content/games"
              >
                Content → Games
              </Link>
              .
            </>
          }
        />
      ) : runEntries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {runEntries.map(([id, run]) => (
            <li key={id}>
              <RunCard
                run={run}
                resume={id === resumeRunId}
                onResume={() => navigate(`/warpath/${encodeURIComponent(id)}`)}
                onAbandon={() => deleteRun(id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState label="No warpath in progress. Start a new warpath to begin." />
      )}
    </div>
  );
}

/** One run in the hub, resolving its own faction emblem from the chosen side. */
function RunCard({
  run,
  resume,
  onResume,
  onAbandon,
}: {
  run: RogueliteRun;
  /** The single most-recently-updated active run (issue #374). */
  resume?: boolean;
  onResume: () => void;
  onAbandon: () => void;
}) {
  const drawer = useDrawer();
  const exportChallengeFile = async () => {
    const dest = await save({
      title: "Export challenge",
      defaultPath: `${run.settings.game.shortname || "warpath"}-challenge.json`,
      filters: [{ name: "Coilbox challenge", extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: encodeWarpathChallengeFile(run), dest });
  };
  const openShareChallenge = () =>
    drawer.open({
      title: "Share challenge",
      width: "26rem",
      content: (
        <ChallengeCodeView
          code={encodeWarpathChallenge(run)}
          helpText="Anyone who pastes this code into Import challenge (needs the same game installed) plays the identical warpath, so results are directly comparable."
          onExportFile={exportChallengeFile}
        />
      ),
    });
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game = resolveGameByShortname(
    run.settings.game,
    scan.data?.games ?? [],
  );
  const logo = useFactionLogo(
    {
      game: game ?? undefined,
      enginePath: target?.enginePath,
      dataDir: target?.dataDir,
      gameArchive: game?.primaryArchive.name,
      size: 32,
    },
    run.settings.side,
  );

  const { status, hull, maxHull } = run.progress;
  const label =
    status === "won"
      ? "Warpath complete"
      : status === "lost"
        ? "Warpath ended"
        : "Warpath in progress";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        {logo && (
          <FactionLogo
            logo={logo}
            sideName={run.settings.side}
            size={32}
            className="text-primary"
          />
        )}
        <div>
          <div className="flex items-center gap-2 font-medium">
            {run.name}
            {run.importedChallenge && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                Imported challenge
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <div className="text-xs text-muted-foreground">
            {label} · {run.settings.game.shortname} · health {hull}/{maxHull}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Share ${run.name} as a challenge code`}
          title="Share challenge"
          onClick={openShareChallenge}
        >
          <Share2 className="size-4" aria-hidden />
        </Button>
        <Button onClick={onResume}>
          <Play className="mr-1.5 size-4" aria-hidden />
          {status === "active" ? "Resume" : "View"}
        </Button>
        <Button variant="outline" onClick={onAbandon}>
          <Trash2 className="mr-1.5 size-4" aria-hidden /> Abandon
        </Button>
      </div>
    </div>
  );
}
