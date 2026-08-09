import { Button, useDrawer } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useUnitsyncScan } from "@/content/config";
import { useImportParam } from "@/deeplink/useImportParam";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { scenarioLaunchBlocker } from "../launch";
import { isSetUp, playableScenarios, scenarioContents } from "../listing";
import type { Scenario } from "../model";
import { useScenarios } from "../scenarios";
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
  // here, because this page is not advanced-gated and the builder is.
  const importCode = useImportParam();

  // Documents only: a bundled scenario is played exactly as a local one is, and
  // where it came from only matters where it can be edited.
  const playable = useMemo(
    () => playableScenarios(scenarios.map((l) => l.scenario)),
    [scenarios],
  );

  // An imported scenario lands in the list behind the toast. One that names no
  // game and map is not listed here at all, so say that rather than leave the
  // player looking for a row that never arrives.
  const imported = (scenario: Scenario) =>
    isSetUp(scenario)
      ? toast.success(`${scenario.name} is ready to play.`)
      : toast.warning(
          `${scenario.name} was imported, but it names no game and map, so there is nothing to play yet.`,
        );

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

  const openPlay = (scenario: Scenario) =>
    drawer.open({
      title: `Play ${scenario.name}`,
      width: "32rem",
      content: <ScenarioTestDrawer scenario={scenario} mode="play" />,
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Scenarios</h1>
          <p className="text-sm text-muted-foreground">
            Standalone missions: a map, a starting force and something to do.
            Play one on its own, without a campaign around it.
          </p>
        </div>
        <div className="shrink-0">
          <ScenarioImportButton
            initialCode={importCode}
            onImported={imported}
          />
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : playable.length === 0 ? (
        <EmptyState label="No scenarios are ready to play yet. Import one someone shared with you." />
      ) : (
        <ul className="flex flex-col gap-2">
          {playable.map((scenario) => (
            <li key={scenario.id}>
              <ScenarioCard
                scenario={scenario}
                blocker={blockerFor(scenario)}
                onPlay={() => openPlay(scenario)}
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
  blocker,
  onPlay,
}: {
  scenario: Scenario;
  /** Why it cannot be played right now, or null. */
  blocker: string | null;
  onPlay: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/50">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{scenario.name}</span>
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
