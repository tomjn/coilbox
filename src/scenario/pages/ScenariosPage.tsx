import { Button, useDrawer } from "@picoframe/frame";
import { Play } from "lucide-react";
import { useMemo } from "react";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { usePlay } from "@/play/PlayProvider";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { scenarioLaunchBlocker } from "../launch";
import { playableScenarios, scenarioContents } from "../listing";
import type { Scenario } from "../model";
import { useScenarios } from "../scenarios";
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
 */
export default function ScenariosPage() {
  const { scenarios, loading, error } = useScenarios();
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const play = usePlay();
  const drawer = useDrawer();

  const playable = useMemo(() => playableScenarios(scenarios), [scenarios]);

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
        });

  const openPlay = (scenario: Scenario) =>
    drawer.open({
      title: `Play ${scenario.name}`,
      width: "32rem",
      content: <ScenarioTestDrawer scenario={scenario} mode="play" />,
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Scenarios</h1>
        <p className="text-sm text-muted-foreground">
          Standalone missions: a map, a starting force and something to do. Play
          one on its own, without a campaign around it.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <SkeletonList />
      ) : playable.length === 0 ? (
        <EmptyState label="No scenarios are ready to play yet." />
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
        <span className="truncate text-xs text-muted-foreground/80">
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
