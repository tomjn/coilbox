import { Button } from "@picoframe/frame";
import { ArrowLeft, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { resolveGameByShortname } from "../../conquest/model";
import { buildEdgeMap, reachableFrom } from "../../content/buildTree";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../../content/config";
import {
  EmptyState,
  SkeletonList,
} from "../../content/pages/components/states";
import { usePreferredTarget } from "../../play/config";
import { awardMeta } from "../meta";
import {
  isBattleNode,
  type RogueliteRun,
  type RunNode,
  type RunNodeType,
} from "../model";
import {
  deepestColumn,
  hullLoss,
  moveTo,
  nextChoices,
  pendingNode,
  salvageReward,
} from "../progress";
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

  // Centre the camera on the node being briefed; else frame the whole run.
  const focusId = active ? active.id : null;

  return (
    <div className="relative h-full overflow-hidden">
      <RunMapView
        run={run}
        selectedId={selectedId}
        onSelect={onSelect}
        focusId={focusId}
        className="absolute inset-0"
      />

      {/* HUD overlaid on the map, not stacked above it. A back control sits to
          the left of the gauges so a run is exitable even when the profile
          hides the sidebar nav. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-stretch gap-3 p-4">
        <Link
          to="/runlite"
          aria-label="Back to runs"
          className="pointer-events-auto flex items-center justify-center rounded-md border border-border/50 bg-card/70 px-3 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <RunHud run={run} arsenalTotal={arsenalTotal} />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">
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

        {ended && !active && <EndScreen run={run} onClear={() => save(null)} />}
      </div>
    </div>
  );
}

const NODE_TITLE: Record<RunNodeType, string> = {
  start: "Command",
  battle: "Battle",
  elite: "Elite garrison",
  boss: "Sector warlord",
  reward: "Salvage cache",
  event: "Signal",
  shop: "Depot",
};

/** A short stat preview for a node, so you can read what it holds before
 * committing your course. */
function previewRows(node: RunNode): [string, string][] {
  if (node.battle) {
    const b = node.battle;
    return [
      [
        "Opposition",
        `${b.enemyAiCount} × hostile${b.handicap > 0 ? ` (+${b.handicap}%)` : ""}`,
      ],
      ["Tech tier", `${b.techTier}`],
      ["Health at risk", `-${hullLoss(node)}`],
      ["Reward", `+${salvageReward(node)} salvage`],
    ];
  }
  if (node.reward) {
    const unlocks = node.reward.options.filter(
      (o) => o.kind === "unlock",
    ).length;
    const perks = node.reward.options.length - unlocks;
    return [["Choose one of", `${unlocks} unlock, ${perks} perk`]];
  }
  if (node.event) return [["A choice awaits", "no battle"]];
  if (node.shop) {
    return [
      ["Offers", `${node.shop.offers.length}`],
      ["Rest & repair", node.shop.restHull ? "available" : "—"],
    ];
  }
  return [];
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
  const rows = previewRows(node);
  return (
    <div className="absolute right-3 top-3 z-10 flex w-72 flex-col gap-3 rounded-lg border border-border/50 bg-card/85 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {NODE_TITLE[node.type]}
          </div>
          {node.battle && (
            <div className="mt-1 truncate text-sm">{node.battle.mapName}</div>
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
      {rows.length > 0 && (
        <dl className="flex flex-col gap-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {isChoice && (
        <Button size="sm" onClick={onEnter} className="w-full">
          Chart a course here
        </Button>
      )}
    </div>
  );
}

function EndScreen({
  run,
  onClear,
}: {
  run: RogueliteRun;
  onClear: () => void;
}) {
  const won = run.progress.status === "won";
  const depth = deepestColumn(run);
  const maxCol = Math.max(...run.nodes.map((n) => n.col), 1);
  const battlesWon = run.history.filter((h) => h.outcome === "victory").length;
  const stats: [string, string][] = [
    ["Depth reached", `${depth} / ${maxCol}`],
    ["Battles won", `${battlesWon}`],
    ["Units unlocked", `${run.progress.unlockedUnits.length}`],
    ["Perks earned", `${run.progress.perks.length}`],
    ["Salvage banked", `${run.progress.salvage}`],
  ];
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="flex w-[30rem] max-w-full flex-col items-center gap-5 rounded-xl border border-border/50 bg-card/95 p-7 text-center">
        <Trophy
          className={`size-9 ${won ? "text-yellow-300" : "text-muted-foreground"}`}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <h2
            className={`text-2xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}
          >
            {won ? "Run complete" : "Run ended"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {won
              ? "The sector warlord is broken. The run is yours."
              : "Your ship gave out. The run is over."}
          </p>
        </div>
        <dl className="w-full divide-y divide-border/40 text-sm">
          {stats.map(([label, value]) => (
            <div key={label} className="flex justify-between py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <Link to="/runlite" className="w-full">
          <Button onClick={onClear} className="w-full">
            Back to runs
          </Button>
        </Link>
      </div>
    </div>
  );
}
