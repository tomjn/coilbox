import type { MapDownloadHint } from "../campaign/model";
import { parseMapDownload } from "../campaign/model";
import { type GameRef, type MapSkin, readMapSkin } from "../conquest/model";
import { sectorNameForSeed } from "../conquest/names";
import { clamp } from "../lib/helpers";

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

/** Presentation of the node map, in the styles Conquest has. `galaxy` and
 * `theatre` draw the run in columns. `cities` and `territories` are a run
 * across a generated land map, which `RunSettings.map` then names. */
export type RunSkin = MapSkin;

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
  /**
   * The map this encounter was meant to be fought on, when `mapName` is a
   * stand-in. Set when an imported challenge names a map this install cannot
   * offer, so the difference is visible rather than silent (issue #1393).
   */
  mapSubstitutedFrom?: string;
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
  /** The id of the map location this node stands for, on a run across a land
   * map (see `./mapRun.ts`). Absent on a Galaxy or Theatre run, whose nodes are
   * laid out in columns. */
  location?: string;
}

/**
 * How a run across a land map finds that map again. The map is not saved with
 * the run: a generated one is rebuilt from these settings, and a hand-made one
 * is looked up by its id. See `resolveRunMap` in `./mapRun.ts`.
 */
export type RunMapRef =
  | {
      source: "generated";
      /** Which generator made it: `territories` or `cities`. */
      style: string;
      /** The map's own seed, which need not be the run's. */
      seed: number;
      nodeCount: number;
      /** The generator's layout setting, as the map document recorded it. */
      layout?: string;
    }
  | { source: "handmade"; id: string };

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
  /** Present on a run across a land map. Part of the settings so a challenge
   * code carries it and the recipient crosses the same map. */
  map?: RunMapRef;
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
  /** The newer version of the run's game the player declined to move to, so it
   * is not offered again (issue #3465). Kept on the run, not its settings,
   * which a shared challenge code carries. */
  declinedGameUpdate?: string;
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
  /** Entries that failed validation, as the raw JSON values they had in the
   *  file, under the key they had. They are not runs for play, and a write puts
   *  them back unchanged so a save never drops them. */
  unreadable: Record<string, unknown>;
}

/** The version of the meta document this code writes. */
export const META_SCHEMA_VERSION = 2;

/** One record of unlocks and totals. Every game has one, and `legacy` is one. */
export interface UnlockRecord {
  /** Unlocked starting-loadout ids offered at run setup. */
  loadouts: string[];
  /** Unlocked event-pool ids drawn into the event deck. */
  eventPools: string[];
  /** Highest ascension difficulty tier the player may pick. */
  ascensionTier: number;
  stats: RunStats;
  /** Run ids already counted, so reopening a finished run cannot count it
   * twice. Empty on `legacy` until a run with no game is counted there. */
  seen: string[];
}

/**
 * Persistent between-run unlocks. "Options, not raw power."
 *
 * One record per game, keyed by lower case shortname (as Conquest's unlocks
 * are), plus `legacy`: what was earned before records were kept per game, which
 * cannot be attributed to a game. What a game offers at setup is the union of
 * `legacy` and that game's own record (see `unlocksFor` in `./meta`).
 *
 * `schemaVersion` is a plain number because a document written by a newer
 * version is read as it is and never written back.
 */
export interface RogueliteMeta {
  schemaVersion: number;
  legacy: UnlockRecord;
  games: Record<string, UnlockRecord>;
  /** True once the runs already finished on disk have been added to `seen`.
   * Until then nothing is awarded. Never set by `migrateMeta`, which cannot see
   * the runs. */
  seenSeeded?: boolean;
}

export interface RunStats {
  runs: number;
  wins: number;
  /** Deepest column reached across all runs. */
  deepest: number;
}

export const emptyStateFile: RunStateFile = {
  schemaVersion: 1,
  runs: {},
  unreadable: {},
};

export const emptyRecord: UnlockRecord = {
  loadouts: [],
  eventPools: [],
  ascensionTier: 0,
  stats: { runs: 0, wins: 0, deepest: 0 },
  seen: [],
};

export const emptyMeta: RogueliteMeta = {
  schemaVersion: META_SCHEMA_VERSION,
  legacy: emptyRecord,
  games: {},
};

// ---------------------------------------------------------------------------
// Parsing / validation. A saved run is untrusted on load (it may predate a
// schema change), so parse defensively and repair rather than trust the blob.
// ---------------------------------------------------------------------------

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
    mapSubstitutedFrom:
      typeof value.mapSubstitutedFrom === "string" &&
      value.mapSubstitutedFrom !== ""
        ? value.mapSubstitutedFrom
        : undefined,
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
    ...(typeof value.location === "string" && value.location !== ""
      ? { location: value.location }
      : {}),
  };
}

/** Parse a run's map reference. Null for anything that is not one, which reads
 * as a run with no map. */
function parseRunMapRef(value: unknown): RunMapRef | null {
  if (!isRecord(value)) return null;
  if (value.source === "handmade") {
    return typeof value.id === "string" && value.id !== ""
      ? { source: "handmade", id: value.id }
      : null;
  }
  if (value.source !== "generated") return null;
  if (typeof value.style !== "string" || value.style === "") return null;
  if (typeof value.seed !== "number" || !Number.isFinite(value.seed)) {
    return null;
  }
  if (
    typeof value.nodeCount !== "number" ||
    !Number.isFinite(value.nodeCount)
  ) {
    return null;
  }
  return {
    source: "generated",
    style: value.style,
    seed: value.seed,
    nodeCount: value.nodeCount,
    ...(typeof value.layout === "string" && value.layout !== ""
      ? { layout: value.layout }
      : {}),
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
  const map = parseRunMapRef(value.map);
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
    skin: readMapSkin(value.skin) ?? "galaxy",
    ...(map ? { map } : {}),
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
    declinedGameUpdate:
      typeof data.declinedGameUpdate === "string" &&
      data.declinedGameUpdate !== ""
        ? data.declinedGameUpdate
        : undefined,
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

/** The version of the run file this build reads and writes. */
export const RUN_STATE_SCHEMA_VERSION = 1;

/**
 * Parse the run-state document into a map of healed runs keyed by id. Migrates
 * the legacy single-run shape (`{ run: <run> }`, at most one) into a one-entry
 * map so an in-flight run saved before multi-run support isn't lost.
 *
 * An empty string is an empty file, as is the plugin's default for a file that
 * does not exist. Anything else that cannot be read as a whole throws, because
 * reading it as empty would let the next save replace every run: text that is
 * not JSON, JSON of the wrong shape, and a file made by a newer version.
 *
 * A single entry that fails {@link parseRunJson} does not fail the load. It is
 * kept as its raw JSON value in `unreadable`, under its key, so the other runs
 * stay playable and a save writes it back as it was.
 */
export function parseRunStateFile(json: string): RunStateFile {
  if (json.trim() === "") return emptyStateFile;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("run.json is not valid JSON");
  }
  if (!isRecord(data) || Array.isArray(data)) {
    throw new Error("run.json is not a JSON object");
  }
  if (
    typeof data.schemaVersion === "number" &&
    data.schemaVersion > RUN_STATE_SCHEMA_VERSION
  ) {
    throw new Error(
      `run.json was made by a newer version of coilbox (file version ${data.schemaVersion}, this version reads ${RUN_STATE_SCHEMA_VERSION})`,
    );
  }

  const runs: Record<string, RogueliteRun> = {};
  const unreadable: Record<string, unknown> = {};

  // Current shape: a keyed map of runs.
  if (data.runs !== undefined) {
    if (!isRecord(data.runs) || Array.isArray(data.runs)) {
      throw new Error("run.json has a runs entry that is not an object");
    }
    for (const [id, raw] of Object.entries(data.runs)) {
      const parsed = id ? parseRunJson(JSON.stringify(raw)) : null;
      if (parsed) runs[id] = reconcileRun(parsed);
      else unreadable[id] = raw;
    }
  } else if (data.run === undefined) {
    throw new Error("run.json has no runs");
  }

  // Legacy migration: a single `run` from before multi-run storage. A stable id
  // (seed + creation time) keeps the key identical across reloads. One that
  // cannot be read is kept raw under a key of its own and written into `runs`.
  if (
    Object.keys(runs).length === 0 &&
    data.run !== undefined &&
    data.run !== null
  ) {
    const parsed = parseRunJson(JSON.stringify(data.run));
    if (parsed) {
      runs[`run-${parsed.settings.seed}-${parsed.createdAt}`] =
        reconcileRun(parsed);
    } else {
      let key = "legacy-run";
      while (key in unreadable) key += "-";
      unreadable[key] = data.run;
    }
  }

  return { schemaVersion: 1, runs, unreadable };
}

function parseRecord(data: unknown): UnlockRecord {
  const d = isRecord(data) ? data : {};
  const stats = isRecord(d.stats) ? d.stats : {};
  return {
    loadouts: stringArray(d.loadouts),
    eventPools: stringArray(d.eventPools),
    ascensionTier: clamp(Math.round(num(d.ascensionTier, 0)), 0, 99),
    stats: {
      runs: clamp(Math.round(num(stats.runs, 0)), 0, 999999),
      wins: clamp(Math.round(num(stats.wins, 0)), 0, 999999),
      deepest: clamp(Math.round(num(stats.deepest, 0)), 0, 999999),
    },
    seen: stringArray(d.seen),
  };
}

/**
 * Bring a stored meta document to the current shape. Pure, and safe to run on
 * its own output.
 *
 * A document from before records were kept per game has one set of loadouts,
 * event pools, ascension tier and stats and no game. It becomes `legacy`, with
 * no per-game records. A missing file's default (the old shape, empty) becomes
 * an empty `legacy`. A document from a newer version keeps its version number,
 * so the caller can tell it must not be written back.
 */
export function migrateMeta(data: unknown): RogueliteMeta {
  if (!isRecord(data)) return emptyMeta;
  const version =
    typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  if (version < META_SCHEMA_VERSION && !isRecord(data.games)) {
    return {
      schemaVersion: META_SCHEMA_VERSION,
      legacy: parseRecord(data),
      games: {},
    };
  }
  const games: Record<string, UnlockRecord> = {};
  if (isRecord(data.games)) {
    for (const [key, raw] of Object.entries(data.games)) {
      if (key) games[key] = parseRecord(raw);
    }
  }
  return {
    schemaVersion: Math.max(version, META_SCHEMA_VERSION),
    legacy: parseRecord(data.legacy),
    games,
    ...(data.seenSeeded === true ? { seenSeeded: true } : {}),
  };
}

/**
 * Parse the raw JSON of the meta document. An empty string is an empty meta, as
 * is the plugin's default for a file that does not exist. Text that is not JSON,
 * or JSON that is not an object, throws: the file is damaged, and reading it as
 * empty would let the next save replace the player's unlocks.
 */
export function parseRunMeta(json: string): RogueliteMeta {
  if (json.trim() === "") return emptyMeta;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("meta.json is not valid JSON");
  }
  if (!isRecord(data) || Array.isArray(data)) {
    throw new Error("meta.json is not a JSON object");
  }
  return migrateMeta(data);
}
