import { Button, useDrawer } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { useUnitsyncScan } from "@/content/config";
import { useImportParam } from "@/deeplink/useImportParam";
import { useOneShotParam } from "@/deeplink/useOneShotParam";
import { useRecordHubImport } from "@/hub/imports";
import { notify } from "@/notify/notify";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { scenarioLaunchBlocker } from "../launch";
import { isSetUp, scenarioContents } from "../listing";
import type { Scenario } from "../model";
import { scenarioRoute, useScenarios } from "../scenarios";
import type { LoadedScenario } from "../storage";
import { ScenarioImportButton } from "./components/ScenarioImportButton";
import { ScenarioTestDrawer } from "./components/ScenarioTestDrawer";

/**
 * The player-facing Scenarios list: every scenario that is set up, each played
 * bare, with no campaign and no briefing around it.
 *
 * It sits in the Play group beside Campaigns, and it plays through the same
 * drawer the editor's Test in game uses, because a player pressing Play and an
 * author testing a change want the identical compile, write, read back, launch.
 * Only the wording differs.
 *
 * Drafts with no game or map are left to the builder ({@link playableScenarios}).
 * A scenario that is set up but cannot be launched right now stays in the list
 * and says why, since "install that game" is something the player can act on.
 *
 * Import is here as well as on the builder (issue #861). A player handed a
 * scenario file or code has nowhere else to take it, because the builder is
 * advanced-only, which is also why a scenario deep link routes here.
 */
export default function ScenariosPage() {
  const { scenarios, loading, error } = useScenarios();
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const play = usePlay();
  const drawer = useDrawer();
  // A confirmed `coilbox://import` deep link carrying a scenario code lands
  // here, because this page is not advanced-gated and the builder is. It names
  // the hub item it came from when the hub browse screen started it (#1368).
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();

  // A bundled scenario is played exactly as a local one is, so the filter is
  // the document's own ({@link isSetUp}). Where it came from is carried along
  // rather than dropped, because a game's own mission is badged with the game
  // and plays out of that game's archive (issue #2160).
  const playable = useMemo(
    () => scenarios.filter((l) => isSetUp(l.scenario)),
    [scenarios],
  );

  // An imported scenario lands in the list behind the toast. One that names no
  // game and map is not listed here at all, so say that rather than leave the
  // player looking for a row that never arrives.
  const imported = (scenario: Scenario) => {
    recordHubImport(hubItemId, [scenario.id], scenarioRoute(scenario.id));
    if (isSetUp(scenario)) {
      void notify({
        title: `${scenario.name} is ready to play.`,
        level: "success",
      });
    } else {
      void notify({
        title: `${scenario.name} was imported, but it names no game and map, so there is nothing to play yet.`,
        level: "warning",
      });
    }
  };

  // The same refusal the drawer's button carries, shown a step earlier so the
  // player does not open a drawer to find out they cannot play anything.
  const blockerFor = (scenario: Scenario) =>
    scan.error
      ? `The content scan failed: ${scan.error}`
      : scenarioLaunchBlocker({
          scenario,
          hasEngine: targetLoading || !!target,
          games: scan.data?.games ?? null,
          running: play.running,
          reader: "player",
        });

  const openPlay = (loaded: LoadedScenario) =>
    drawer.open({
      title: `Play ${loaded.scenario.name}`,
      width: "32rem",
      content: (
        <ScenarioTestDrawer
          scenario={loaded.scenario}
          origin={loaded.origin}
          mode="play"
        />
      ),
    });

  // Opening one scenario by address (issue #1372, `scenarioRoute`): the same
  // drawer its row's Play button opens, so a link and the row end in the same
  // place. Waits for the list, and says what happened when the id names a
  // scenario that is not here, or one stored without a game and map, either of
  // which would otherwise leave the player on a list with no row to find.
  const openScenarioId = useOneShotParam("scenario");
  const opened = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per id, guarded by the ref rather than by the drawer's identity
  useEffect(() => {
    if (!openScenarioId || loading) return;
    if (opened.current === openScenarioId) return;
    opened.current = openScenarioId;
    const found = playable.find((l) => l.scenario.id === openScenarioId);
    if (found) return void openPlay(found);
    void notify({
      title: scenarios.some((l) => l.scenario.id === openScenarioId)
        ? "That scenario names no game and map, so there is nothing to play yet."
        : "That scenario isn't here any more. It may have been deleted.",
      level: "warning",
    });
  }, [openScenarioId, loading, playable, scenarios]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Scenarios"
        description="Standalone missions: a map, a starting force and something to do. Play one on its own, without a campaign around it."
        actions={
          <ScenarioImportButton
            initialCode={importCode}
            onImported={imported}
          />
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : playable.length === 0 ? (
        <EmptyState label="No scenarios are ready to play yet. Import one someone shared with you." />
      ) : (
        <ul className="flex flex-col gap-2">
          {playable.map((loaded) => (
            <li key={loaded.scenario.id}>
              <ScenarioCard
                scenario={loaded.scenario}
                fromGame={
                  loaded.source === "game" ? loaded.origin?.gameName : undefined
                }
                blocker={blockerFor(loaded.scenario)}
                onPlay={() => openPlay(loaded)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioCard({
  scenario,
  fromGame,
  blocker,
  onPlay,
}: {
  scenario: Scenario;
  /** The game this mission came out of, when the game ships it itself. */
  fromGame?: string;
  /** Why it cannot be played right now, or null. */
  blocker: string | null;
  onPlay: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{scenario.name}</span>
          {fromGame && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              From {fromGame}
            </Badge>
          )}
        </div>
        {scenario.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {scenario.description}
          </p>
        )}
        <span className="truncate text-xs text-muted-foreground">
          {scenario.setup.gameName} · {scenario.setup.mapName}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {scenarioContents(scenario)}
        </span>
        {blocker && <p className="text-xs text-destructive">{blocker}</p>}
      </div>
      <div className="ml-auto shrink-0">
        <Button className="gap-1.5" onClick={onPlay} disabled={!!blocker}>
          <Play className="size-4" /> Play
        </Button>
      </div>
    </div>
  );
}
