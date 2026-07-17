import { Button } from "@picoframe/frame";
import { Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { resolveGameByShortname } from "../../conquest/model";
import { buildEdgeMap, reachableFrom } from "../../content/buildTree";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../../content/config";
import {
  EmptyState,
  SkeletonList,
} from "../../content/pages/components/states";
import { useReduceMotion } from "../../general/display";
import { usePreferredTarget } from "../../play/config";
import { awardMeta } from "../meta";
import { isBattleNode, type RunNode } from "../model";
import { moveTo, nextChoices, pendingNode } from "../progress";
import { RunMapView } from "../RunMapView";
import { useRun, useRunMeta } from "../runs";
import { EncounterOverlay } from "./components/EncounterOverlay";
import {
  EventOverlay,
  RewardOverlay,
  ShopOverlay,
} from "./components/NodeOverlays";
import { RunHud } from "./components/RunHud";

/**
 * The active run: the 3D/theatre node map with a HUD above and an inspect
 * panel. Clicking a forward choice moves there and opens that node's overlay
 * (battle briefing, reward pick, event card, or shop); resolving it persists
 * the run and reveals the next choices. All rules come from the pure `progress`
 * transitions — this page is a dispatcher.
 */
export default function RunPage() {
  const { run, loading, save } = useRun();
  const { meta, save: saveMeta } = useRunMeta();
  const reduceMotion = useReduceMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // Guard so a finished run awards meta-progression exactly once.
  const awardedRef = useRef<string | null>(null);

  // The arsenal ceiling size, for the HUD gauge (best-effort).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game = run
    ? resolveGameByShortname(run.settings.game, scan.data?.games ?? [])
    : undefined;
  const { dataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const arsenalTotal = useMemo(() => {
    if (!run?.startUnit || !dataset) return undefined;
    return reachableFrom(run.startUnit, buildEdgeMap(dataset.units)).size;
  }, [run?.startUnit, dataset]);

  const choices = useMemo(() => (run ? nextChoices(run) : []), [run]);
  const pending = useMemo(() => (run ? pendingNode(run) : null), [run]);

  // A freshly-entered (unresolved) node auto-opens its overlay.
  useEffect(() => {
    if (pending) setActiveNodeId(pending.id);
  }, [pending]);

  // When a run reaches won/lost, fold it into meta-progression once.
  useEffect(() => {
    if (!run || run.progress.status === "active") return;
    const key = `${run.createdAt}:${run.settings.seed}`;
    if (awardedRef.current === key) return;
    awardedRef.current = key;
    saveMeta(awardMeta(meta, run));
  }, [run, meta, saveMeta]);

  if (loading) return <SkeletonList />;
  if (!run) {
    return (
      <div className="p-6">
        <EmptyState label="No active run." />
        <div className="mt-4">
          <Link to="/runlite">
            <Button>Start a run</Button>
          </Link>
        </div>
      </div>
    );
  }

  const choiceIds = new Set(choices.map((n) => n.id));
  const active = activeNodeId
    ? (run.nodes.find((n) => n.id === activeNodeId) ?? null)
    : null;
  const ended = run.progress.status !== "active";

  const onSelect = async (id: string | null) => {
    if (!id) {
      setSelectedId(null);
      return;
    }
    if (choiceIds.has(id)) {
      // Move to this forward choice; its overlay opens once it's the pending
      // (unresolved) current node.
      await save(moveTo(run, id));
      setActiveNodeId(id);
    } else {
      setSelectedId(id);
    }
  };

  const closeOverlay = () => setActiveNodeId(null);
  const applyAndSave = async (next: typeof run) => {
    await save(next);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <RunHud run={run} arsenalTotal={arsenalTotal} />

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 bg-background/40">
        <RunMapView
          nodes={run.nodes}
          edges={run.edges}
          skin={run.settings.skin}
          currentId={run.progress.currentNodeId}
          visited={run.progress.visited}
          reachable={choices.map((n) => n.id)}
          selectedId={selectedId}
          onSelect={onSelect}
          reduceMotion={reduceMotion}
        />

        {selectedId && !active && (
          <InspectPanel
            node={run.nodes.find((n) => n.id === selectedId)}
            isChoice={choiceIds.has(selectedId)}
            onEnter={() => onSelect(selectedId)}
            onClose={() => setSelectedId(null)}
          />
        )}

        {active && isBattleNode(active.type) && (
          <EncounterOverlay
            run={run}
            node={active}
            onResolved={applyAndSave}
            onClose={closeOverlay}
          />
        )}
        {active?.type === "reward" && (
          <RewardOverlay
            run={run}
            node={active}
            onApply={applyAndSave}
            onClose={closeOverlay}
          />
        )}
        {active?.type === "event" && (
          <EventOverlay
            run={run}
            node={active}
            onApply={applyAndSave}
            onClose={closeOverlay}
          />
        )}
        {active?.type === "shop" && (
          <ShopOverlay
            run={run}
            node={active}
            onApply={applyAndSave}
            onClose={closeOverlay}
          />
        )}

        {ended && !active && (
          <EndScreen
            won={run.progress.status === "won"}
            onClear={() => save(null)}
          />
        )}
      </div>
    </div>
  );
}

function InspectPanel({
  node,
  isChoice,
  onEnter,
  onClose,
}: {
  node: RunNode | undefined;
  isChoice: boolean;
  onEnter: () => void;
  onClose: () => void;
}) {
  if (!node) return null;
  return (
    <div className="absolute right-3 top-3 z-10 flex w-72 flex-col gap-3 rounded-lg border border-border/50 bg-card/85 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {node.type}
          </div>
          {node.battle && (
            <div className="mt-1 text-sm">
              <div className="truncate">{node.battle.mapName}</div>
              <div className="text-xs text-muted-foreground">
                {node.battle.enemyAiCount} × hostile · tier{" "}
                {node.battle.techTier}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {isChoice && (
        <Button size="sm" onClick={onEnter} className="w-full">
          Chart a course here
        </Button>
      )}
    </div>
  );
}

function EndScreen({ won, onClear }: { won: boolean; onClear: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="flex w-[26rem] max-w-full flex-col items-center gap-4 rounded-lg border border-border/50 bg-card/90 p-6 text-center">
        <Trophy
          className={`size-8 ${won ? "text-yellow-300" : "text-muted-foreground"}`}
          aria-hidden
        />
        <h2
          className={`text-2xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}
        >
          {won ? "Run complete" : "Run ended"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {won
            ? "The sector warlord is broken. The run is yours."
            : "Your hull gave out. The run is over."}
        </p>
        <Link to="/runlite">
          <Button onClick={onClear}>Back to runs</Button>
        </Link>
      </div>
    </div>
  );
}
