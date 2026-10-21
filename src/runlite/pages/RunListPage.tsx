import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useDrawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Astroid,
  Download,
  Loader2,
  Play,
  Rocket,
  Share2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { challengeExport } from "@/challenge/bindings";
import { ChallengeShare } from "@/challenge/ChallengeShare";
import { runIdentity } from "@/challenge/identity";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import { ContinueBadge } from "@/components/ContinueBadge";
import { PageHeader } from "@/components/PageHeader";
import { FactionLogo } from "@/factions/FactionLogo";
import { useFactionLogo } from "@/factions/logos";
import { mostRecentOpen } from "@/lib/recency";
import { PlanetSwatch } from "../../conquest/pages/components/PlanetSwatch";
import { planetOf } from "../../conquest/planets";
import { useUnitsyncScan } from "../../content/config";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  ScanFailed,
} from "../../content/pages/components/states";
import { useGamePresetParam } from "../../content/useGamePresetParam";
import { useImportParam } from "../../deeplink/useImportParam";
import { nextDrawerKey } from "../../general/drawerKey";
import { useRecordHubImport } from "../../hub/imports";
import { usePlayReadiness, usePreferredTarget } from "../../play/config";
import { resolveGameByShortname } from "../../play/installedGames";
import {
  encodeWarpathChallenge,
  encodeWarpathChallengeFile,
} from "../challenge";
import type { RogueliteRun } from "../model";
import { useRuns } from "../runs";
import { useAwardFinishedRuns } from "../useAwardFinishedRuns";
import { ImportChallengeForm } from "./components/ImportChallengeForm";
import { RunSetupForm } from "./components/RunSetupForm";

/**
 * The Warpath hub: every run in flight (resume/abandon), plus a "New warpath"
 * button that opens the setup in a right-hand drawer. Runs are keyed by id, so
 * warpaths for different games/factions coexist here — mirroring the Conquest
 * list + its "Generate a map" drawer.
 */
export default function RunListPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const drawer = useDrawer();
  const {
    runs,
    loading: runsLoading,
    error: runsError,
    unreadableCount,
    deleteRun,
  } = useRuns();
  // A run that ended while its page was closed is counted when the list shows it.
  useAwardFinishedRuns(runs, runsLoading);

  // Shared with the sidebar nav badge (issue #419) via `usePlayReadiness`, so
  // the two never disagree on whether a game is installed.
  const { hasGames, state, scanErrors, scanFailure } = usePlayReadiness();
  const runEntries = Object.entries(runs);
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const abandon = async (id: string) => {
    setAbandonError(null);
    try {
      await deleteRun(id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setAbandonError(t`The warpath was not abandoned. ${reason}`);
    }
  };

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
      title: t`New warpath`,
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
      title: t`Import challenge`,
      width: "26rem",
      content: (
        // A fresh form every time, because the last one may still be mounted
        // and would keep the code it already ran (issue #1395).
        <ImportChallengeForm
          key={nextDrawerKey()}
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
      <PageHeader
        title={
          <>
            <Rocket className="size-5 text-primary" aria-hidden />{" "}
            <Trans>Warpath</Trans>
          </>
        }
        description={t`Cross a forward-only map once — fight, take rewards, grow your build, and reach the warlord before your health runs out. Win or die, then set out again.`}
        actions={
          hasGames && (
            <>
              <Button variant="outline" onClick={() => openImportChallenge()}>
                <Download className="mr-1.5 size-4" aria-hidden />{" "}
                <Trans>Import challenge</Trans>
              </Button>
              <Button onClick={() => openSetup()}>
                <Rocket className="mr-1.5 size-4" aria-hidden />{" "}
                <Trans>New warpath</Trans>
              </Button>
            </>
          )
        }
      />

      {!runsLoading && runsError && (
        <ErrorBanner
          message={t`Your warpath runs could not be read. Nothing has been changed. ${runsError}`}
        />
      )}
      {abandonError && <ErrorBanner message={abandonError} />}
      {!runsLoading && unreadableCount > 0 && (
        <ErrorBanner
          message={plural(unreadableCount, {
            one: "# warpath run could not be read. It is kept in the file and has not been changed.",
            other:
              "# warpath runs could not be read. They are kept in the file and have not been changed.",
          })}
        />
      )}

      {state === "finding-engine" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <Trans>Looking for an engine…</Trans>
        </div>
      ) : state === "scanning" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          <Trans>Scanning installed games…</Trans>
        </div>
      ) : state === "no-engine" ? (
        <EmptyState
          label={
            <Trans>
              Install an engine first (
              <Link
                className="underline underline-offset-4"
                to="/settings/engines"
              >
                Settings → Engines
              </Link>
              ).
            </Trans>
          }
        />
      ) : state === "unreadable" ? (
        <div className="flex flex-col gap-3">
          {scanFailure && <ScanFailed noun="games" reason={scanFailure} />}
          <EmptyState
            label={
              <Trans>
                This engine could not read your games. Try another from{" "}
                <Link
                  className="underline underline-offset-4"
                  to="/settings/engines"
                >
                  Settings → Engines
                </Link>
                , or see what it found in{" "}
                <Link
                  className="underline underline-offset-4"
                  to="/library/games"
                >
                  Content → Games
                </Link>
                .
              </Trans>
            }
          />
          <Diagnostics errors={scanErrors} />
        </div>
      ) : !hasGames ? (
        <EmptyState
          label={
            <Trans>
              No games installed. Add one from{" "}
              <Link
                className="underline underline-offset-4"
                to="/library/games"
              >
                Content → Games
              </Link>
              .
            </Trans>
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
                onAbandon={() => abandon(id)}
              />
            </li>
          ))}
        </ul>
      ) : runsError ? null : (
        <EmptyState
          label={t`No warpath in progress. Start a new warpath to begin.`}
        />
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
  onAbandon: () => void | Promise<void>;
}) {
  const { t } = useLingui();
  const drawer = useDrawer();
  const exportChallengeFile = async () => {
    const dest = await save({
      title: t`Export challenge`,
      defaultPath: `${run.settings.game.shortname || "warpath"}-challenge.json`,
      filters: [{ name: t`Coilbox challenge`, extensions: ["json"] }],
    });
    if (!dest) return;
    await challengeExport({ text: encodeWarpathChallengeFile(run), dest });
  };
  const openShareChallenge = () =>
    drawer.open({
      title: t`Share challenge`,
      width: "26rem",
      content: (
        <ChallengeShare
          identity={runIdentity(run)}
          code={encodeWarpathChallenge(run)}
          helpText={t`Anyone who pastes this code into Import challenge (needs the same game installed) plays the identical warpath, so results are directly comparable.`}
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
  // A run across a generated land map is on a planet. One made before
  // planets existed is on Temperate.
  const map = run.settings.map;
  const planet =
    map?.source === "generated" ? (map.planet ?? "temperate") : null;
  const label =
    status === "won"
      ? t`Warpath complete`
      : status === "lost"
        ? t`Warpath ended`
        : t`Warpath in progress`;
  const gameShortname = run.settings.game.shortname;
  const runName = run.name;
  const progressText =
    status === "active" ? t`health ${hull}/${maxHull}` : label.toLowerCase();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex min-w-0 items-center gap-3">
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
                <Trans>Imported challenge</Trans>
              </span>
            )}
            {resume && <ContinueBadge />}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {label} · {gameShortname} ·{" "}
              <Trans>
                health {hull}/{maxHull}
              </Trans>
              {planet && ` · ${planetOf(planet).label}`}
            </span>
            {planet ? (
              <PlanetSwatch planet={planet} />
            ) : (
              map?.source !== "handmade" && (
                <Astroid
                  className="size-4 shrink-0"
                  fill="currentColor"
                  aria-hidden
                />
              )
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Share ${runName} as a challenge code`}
          title={t`Share challenge`}
          onClick={openShareChallenge}
        >
          <Share2 className="size-4" aria-hidden />
        </Button>
        <Button onClick={onResume}>
          <Play className="mr-1.5 size-4" aria-hidden />
          {status === "active" ? t`Resume` : t`View`}
        </Button>
        <ConfirmPopover
          triggerProps={{ variant: "outline" }}
          heading={t`Abandon ${runName}?`}
          description={t`This deletes the warpath for good, including its progress (${progressText}). It cannot be undone.`}
          confirmLabel={t`Abandon warpath`}
          busyLabel={t`Abandoning…`}
          onConfirm={onAbandon}
        >
          <Trash2 className="mr-1.5 size-4" aria-hidden />{" "}
          <Trans>Abandon</Trans>
        </ConfirmPopover>
      </div>
    </div>
  );
}
