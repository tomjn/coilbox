import type { MapDownloadHint } from "../campaign/model";
import { parseMapDownload } from "../campaign/model";
import type { GameRef } from "../conquest/model";
import { sectorNameForSeed } from "../conquest/names";

/**
 * Roguelite-run schema — the single source of truth for the shape of an active
 * run and its persistent meta-progression. Rust stores both as opaque JSON, so
 * this file (and {@link parseRunJson} / {@link parseRunMeta}) is the only place
 * the shape is defined, validated and (in future) migrated.
 *
 * A run rides the conquest battle engine (see `src/conquest/synthesize.ts`,
 * `src/play`), but its schema is deliberately independent: a run is a
 * forward-only node graph crossed once, not a persistent territory galaxy. It
 * reuses {@link GameRef} (game resolution is identical) and campaign's
 * {@link MapDownloadHint} (map install gating), nothing else.
 */

/** How long a run is — maps to an act/column count in the generator. */
export type RunLength = "quick" | "standard" | "long";

/** Presentation of the node map. `theatre` is the flat skin for terrestrial
 * games where a starfield makes no sense (see the conquest renderer). */
export type RunSkin = "galaxy" | "theatre";

/**
 * Node kinds on the run graph. Battle-like nodes (`battle`/`elite`/`boss`)
 * launch a skirmish; the rest resolve instantly by mutating run state.
 */
export type RunNodeType =
  | "start"
  | "battle"
  | "elite"
  | "boss"
  | "reward"
  | "event"
  | "shop";

/** The battle-launching node kinds. */
export const BATTLE_NODE_TYPES: readonly RunNodeType[] = [
  "battle",
  "elite",
  "boss",
];

/** True for the node kinds that launch a skirmish. */
export function isBattleNode(type: RunNodeType): boolean {
  return type === "battle" || type === "elite" || type === "boss";
}

/**
 * How a battle node's skirmish is set up. A subset of conquest's
 * `NodeBattleSpec`, baked at generation time so a run is self-contained (its
 * encounters don't drift if installed content changes mid-run).
 */
export interface EncounterSpec {
  mapName: string;
  /** Optional install-gate download override for the map. */
  mapDownload?: MapDownloadHint;
  /** Enemy AI count (already depth-scaled by the generator). */
  enemyAiCount: number;
  /** Skirmish AI override for this node's enemies (`kind:shortName`). */
  enemyAiKey?: string;
  startPosType?: number;
  modOptionValues?: Record<string, string>;
  /** Enemy team handicap % (already depth-scaled). */
  handicap: number;
  /**
   * Shared tech-ceiling tier for this encounter (1..N by depth). The disabled
   * set is `reachableFrom(startUnit) − unlocked` computed at launch; the tier
   * is carried for UI (the "Arsenal" gauge) and generation biasing.
   */
  techTier: number;
}

/** A personal, per-team power boost. Both map to engine levers the play crate
 * already emits per team (`Advantage`, `IncomeMultiplier`); unit unlocks, by
 * contrast, raise a *shared* ceiling and are not perks. */
export type PerkKind = "advantage" | "income";

export interface Perk {
  kind: PerkKind;
  /**
   * Magnitude added to the player team's lever: for `advantage`, an
   * `Advantage` fraction addend (0.1 = +10%); for `income`, an
   * `IncomeMultiplier` addend.
   */
  value: number;
  label: string;
}

/**
 * One option offered at a reward node (choose 1 of N). An `unlock` widens the
 * shared arsenal along a real `buildOptions` edge; a `perk` is your personal
 * edge.
 */
export type RewardOption =
  | { kind: "unlock"; unit: string; unitName: string; opens: string[] }
  | { kind: "perk"; perk: Perk };

export interface RewardSpec {
  title: string;
  options: RewardOption[];
}

/** A branch of an event card: label + the mutations applied when chosen. */
export interface EventChoice {
  label: string;
  /** Flavour shown under the label. */
  detail?: string;
  /** Hull delta (+restore / -cost). */
  hull?: number;
  /** Salvage delta. */
  salvage?: number;
  /** A perk granted by taking this choice. */
  perk?: Perk;
  /** A unit unlocked by taking this choice. */
  unlock?: string;
}

export interface EventSpec {
  title: string;
  body: string;
  choices: EventChoice[];
}

/** One purchasable line in a shop. */
export interface ShopOffer {
  cost: number;
  option: RewardOption;
}

export interface ShopSpec {
  offers: ShopOffer[];
  /** Hull restored by the shop's Rest option, if offered. */
  restHull?: number;
  /** Salvage cost of the Rest option. */
  restCost?: number;
}

/**
 * One node on the run graph. Structure only (position + baked content); the
 * dynamic per-node state (done/current/open/locked) is *derived* from
 * {@link RunProgress} and the edges, never stored here — mirroring how conquest
 * keeps `owners` out of the node.
 */
export interface RunNode {
  id: string;
  type: RunNodeType;
  /** Column / forward rank (0 = start). Drives the column layout X axis. */
  col: number;
  /** Position within the column (cross-axis), for layout Z. */
  row: number;
  /** Present on battle/elite/boss nodes. */
  battle?: EncounterSpec;
  /** Present on reward nodes. */
  reward?: RewardSpec;
  /** Present on event nodes. */
  event?: EventSpec;
  /** Present on shop nodes. */
  shop?: ShopSpec;
}

/** A directed forward edge `[from, to]` with `from.col < to.col`. */
export type RunEdge = [string, string];

export interface RunSettings {
  /** Everything procedural is deterministic from this seed. */
  seed: number;
  length: RunLength;
  /** Base difficulty 1..5. */
  difficulty: number;
  /** Meta ascension tier applied on top of difficulty (0 = none). */
  ascension: number;
  game: GameRef;
  factionId: string;
  /** In-game side for the player's participant. */
  side?: string;
  skin: RunSkin;
}

export type RunStatus = "active" | "won" | "lost";

/** The live, mutable state of a run. */
export interface RunProgress {
  /** The node the player currently occupies. */
  currentNodeId: string;
  /** Nodes resolved so far (includes `currentNodeId` once entered). */
  visited: string[];
  hull: number;
  maxHull: number;
  salvage: number;
  /** Internal unit names unlocked into the shared arsenal. */
  unlockedUnits: string[];
  perks: Perk[];
  status: RunStatus;
}

export interface RunHistoryEntry {
  nodeId: string;
  type: RunNodeType;
  outcome?: "victory" | "defeat";
  note?: string;
}

export const HULL_MIN = 1;
export const HULL_MAX = 999;
export const HISTORY_CAP = 200;

/** A whole active run: static graph + live progress. */
export interface RogueliteRun {
  schemaVersion: 1;
  type: "roguelite-run";
  /** Evocative sector name shown in the breadcrumb + hub list. Derived from the
   * seed (see {@link sectorNameForSeed}), so it's stable and backfilled for
   * saves that predate the field. */
  name: string;
  settings: RunSettings;
  /** The game's build-tree root, resolved at generation for the disabled-set
   * computation. Absent if the dataset was unavailable (perk-only rewards). */
  startUnit?: string;
  nodes: RunNode[];
  edges: RunEdge[];
  progress: RunProgress;
  history: RunHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  /** Set when this run was created by importing a challenge code/file (see
   * `./challenge.ts`) rather than generated locally — shown on the hub list so
   * a shared-seed run's provenance stays visible. */
  importedChallenge?: boolean;
}

/**
 * The active-runs state document: many runs keyed by an opaque id, so warpaths
 * for different games/factions coexist instead of overwriting one another
 * (mirroring conquest, which keys many runs by galaxy id). Identity lives in the
 * map key, not on the run, so the run schema is unchanged.
 */
export interface RunStateFile {
  schemaVersion: 1;
  runs: Record<string, RogueliteRun>;
}

/** Persistent between-run unlocks. "Options, not raw power." */
export interface RogueliteMeta {
  schemaVersion: 1;
  /** Unlocked starting-loadout ids offered at run setup. */
  loadouts: string[];
  /** Unlocked event-pool ids drawn into the event deck. */
  eventPools: string[];
  /** Highest ascension difficulty tier the player may pick. */
  ascensionTier: number;
  stats: RunStats;
}

export interface RunStats {
  runs: number;
  wins: number;
  /** Deepest column reached across all runs. */
  deepest: number;
}

export const emptyStateFile: RunStateFile = { schemaVersion: 1, runs: {} };

export const emptyMeta: RogueliteMeta = {
  schemaVersion: 1,
  loadouts: [],
  eventPools: [],
  ascensionTier: 0,
  stats: { runs: 0, wins: 0, deepest: 0 },
};

// ---------------------------------------------------------------------------
// Parsing / validation. A saved run is untrusted on load (it may predate a
// schema change), so parse defensively and repair rather than trust the blob.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const RUN_NODE_TYPES: readonly RunNodeType[] = [
  "start",
  "battle",
  "elite",
  "boss",
  "reward",
  "event",
  "shop",
];

function parsePerk(value: unknown): Perk | null {
  if (!isRecord(value)) return null;
  if (value.kind !== "advantage" && value.kind !== "income") return null;
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
    return null;
  }
  return {
    kind: value.kind,
    value: value.value,
    label: typeof value.label === "string" ? value.label : "",
  };
}

function parseRewardOption(value: unknown): RewardOption | null {
  if (!isRecord(value)) return null;
  if (value.kind === "unlock") {
    if (typeof value.unit !== "string" || value.unit === "") return null;
    return {
      kind: "unlock",
      unit: value.unit,
      unitName:
        typeof value.unitName === "string" ? value.unitName : value.unit,
      opens: stringArray(value.opens),
    };
  }
  if (value.kind === "perk") {
    const perk = parsePerk(value.perk);
    return perk ? { kind: "perk", perk } : null;
  }
  return null;
}

function parseEncounter(value: unknown): EncounterSpec | null {
  if (!isRecord(value)) return null;
  if (typeof value.mapName !== "string" || value.mapName === "") return null;
  let modOptionValues: Record<string, string> | undefined;
  if (isRecord(value.modOptionValues)) {
    const entries = Object.entries(value.modOptionValues).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    );
    if (entries.length > 0) modOptionValues = Object.fromEntries(entries);
  }
  return {
    mapName: value.mapName,
    mapDownload: parseMapDownload(value.mapDownload),
    enemyAiCount: clamp(Math.round(num(value.enemyAiCount, 1)), 1, 16),
    enemyAiKey:
      typeof value.enemyAiKey === "string" && value.enemyAiKey !== ""
        ? value.enemyAiKey
        : undefined,
    startPosType:
      typeof value.startPosType === "number" &&
      Number.isFinite(value.startPosType)
        ? value.startPosType
        : undefined,
    modOptionValues,
    handicap: clamp(Math.round(num(value.handicap, 0)), 0, 300),
    techTier: clamp(Math.round(num(value.techTier, 1)), 1, 99),
  };
}

function parseReward(value: unknown): RewardSpec | undefined {
  if (!isRecord(value)) return undefined;
  const options = Array.isArray(value.options)
    ? value.options.map(parseRewardOption).filter((o): o is RewardOption => !!o)
    : [];
  return {
    title: typeof value.title === "string" ? value.title : "Salvage",
    options,
  };
}

function parseEvent(value: unknown): EventSpec | undefined {
  if (!isRecord(value)) return undefined;
  const choices = Array.isArray(value.choices)
    ? value.choices.filter(isRecord).map((c): EventChoice => {
        const perk = parsePerk(c.perk);
        return {
          label: typeof c.label === "string" ? c.label : "Continue",
          detail: typeof c.detail === "string" ? c.detail : undefined,
          hull:
            typeof c.hull === "number" && Number.isFinite(c.hull)
              ? Math.round(c.hull)
              : undefined,
          salvage:
            typeof c.salvage === "number" && Number.isFinite(c.salvage)
              ? Math.round(c.salvage)
              : undefined,
          perk: perk ?? undefined,
          unlock:
            typeof c.unlock === "string" && c.unlock !== ""
              ? c.unlock
              : undefined,
        };
      })
    : [];
  return {
    title: typeof value.title === "string" ? value.title : "Signal",
    body: typeof value.body === "string" ? value.body : "",
    choices,
  };
}

function parseShop(value: unknown): ShopSpec | undefined {
  if (!isRecord(value)) return undefined;
  const offers = Array.isArray(value.offers)
    ? value.offers
        .filter(isRecord)
        .map((o): ShopOffer | null => {
          const option = parseRewardOption(o.option);
          if (!option) return null;
          return { cost: clamp(Math.round(num(o.cost, 0)), 0, 99999), option };
        })
        .filter((o): o is ShopOffer => !!o)
    : [];
  return {
    offers,
    restHull:
      typeof value.restHull === "number" && Number.isFinite(value.restHull)
        ? Math.round(value.restHull)
        : undefined,
    restCost:
      typeof value.restCost === "number" && Number.isFinite(value.restCost)
        ? Math.round(value.restCost)
        : undefined,
  };
}

function parseNode(value: unknown): RunNode | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id === "") return null;
  if (!RUN_NODE_TYPES.includes(value.type as RunNodeType)) return null;
  const type = value.type as RunNodeType;
  return {
    id: value.id,
    type,
    col: clamp(Math.round(num(value.col, 0)), 0, 9999),
    row: num(value.row, 0),
    battle: parseEncounter(value.battle) ?? undefined,
    reward: parseReward(value.reward),
    event: parseEvent(value.event),
    shop: parseShop(value.shop),
  };
}

/** Parse a `RunSettings` blob — exported for reuse by the challenge codec
 * (`./challenge.ts`), which validates a shared-code payload with the same
 * rules as a saved run's settings. */
export function parseRunSettings(value: unknown): RunSettings | null {
  if (!isRecord(value)) return null;
  const game = value.game;
  if (
    !isRecord(game) ||
    typeof game.shortname !== "string" ||
    game.shortname === ""
  ) {
    return null;
  }
  if (typeof value.factionId !== "string" || value.factionId === "") {
    return null;
  }
  return {
    seed: num(value.seed, 0),
    length:
      value.length === "quick" ||
      value.length === "standard" ||
      value.length === "long"
        ? value.length
        : "standard",
    difficulty: clamp(Math.round(num(value.difficulty, 2)), 1, 5),
    ascension: clamp(Math.round(num(value.ascension, 0)), 0, 99),
    game: {
      shortname: game.shortname,
      pinnedName:
        typeof game.pinnedName === "string" && game.pinnedName !== ""
          ? game.pinnedName
          : undefined,
    },
    factionId: value.factionId,
    side:
      typeof value.side === "string" && value.side !== ""
        ? value.side
        : undefined,
    skin: value.skin === "theatre" ? "theatre" : "galaxy",
  };
}

function parseProgress(
  value: unknown,
  nodeIds: Set<string>,
): RunProgress | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.currentNodeId !== "string" ||
    !nodeIds.has(value.currentNodeId)
  ) {
    return null;
  }
  const maxHull = clamp(
    Math.round(num(value.maxHull, 100)),
    HULL_MIN,
    HULL_MAX,
  );
  return {
    currentNodeId: value.currentNodeId,
    visited: stringArray(value.visited).filter((id) => nodeIds.has(id)),
    maxHull,
    hull: clamp(Math.round(num(value.hull, maxHull)), 0, maxHull),
    salvage: clamp(Math.round(num(value.salvage, 0)), 0, 99999),
    unlockedUnits: stringArray(value.unlockedUnits),
    perks: Array.isArray(value.perks)
      ? value.perks.map(parsePerk).filter((p): p is Perk => !!p)
      : [],
    status:
      value.status === "won" || value.status === "lost"
        ? value.status
        : "active",
  };
}

/**
 * Parse the raw JSON of a saved run into a validated {@link RogueliteRun}, or
 * `null` if the shape is unusable (no valid settings, no nodes, or a progress
 * pointer into a missing node). This is the single untrusted-input validator
 * and the future migration point. Malformed optionals are dropped; edges
 * referencing unknown nodes or pointing backwards are pruned.
 */
export function parseRunJson(json: string): RogueliteRun | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.type !== "roguelite-run") return null;

  const settings = parseRunSettings(data.settings);
  if (!settings) return null;

  const nodes: RunNode[] = [];
  const nodeIds = new Set<string>();
  const colById = new Map<string, number>();
  if (!Array.isArray(data.nodes)) return null;
  for (const raw of data.nodes) {
    const node = parseNode(raw);
    if (!node || nodeIds.has(node.id)) return null;
    nodeIds.add(node.id);
    colById.set(node.id, node.col);
    nodes.push(node);
  }
  if (nodes.length === 0) return null;

  const edges: RunEdge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data.edges)) {
    for (const raw of data.edges) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      const [a, b] = raw;
      if (typeof a !== "string" || typeof b !== "string") continue;
      if (!nodeIds.has(a) || !nodeIds.has(b) || a === b) continue;
      // Forward-only: an edge must ascend columns.
      if ((colById.get(a) ?? 0) >= (colById.get(b) ?? 0)) continue;
      const key = `${a}\0${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }

  const progress = parseProgress(data.progress, nodeIds);
  if (!progress) return null;

  const history: RunHistoryEntry[] = Array.isArray(data.history)
    ? data.history
        .filter(isRecord)
        .filter((h) => typeof h.nodeId === "string" && nodeIds.has(h.nodeId))
        .map(
          (h): RunHistoryEntry => ({
            nodeId: h.nodeId as string,
            type: RUN_NODE_TYPES.includes(h.type as RunNodeType)
              ? (h.type as RunNodeType)
              : "battle",
            outcome:
              h.outcome === "victory" || h.outcome === "defeat"
                ? h.outcome
                : undefined,
            note: typeof h.note === "string" ? h.note : undefined,
          }),
        )
        .slice(-HISTORY_CAP)
    : [];

  const now = () => new Date().toISOString();
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    // Backfill a stable name for saves that predate the field (derived from the
    // seed, so it matches a freshly generated run of the same seed).
    name:
      typeof data.name === "string" && data.name !== ""
        ? data.name
        : sectorNameForSeed(settings.seed),
    settings,
    startUnit:
      typeof data.startUnit === "string" && data.startUnit !== ""
        ? data.startUnit
        : undefined,
    nodes,
    edges,
    progress,
    history,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : now(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : now(),
    importedChallenge: data.importedChallenge === true ? true : undefined,
  };
}

/**
 * Heal a parsed run against its own graph after load: clamp hull to
 * `[0, maxHull]`, drop visited/unlock duplicates, and derive `status` from the
 * hull and whether the boss was cleared. Structural validation already happened
 * in {@link parseRunJson}; this is the idempotent post-load repair (mirrors
 * conquest's `reconcileState`).
 */
export function reconcileRun(run: RogueliteRun): RogueliteRun {
  const p = run.progress;
  const hull = clamp(Math.round(p.hull), 0, p.maxHull);
  const visited = [...new Set(p.visited)];
  const unlockedUnits = [...new Set(p.unlockedUnits)];

  // A dead hull is a lost run even if the blob said otherwise.
  let status: RunStatus = p.status;
  if (hull <= 0) status = "lost";

  // Invariant: the current node is always a resolved (visited) node — it's the
  // last place you committed to. Older saves (or a mid-battle interruption)
  // could point it at an unvisited node; heal it to the deepest visited node so
  // the player isn't stranded.
  let currentNodeId = p.currentNodeId;
  if (!visited.includes(currentNodeId)) {
    let deepest = run.nodes[0];
    for (const n of run.nodes) {
      if (visited.includes(n.id) && n.col >= (deepest?.col ?? -1)) deepest = n;
    }
    currentNodeId = deepest?.id ?? currentNodeId;
  }

  if (
    hull === p.hull &&
    visited.length === p.visited.length &&
    unlockedUnits.length === p.unlockedUnits.length &&
    status === p.status &&
    currentNodeId === p.currentNodeId
  ) {
    return run;
  }
  return {
    ...run,
    progress: { ...p, hull, visited, unlockedUnits, status, currentNodeId },
  };
}

/**
 * Parse the run-state document into a map of healed runs keyed by id, skipping
 * any that fail {@link parseRunJson} validation. Migrates the legacy single-run
 * shape (`{ run: <run> }`, at most one) into a one-entry map so an in-flight run
 * saved before multi-run support isn't lost. Always returns a usable file, even
 * from garbage input.
 */
export function parseRunStateFile(json: string): RunStateFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { schemaVersion: 1, runs: {} };
  }
  if (!isRecord(data)) return { schemaVersion: 1, runs: {} };

  const runs: Record<string, RogueliteRun> = {};

  // Current shape: a keyed map of runs.
  if (isRecord(data.runs)) {
    for (const [id, raw] of Object.entries(data.runs)) {
      if (!id) continue;
      const parsed = parseRunJson(JSON.stringify(raw));
      if (parsed) runs[id] = reconcileRun(parsed);
    }
  }

  // Legacy migration: a single `run` from before multi-run storage. A stable id
  // (seed + creation time) keeps the key identical across reloads.
  if (Object.keys(runs).length === 0 && isRecord(data.run)) {
    const parsed = parseRunJson(JSON.stringify(data.run));
    if (parsed) {
      runs[`run-${parsed.settings.seed}-${parsed.createdAt}`] =
        reconcileRun(parsed);
    }
  }

  return { schemaVersion: 1, runs };
}

/** Parse the raw JSON of the meta document, falling back to an empty meta. */
export function parseRunMeta(json: string): RogueliteMeta {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return emptyMeta;
  }
  if (!isRecord(data)) return emptyMeta;
  const stats = isRecord(data.stats) ? data.stats : {};
  return {
    schemaVersion: 1,
    loadouts: stringArray(data.loadouts),
    eventPools: stringArray(data.eventPools),
    ascensionTier: clamp(Math.round(num(data.ascensionTier, 0)), 0, 99),
    stats: {
      runs: clamp(Math.round(num(stats.runs, 0)), 0, 999999),
      wins: clamp(Math.round(num(stats.wins, 0)), 0, 999999),
      deepest: clamp(Math.round(num(stats.deepest, 0)), 0, 999999),
    },
  };
}
