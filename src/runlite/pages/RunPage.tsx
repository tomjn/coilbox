import { Button, useDrawer, useHideSidebar } from "@picoframe/frame";
import { ArrowLeft, Check, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useFactionLogo } from "@/factions/logos";
import { SubstitutedMapNote } from "../../challenge/SubstitutedMapNote";
import { resolveGameByShortname } from "../../conquest/model";
import {
  BracketFrame,
  HUD_ACCENT_INK,
  HUD_CARD_CLASS,
  MAP_BAND_CLASS,
  MAP_DIM_INK_CLASS,
} from "../../conquest/pages/components/hudChrome";
import { buildEdgeMap, reachableFrom } from "../../content/buildTree";
import { useUnitsyncScan, useUnitsyncUnitDataset } from "../../content/config";
import { useMapEligibility } from "../../content/mapEligibility";
import { ReplayHistoryList } from "../../content/pages/components/ReplayHistoryList";
import {
  EmptyState,
  SkeletonList,
} from "../../content/pages/components/states";
import { UnitPicker } from "../../content/pages/components/UnitPicker";
import { usePreferredTarget } from "../../play/config";
import { restoreChallengeMap, substituteExcludedMaps } from "../generate";
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
  isResolved,
  nextChoices,
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
  // The node map wants the full width. The nav stays reachable from the top bar.
  useHideSidebar();
  const { runId } = useParams();
  const { run: savedRun, loading, save } = useRun(runId);
  const { meta, save: saveMeta } = useRunMeta();
  // A replay's "back to node" link deep-links here as `?node=<id>`, honoured
  // once on mount so the inspect panel opens straight to it (mirrors conquest's
  // `?node=` on GalaxyPage). A stale id (the node no longer exists in this run)
  // just finds nothing and the panel stays closed.
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    searchParams.get("node"),
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  // The node id to celebrate with a win burst (cleared after the burst plays).
  const [burstId, setBurstId] = useState<string | null>(null);
  // Guard so a finished run awards meta-progression exactly once.
  const awardedRef = useRef<string | null>(null);
  const drawer = useDrawer();

  // The arsenal ceiling size, for the HUD gauge (best-effort).
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // A saved run can outlive the map rules it was generated under, so nodes
  // sitting on a now-excluded map are re-pointed on the way in (issue #696).
  const { isExcluded } = useMapEligibility();
  const run = useMemo(
    () =>
      savedRun &&
      substituteExcludedMaps(
        savedRun,
        (scan.data?.maps ?? []).map((m) => ({
          name: m.name,
          size: (m.width ?? 8) * (m.height ?? 8),
        })),
        isExcluded,
      ),
    [savedRun, scan.data, isExcluded],
  );
  const game = run
    ? resolveGameByShortname(run.settings.game, scan.data?.games ?? [])
    : undefined;
  const { dataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const factionLogo = useFactionLogo(
    {
      game: game ?? undefined,
      enginePath: target?.enginePath,
      dataDir: target?.dataDir,
      gameArchive: game?.primaryArchive.name,
      size: 32,
    },
    run?.settings.side,
  );
  const arsenalTotal = useMemo(() => {
    if (!run?.startUnit || !dataset) return undefined;
    return reachableFrom(run.startUnit, buildEdgeMap(dataset.units)).size;
  }, [run?.startUnit, dataset]);

  // The run's faction arsenal only: the dataset carries every side's units, but
  // a warpath is single-faction, so scope the read-only tree to what the run's
  // commander can reach. This drops the other faction from "Other units".
  const arsenalUnits = useMemo(() => {
    if (!run?.startUnit || !dataset) return [];
    const reachable = reachableFrom(run.startUnit, buildEdgeMap(dataset.units));
    return dataset.units.filter((u) => reachable.has(u.name.toLowerCase()));
  }, [run?.startUnit, dataset]);

  // Read-only lit-tree of the run's unlocked arsenal, opened from the HUD's
  // Arsenal tile. The unlocked-unit set lights up against the faction's full
  // tree, so the shared tech ceiling is visible without changing unlock rules.
  const openArsenalTree =
    run && dataset && run.startUnit
      ? () =>
          drawer.open({
            title: "Arsenal",
            description:
              "Units unlocked into your shared arsenal, lit up against the faction's full build tree.",
            width: "40rem",
            content: (
              <UnitPicker
                units={arsenalUnits}
                factions={run.startUnit ? [{ startUnit: run.startUnit }] : []}
                selected={run.progress.unlockedUnits}
                selectedLabel="unlocked"
                enginePath={target?.enginePath}
                dataDir={target?.dataDir}
                gameArchive={game?.primaryArchive.name}
              />
            ),
          })
      : undefined;

  const choices = useMemo(() => (run ? nextChoices(run) : []), [run]);

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
        <EmptyState label="No active warpath." />
        <div className="mt-4">
          <Link to="/warpath">
            <Button>Start a warpath</Button>
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

  const onSelect = (id: string | null) => {
    if (!id) {
      setSelectedId(null);
      return;
    }
    // A depot you've already stepped into stays "open" until you leave it
    // (buying/resting commits the move but doesn't resolve the node), so let
    // re-clicking it reopen the actionable overlay — you can spend more, or
    // reconsider after dismissing without having spent.
    const node = run.nodes.find((n) => n.id === id);
    const reopenableShop =
      node?.type === "shop" &&
      id === run.progress.currentNodeId &&
      !isResolved(run, id);
    if (choiceIds.has(id) || reopenableShop) {
      // Open this choice's overlay as a *preview* — nothing commits until it's
      // resolved (launch/take/choose), so backing out is free.
      setSelectedId(null);
      setActiveNodeId(id);
    } else {
      // A visited or out-of-reach node: read-only inspect.
      setActiveNodeId(null);
      setSelectedId(id);
    }
  };

  const closeOverlay = () => setActiveNodeId(null);
  const applyAndSave = async (next: typeof run) => {
    await save(next);
  };
  // Put an encounter standing in for a challenge's map back on that map, once
  // this install has it (issue #1834). Nothing to save when the node is not
  // standing in for anything, which is what the identity check reads.
  const restoreMap = async (nodeId: string) => {
    if (!run) return;
    const next = restoreChallengeMap(run, nodeId);
    if (next !== run) await save(next);
  };
  // Fire a one-shot win burst on a node, then clear so it can replay next win.
  const celebrate = (id: string) => {
    setBurstId(id);
    window.setTimeout(() => setBurstId(null), 1600);
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
        burstNodeId={burstId}
        className="absolute inset-0"
      />

      {/* HUD overlaid on the map, not stacked above it. A back control sits to
          the left of the gauges so a run is exitable even when the profile
          hides the sidebar nav. The inspect panel flows below the gauges in the
          same column, so it shares the gauges' gap and never overlaps them. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 p-4">
        {/* The run's name and the chip beside it are the two labels on this page
            with nothing but the node map behind them, so both take the band the
            conquest map's own loose labels take (#1052). The name was a drop
            shadow, which softens an edge but decides no contrast ratio, so over
            a pale node the ink and what it sat on measured 1.0:1 (#1801). The
            chip was a card at 70% carrying `text-muted-foreground`, which is a
            60% grey the theme calibrates against a flat surface, so it measured
            2.3:1 over a bright node (#1812). A card that thin is not a backdrop
            anyway. On screen the chip read as loose text on the starfield, which
            is what the band is for. */}
        <div className="pointer-events-auto flex items-center gap-2">
          <span
            className={`${MAP_BAND_CLASS} px-2 py-1 font-display text-sm font-semibold uppercase tracking-[0.2em] ${HUD_ACCENT_INK.teal}`}
          >
            {run.name}
          </span>
          {run.importedChallenge && (
            <span
              className={`${MAP_BAND_CLASS} px-1.5 py-0.5 text-[10px] tracking-wide ${MAP_DIM_INK_CLASS}`}
            >
              Imported challenge
            </span>
          )}
        </div>
        <div className="flex items-stretch gap-3">
          {selectedId && !active ? (
            // A node is selected (read-only inspect): the left control steps
            // back to the map, mirroring the exit button's box style. Both
            // controls wear the measured HUD card rather than the hand-written
            // `bg-card/70` they used to, which is the same 2.3:1 the chip above
            // had and the same fix #1785 gave every framed tile.
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Back to map"
              className={`pointer-events-auto flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground ${HUD_CARD_CLASS}`}
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          ) : (
            <Link
              to="/warpath"
              aria-label="Back to warpath hub"
              className={`pointer-events-auto flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground ${HUD_CARD_CLASS}`}
            >
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <RunHud
              run={run}
              arsenalTotal={arsenalTotal}
              logo={factionLogo}
              side={run.settings.side}
              onInspectArsenal={openArsenalTree}
            />
          </div>
        </div>
        {selectedId && !active && (
          <div className="flex justify-end">
            <InspectPanel
              node={run.nodes.find((n) => n.id === selectedId)}
              isChoice={choiceIds.has(selectedId)}
              chosen={run.history
                .filter((h) => h.nodeId === selectedId && h.note)
                .at(-1)
                ?.note?.trim()}
              runId={runId}
              dataDir={target?.dataDir}
              onEnter={() => onSelect(selectedId)}
              onRestoreMap={restoreMap}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">
        {active && isBattleNode(active.type) && (
          <EncounterOverlay
            run={run}
            runId={runId}
            node={active}
            onResolved={applyAndSave}
            onRestoreMap={restoreMap}
            onClose={closeOverlay}
            onCelebrate={() => celebrate(active.id)}
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

/** Per-type accent colour, matching the node tokens on the map. */
const NODE_TINT: Record<RunNodeType, string> = {
  start: "#4fe6d6",
  battle: "#e0473a",
  elite: "#ffb64d",
  event: "#b98cff",
  reward: "#ffcf5c",
  shop: "#7fe08a",
  boss: "#ff5468",
};

const NODE_DESC: Record<RunNodeType, string> = {
  start:
    "Your commander deploys here. Chart a course onward toward the warlord.",
  battle:
    "A hostile garrison. Win to bank salvage; lose and you retreat, scarred.",
  elite: "A veteran garrison — tougher, but the salvage is richer.",
  boss: "The sector warlord. Break it to win the run.",
  reward:
    "Recover a schematic to widen the arsenal, or a field upgrade for yourself.",
  event: "A choice on the wire — no battle.",
  shop: "Spend salvage on unlocks, perks, and repairs.",
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
    const cheapest = Math.min(...node.shop.offers.map((o) => o.cost));
    return [
      ["Offers", `${node.shop.offers.length}`],
      // Surface the price floor so you can weigh a depot against your salvage
      // before charting a course to it — depots are rare, so a wasted visit hurts.
      ["Cheapest", `${cheapest} salvage`],
      [
        "Rest & repair",
        node.shop.restHull ? `+${node.shop.restHull} hull` : "—",
      ],
    ];
  }
  return [];
}

function InspectPanel({
  node,
  isChoice,
  chosen,
  runId,
  dataDir,
  onEnter,
  onRestoreMap,
  onClose,
}: {
  node: RunNode | undefined;
  isChoice: boolean;
  /** For a resolved node, what the player took here (from run history). */
  chosen?: string;
  /** For a battle node's replay history — the run's opaque id + the target's
   * data dir to scan for replays. */
  runId?: string;
  dataDir?: string;
  onEnter: () => void;
  /** Put this encounter back on the map the challenge named (issue #1834). */
  onRestoreMap: (nodeId: string) => Promise<void>;
  onClose: () => void;
}) {
  if (!node) return null;
  const rows = previewRows(node);
  const tint = NODE_TINT[node.type];
  return (
    // A subtle wash of the node's type colour over the card (no slop border).
    <BracketFrame className="pointer-events-auto flex w-72 flex-col overflow-hidden p-4 backdrop-blur-sm">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: tint, opacity: 0.08 }}
      />
      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div>
            <div
              className="font-display text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: tint }}
            >
              {NODE_TITLE[node.type]}
            </div>
            {node.battle && (
              <div className="mt-1 text-sm">
                <span className="block truncate">{node.battle.mapName}</span>
                <SubstitutedMapNote
                  original={node.battle.mapSubstitutedFrom}
                  className="mt-0.5"
                  onRestore={() => onRestoreMap(node.id)}
                />
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {NODE_DESC[node.type]}
            </p>
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
        {isBattleNode(node.type) && (
          <div className="flex flex-col gap-1.5">
            <span className="font-display text-[10px] uppercase tracking-wider text-muted-foreground">
              Battle history
            </span>
            <ReplayHistoryList
              dataDir={dataDir}
              match={(p) =>
                p.mode === "warpath" &&
                p.runId === runId &&
                p.nodeId === node.id
              }
              emptyLabel="No battles fought here yet."
            />
          </div>
        )}
        {chosen && (
          <div
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs"
            style={{ backgroundColor: tint, color: "#0b0e14" }}
          >
            <Check className="size-3.5 shrink-0" aria-hidden />
            <span className="font-semibold">{chosen}</span>
          </div>
        )}
        {isChoice && (
          <Button size="sm" onClick={onEnter} className="w-full">
            Chart a course here
          </Button>
        )}
      </div>
    </BracketFrame>
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
      <BracketFrame className="flex w-[30rem] max-w-full flex-col items-center gap-5 p-7 text-center">
        <Trophy
          className={`size-9 ${won ? "text-yellow-300" : "text-muted-foreground"}`}
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <h2
            className={`font-display text-2xl font-bold uppercase tracking-wide ${won ? "text-emerald-400" : HUD_ACCENT_INK.danger}`}
          >
            {won ? "Warpath complete" : "Warpath ended"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {won
              ? "The sector warlord is broken. The warpath is yours."
              : "Your ship gave out. The warpath is over."}
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
        <Link to="/warpath" className="w-full">
          <Button onClick={onClear} className="w-full">
            Back to warpath hub
          </Button>
        </Link>
      </BracketFrame>
    </div>
  );
}
