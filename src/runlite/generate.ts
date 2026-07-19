import type { MapDownloadHint } from "../campaign/model";
import type { GameRef } from "../conquest/model";
import { sectorNameForSeed } from "../conquest/names";
import { mulberry32, pick, type Rng, randInt } from "../conquest/rng";
import { buildBuildGraph } from "../content/buildTree";
import type {
  EncounterSpec,
  EventSpec,
  Perk,
  RewardOption,
  RewardSpec,
  RogueliteRun,
  RunEdge,
  RunLength,
  RunNode,
  RunNodeType,
  RunSkin,
  ShopSpec,
} from "./model";

/**
 * Deterministic roguelite-run generator. Everything below is a pure function of
 * `opts.seed` via the conquest `rng` helpers, so the same options always build
 * the same run (rerollable / shareable by seed, and testable). The run is baked
 * self-contained: encounters, rewards, events and shops are all resolved now
 * from the passed maps + build graph, so a run doesn't drift if installed
 * content changes mid-play.
 *
 * Structure: a forward-only DAG of columns. Column 0 is the start; the last is
 * the boss; the middle columns hold 2-4 nodes each. Edges only ascend columns,
 * every node has an incoming and outgoing edge (no dead ends), and the boss is
 * reachable from every penultimate node.
 */

/** A map candidate for encounter placement, biased small-early / large-late. */
export interface GenRunMap {
  name: string;
  /** Coarse size score (e.g. width*height in elmos). Sorted ascending. */
  size?: number;
  mapDownload?: MapDownloadHint;
}

/** The game's build graph, for coherent unit-unlock rewards. */
export interface GenBuildGraph {
  startUnit: string;
  /** Lowercased adjacency (unit -> buildOptions), from `buildEdgeMap`. */
  edges: Map<string, string[]>;
  /** Display names by lowercased internal name. */
  names: Map<string, string>;
}

export interface GenerateRunOpts {
  seed: number;
  length: RunLength;
  difficulty: number;
  ascension?: number;
  game: GameRef;
  factionId: string;
  side?: string;
  skin: RunSkin;
  maps: GenRunMap[];
  /** Absent -> perk-only rewards and no unit gating (full arsenal). */
  build?: GenBuildGraph;
  /** Default enemy skirmish AI (`kind:shortName`) for encounters. */
  enemyAiKey?: string;
  /** Which of the start unit's build branches to pre-unlock (-1 = none). From
   * the chosen meta loadout; ignored without a build graph. */
  loadoutBranch?: number;
  /** Injected timestamp (tests); defaults to now. */
  now?: string;
}

/** Column count per run length. Column 0 = start, last column = boss. */
const COLUMNS: Record<RunLength, number> = {
  quick: 6,
  standard: 9,
  long: 13,
};

/** How many BFS-shallow units the player starts able to build. */
const STARTER_UNIT_COUNT = 12;

/** Tech tiers spread across the run (drives map size + enemy scaling). */
const MAX_TIER = 5;

function techTierForCol(col: number, cols: number): number {
  if (cols <= 2) return 1;
  const frac = col / (cols - 1);
  return Math.min(MAX_TIER, 1 + Math.floor(frac * MAX_TIER));
}

/** Enemy handicap % by tier (mirrors conquest's difficultyHandicap ramp). */
const TIER_HANDICAP = [0, 0, 10, 20, 30, 40];

function isBossType(type: RunNodeType): boolean {
  return type === "boss";
}

/**
 * Choose a map for an encounter, biased by depth: early columns draw from the
 * smaller maps, the boss from the largest. Maps are sorted by size; a windowed
 * index keyed on the depth fraction (with a little rng jitter) picks within.
 */
function pickMap(rng: Rng, maps: GenRunMap[], depthFrac: number): GenRunMap {
  const sorted = [...maps].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  const n = sorted.length;
  const center = depthFrac * (n - 1);
  const jitter = (rng() - 0.5) * Math.max(1, n * 0.25);
  const idx = Math.max(0, Math.min(n - 1, Math.round(center + jitter)));
  return sorted[idx];
}

/** Build an encounter spec for a battle/elite/boss node at a given column. */
function makeEncounter(
  rng: Rng,
  opts: GenerateRunOpts,
  col: number,
  cols: number,
  type: RunNodeType,
): EncounterSpec {
  const tier = techTierForCol(col, cols);
  const depthFrac = cols > 1 ? col / (cols - 1) : 0;
  const map = pickMap(rng, opts.maps, depthFrac);
  const diff = opts.difficulty + (opts.ascension ?? 0);

  const elite = type === "elite";
  const boss = isBossType(type);
  const enemyBase = 1 + Math.floor((tier - 1) / 2);
  const enemyAiCount = Math.max(
    1,
    Math.min(
      8,
      enemyBase +
        (elite ? 1 : 0) +
        (boss ? 2 : 0) +
        Math.max(0, Math.floor((diff - 2) / 2)),
    ),
  );
  const handicap = Math.max(
    0,
    Math.min(
      300,
      (TIER_HANDICAP[Math.min(tier, MAX_TIER)] ?? 0) +
        (elite ? 15 : 0) +
        (boss ? 30 : 0) +
        Math.max(0, (diff - 2) * 5),
    ),
  );

  return {
    mapName: map.name,
    mapDownload: map.mapDownload,
    enemyAiCount,
    enemyAiKey: opts.enemyAiKey,
    handicap,
    techTier: tier,
  };
}

// ---------------------------------------------------------------------------
// Unit-unlock rewards. Uses the build graph's BFS spanning tree so an unlock
// grants a *connected, buildable* subtree (the path from the start to a frontier
// unit plus its children) — never a deep unit whose builder is still disabled.
// ---------------------------------------------------------------------------

interface UnlockPlanner {
  /** BFS discovery order, root first. */
  order: string[];
  /** child -> parent in the BFS spanning tree. */
  parent: Map<string, string>;
  /** parent -> children in the BFS spanning tree. */
  children: Map<string, string[]>;
  names: Map<string, string>;
}

function planUnlocks(build: GenBuildGraph): UnlockPlanner {
  const { order, treeEdges } = buildBuildGraph(build.startUnit, build.edges);
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of treeEdges) {
    parent.set(e.child, e.parent);
    const kids = children.get(e.parent);
    if (kids) kids.push(e.child);
    else children.set(e.parent, [e.child]);
  }
  return { order, parent, children, names: build.names };
}

/** The connected unit set an unlock of `unit` grants: its path back to the
 * start plus its direct children (so both `unit` and what it builds become
 * buildable once the shallow chain is in). */
function unlockBranch(planner: UnlockPlanner, unit: string): string[] {
  const set = new Set<string>();
  let cur: string | undefined = unit;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    set.add(cur);
    cur = planner.parent.get(cur);
  }
  for (const child of planner.children.get(unit) ?? []) set.add(child);
  return [...set];
}

function unitName(planner: UnlockPlanner, unit: string): string {
  return planner.names.get(unit) ?? unit;
}

/** Draw an unlock option for a frontier unit at roughly `tier` depth. */
function drawUnlock(
  rng: Rng,
  planner: UnlockPlanner,
  tier: number,
  used: Set<string>,
): RewardOption | null {
  // Candidates are the not-yet-offered units past the starter kit, windowed by
  // tier so deeper unlocks appear later.
  const frontier = planner.order.slice(STARTER_UNIT_COUNT);
  const candidates = frontier.filter((u) => !used.has(u));
  if (candidates.length === 0) return null;
  const span = candidates.length;
  const lo = Math.floor(((tier - 1) / MAX_TIER) * span);
  const hi = Math.min(span, Math.ceil((tier / MAX_TIER) * span) + 2);
  const window = candidates.slice(lo, Math.max(lo + 1, hi));
  const unit = pick(rng, window.length > 0 ? window : candidates);
  used.add(unit);
  const branch = unlockBranch(planner, unit);
  return {
    kind: "unlock",
    unit,
    unitName: unitName(planner, unit),
    opens: branch.filter((u) => u !== unit),
  };
}

const PERK_POOL: Omit<Perk, "value">[] = [
  { kind: "advantage", label: "Overclocked Reactor" },
  { kind: "income", label: "Salvage Refinery" },
  { kind: "advantage", label: "Veteran Cadre" },
  { kind: "income", label: "Efficient Logistics" },
];

function drawPerk(rng: Rng, tier: number): Perk {
  const base = pick(rng, PERK_POOL);
  // Advantage scales in 0.05 steps; income in 0.1 steps, both rising with tier.
  const value =
    base.kind === "advantage"
      ? 0.05 * (1 + Math.floor(tier / 2))
      : 0.1 * (1 + Math.floor(tier / 2));
  return { ...base, value: Math.round(value * 100) / 100 };
}

function makeReward(
  rng: Rng,
  planner: UnlockPlanner | null,
  tier: number,
  used: Set<string>,
): RewardSpec {
  const options: RewardOption[] = [];
  // Two unlocks (if a build graph is present) + one perk, mirroring the mockup.
  if (planner) {
    for (let i = 0; i < 2; i++) {
      const unlock = drawUnlock(rng, planner, tier, used);
      if (unlock) options.push(unlock);
    }
  }
  options.push({ kind: "perk", perk: drawPerk(rng, tier) });
  return { title: "Salvage Cache", options };
}

// ---------------------------------------------------------------------------
// Events + shops. Generic engine-flavoured pool (no per-game authoring needed);
// a game manifest can override later.
// ---------------------------------------------------------------------------

function makeEvent(rng: Rng, tier: number): EventSpec {
  const salvage = 40 + tier * 20;
  const hullCost = 8 + tier * 3;
  const cards: EventSpec[] = [
    {
      title: "Derelict Hulk",
      body: "A dead warship drifts in the debris field. Boarding it is a risk — the reactor may still be live.",
      choices: [
        {
          label: "Strip it for salvage",
          detail: `+${salvage} salvage, -${hullCost} hull`,
          salvage,
          hull: -hullCost,
        },
        { label: "Leave it be", detail: "No change" },
      ],
    },
    {
      title: "Distress Signal",
      body: "A stranded engineering crew hails you. They offer expertise in exchange for passage.",
      choices: [
        {
          label: "Take them aboard",
          detail: "Gain a field upgrade",
          perk: drawPerk(rng, tier),
        },
        {
          label: "Requisition their cache",
          detail: `+${Math.round(salvage / 2)} salvage`,
          salvage: Math.round(salvage / 2),
        },
      ],
    },
    {
      title: "Repair Bay",
      body: "An automated depot offers to patch your hull — for a price in salvage.",
      choices: [
        {
          label: "Dock and repair",
          detail: `+${hullCost * 2} hull, -${salvage} salvage`,
          hull: hullCost * 2,
          salvage: -salvage,
        },
        { label: "Press on", detail: "No change" },
      ],
    },
  ];
  return pick(rng, cards);
}

function makeShop(
  rng: Rng,
  planner: UnlockPlanner | null,
  tier: number,
  used: Set<string>,
): ShopSpec {
  const offers = [];
  // A guaranteed budget perk, listed first and priced below a single same-tier
  // battle win (salvageReward ≈ 40 + tier*15) so a depot is never a dead stop:
  // the fight leading in always affords at least this. Drawn a tier softer than
  // the headline perk so the low price reads as a modest boon, not a discount.
  offers.push({
    cost: 20 + tier * 10,
    option: {
      kind: "perk",
      perk: drawPerk(rng, Math.max(1, tier - 1)),
    } as RewardOption,
  });
  if (planner) {
    for (let i = 0; i < 2; i++) {
      const unlock = drawUnlock(rng, planner, tier, used);
      if (unlock) offers.push({ cost: 60 + tier * 30, option: unlock });
    }
  }
  offers.push({
    cost: 40 + tier * 20,
    option: { kind: "perk", perk: drawPerk(rng, tier) } as RewardOption,
  });
  return {
    offers,
    restHull: 20 + tier * 5,
    restCost: 30 + tier * 15,
  };
}

// ---------------------------------------------------------------------------
// Node-type distribution + graph construction.
// ---------------------------------------------------------------------------

/** Weighted node-type draw for a middle column at depth fraction `p`. When
 * `allowShop` is false the shop weight is dropped, so a column adjacent to one
 * that already has a depot never rolls another (no depot→depot on any path). */
function drawNodeType(rng: Rng, p: number, allowShop = true): RunNodeType {
  // Weights shift from battle/shop-heavy early to elite/reward-heavy late.
  const weights: [RunNodeType, number][] = [
    ["battle", 6 - Math.round(p * 3)],
    ["elite", Math.round(p * 4)],
    ["event", 3],
    ["reward", 2 + Math.round(p * 2)],
    ["shop", allowShop ? 2 : 0],
  ];
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  let r = rng() * total;
  for (const [type, w] of weights) {
    r -= Math.max(0, w);
    if (r <= 0) return type;
  }
  return "battle";
}

/**
 * Link two adjacent columns forward with a *planar* (non-crossing) set of
 * edges: every `to` gets an incoming edge from its proportionally-nearest
 * `from`, and every `from` gets an outgoing edge to its proportional `to`.
 * Because both mappings are monotonic (row order preserved on both sides), no
 * two lanes ever cross — the map reads as clean forward columns instead of a
 * tangle. Rows are index-ordered, so proportional index = order-preserving.
 */
function linkColumns(from: RunNode[], to: RunNode[]): RunEdge[] {
  const edges: RunEdge[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string) => {
    const key = `${a} ${b}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push([a, b]);
    }
  };
  const n = from.length;
  const m = to.length;
  // Each `to` gets its incoming from the proportional `from` (covers every to).
  for (let j = 0; j < m; j++) {
    const i = m <= 1 ? Math.floor(n / 2) : Math.round((j * (n - 1)) / (m - 1));
    add(from[i].id, to[j].id);
  }
  // Each `from` gets an outgoing to the proportional `to` (covers every from).
  for (let i = 0; i < n; i++) {
    const j = n <= 1 ? Math.floor(m / 2) : Math.round((i * (m - 1)) / (n - 1));
    add(from[i].id, to[j].id);
  }
  return edges;
}

/** Starting hull scales down with difficulty + ascension. */
function maxHullFor(difficulty: number, ascension: number): number {
  return Math.max(40, 120 - difficulty * 10 - ascension * 10);
}

export function generateRun(opts: GenerateRunOpts): RogueliteRun {
  const rng = mulberry32(opts.seed >>> 0);
  const cols = COLUMNS[opts.length];
  const planner = opts.build ? planUnlocks(opts.build) : null;
  const usedUnlocks = new Set<string>();

  const columns: RunNode[][] = [];

  // Column 0: the start.
  columns.push([{ id: "start", type: "start", col: 0, row: 0 }]);

  // Middle columns 1..cols-2. Track whether the previous column placed a depot
  // so the next never does — no two depots are ever reachable back-to-back.
  let prevColHadShop = false;
  for (let c = 1; c <= cols - 2; c++) {
    const p = c / (cols - 1);
    const count = randInt(rng, 2, 4);
    const nodes: RunNode[] = [];
    // The penultimate column force-places a depot (the pre-boss rest), so the
    // column right before it must stay depot-free too.
    const nextForcesShop = c === cols - 3;
    const allowShop = !prevColHadShop && !nextForcesShop;
    for (let i = 0; i < count; i++) {
      // The first fight column is all battles; the penultimate column always
      // offers a shop (a rest before the boss) in its first slot.
      let type: RunNodeType;
      if (c === 1) type = "battle";
      else if (c === cols - 2 && i === 0) type = "shop";
      else type = drawNodeType(rng, p, allowShop);

      const tier = techTierForCol(c, cols);
      const node: RunNode = { id: `c${c}n${i}`, type, col: c, row: i };
      if (type === "battle" || type === "elite") {
        node.battle = makeEncounter(rng, opts, c, cols, type);
      } else if (type === "reward") {
        node.reward = makeReward(rng, planner, tier, usedUnlocks);
      } else if (type === "event") {
        node.event = makeEvent(rng, tier);
      } else if (type === "shop") {
        node.shop = makeShop(rng, planner, tier, usedUnlocks);
      }
      nodes.push(node);
    }
    prevColHadShop = nodes.some((n) => n.type === "shop");
    columns.push(nodes);
  }

  // Final column: the boss.
  const bossCol = cols - 1;
  const boss: RunNode = {
    id: "boss",
    type: "boss",
    col: bossCol,
    row: 0,
    battle: makeEncounter(rng, opts, bossCol, cols, "boss"),
  };
  columns.push([boss]);

  // Edges: link every adjacent pair of columns forward.
  const edges: RunEdge[] = [];
  for (let c = 0; c < columns.length - 1; c++) {
    edges.push(...linkColumns(columns[c], columns[c + 1]));
  }

  const nodes = columns.flat();

  // Seed the arsenal with the shallowest connected build subtree, so the first
  // encounter is playable before any unlock. A loadout pre-unlocks one of the
  // commander's build branches on top, opening the run committed to a doctrine.
  let unlockedUnits: string[] = planner
    ? planner.order.slice(0, STARTER_UNIT_COUNT)
    : [];
  if (planner && opts.loadoutBranch != null && opts.loadoutBranch >= 0) {
    const roots = planner.children.get(planner.order[0]) ?? [];
    const root = roots[opts.loadoutBranch];
    if (root) {
      unlockedUnits = [
        ...new Set([...unlockedUnits, ...unlockBranch(planner, root)]),
      ];
    }
  }

  const difficulty = opts.difficulty;
  const ascension = opts.ascension ?? 0;
  const maxHull = maxHullFor(difficulty, ascension);
  const now = opts.now ?? new Date().toISOString();

  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: sectorNameForSeed(opts.seed),
    settings: {
      seed: opts.seed,
      length: opts.length,
      difficulty,
      ascension,
      game: opts.game,
      factionId: opts.factionId,
      side: opts.side,
      skin: opts.skin,
    },
    startUnit: opts.build?.startUnit,
    nodes,
    edges,
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: maxHull,
      maxHull,
      salvage: 0,
      unlockedUnits,
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}
