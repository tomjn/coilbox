import type { ImageRef, MapDownloadHint, MediaRef } from "../campaign/model";
import { parseImageRef, parseMapDownload } from "../campaign/model";
import { expandRevealed } from "./fog";

/**
 * Galactic-conquest schema — the single source of truth for the shape of a
 * galaxy document and its persistent run state. Rust stores both as opaque
 * JSON, so this file (and {@link parseGalaxyJson}) is the only place the shape
 * is defined, validated and (in future) migrated.
 *
 * The strategic model is deliberately theme-agnostic: it speaks of *nodes* and
 * *links*; "galaxy/star/planet" is presentation (see {@link GalaxyTheme}). A
 * terrestrial game can ship the same document skinned as a theatre map.
 */

/** The owner value for territory no faction holds. */
export const NEUTRAL = "neutral";

/** Difficulty bounds for a node (inclusive). */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/** Default number of turns the player has to answer an incursion. */
export const DEFAULT_GRACE_TURNS = 2;

/** Default per-enemy-phase chance a faction opens an incursion. */
export const DEFAULT_AGGRESSION = 0.35;

/**
 * Which game a galaxy targets. Identified by modinfo `shortname` and resolved
 * to the newest installed version at battle time, so a galaxy keeps working
 * across game updates. `pinnedName` (exact archive name) is an author override
 * for reproducibility.
 */
export interface GameRef {
  shortname: string;
  pinnedName?: string;
}

export interface Faction {
  /** Stable id referenced by node owners and run state. */
  id: string;
  name: string;
  /** `#rrggbb` — strategic-map tint and in-battle team colour. */
  color: string;
  /** 0..1 chance per enemy phase of opening an incursion. Player/neutral: 0. */
  aggression?: number;
  /** Preferred skirmish AI (`kind:shortName`, see `aiKey` in play/config). */
  aiKey?: string;
  /** In-game side its AI participants play (e.g. "Core"). */
  side?: string;
}

/**
 * How a node's battle is set up. Everything optional falls back to a derived
 * default at synthesis time; authors use these for fine-grained difficulty.
 */
export interface NodeBattleSpec {
  mapName: string;
  /** Optional install-gate download override for the map. */
  mapDownload?: MapDownloadHint;
  /** Enemy AI count override (default derives from node difficulty). */
  enemyAiCount?: number;
  /** Skirmish AI override for this node's enemies (`kind:shortName`). */
  enemyAiKey?: string;
  startPosType?: number;
  modOptionValues?: Record<string, string>;
  /** Internal unit names to forbid, as `[RESTRICT] Limit=0` at launch. */
  disabledUnits?: string[];
  /** Enemy team handicap % override (default derives from difficulty). */
  handicap?: number;
}

export interface GalaxyNode {
  /** Stable id referenced by links, owners and run state. */
  id: string;
  name: string;
  /** Authored 2D layout position on the strategic plane (any units). */
  pos: [number, number];
  /** Initial owner: a faction id or {@link NEUTRAL}. */
  owner: string;
  /**
   * Exactly one `capital` per faction. The played faction's capital is its
   * homeworld (losing it loses the run); enemy capitals are the win
   * objectives.
   */
  kind?: "capital" | "normal";
  /** 1..5 — drives enemy AI count and handicap defaults. */
  difficulty: number;
  /** Selection-panel flavour text. */
  blurb?: string;
  battle: NodeBattleSpec;
}

/** Author-controlled presentation of the strategic map. */
export interface GalaxyTheme {
  /** `galaxy` (default) or `theatre` (flat tactical chart; both fully rendered
   * by the galaxy view, and reused by the roguelite run map). */
  skin?: "galaxy" | "theatre";
  /** Theatre plane texture / galaxy nebula backdrop. */
  backdrop?: ImageRef;
  /** Decorative starfield tints (`#rrggbb`). */
  starPalette?: string[];
  /** Nebula sprite tints (`#rrggbb`). */
  nebulaColors?: string[];
  /** Looping ambience audio. */
  ambience?: MediaRef;
}

export interface GalaxyDoc {
  schemaVersion: 1;
  /** `[A-Za-z0-9-]+` (crate-validated, like campaign ids). */
  id: string;
  type: "conquest-galaxy";
  title: string;
  description: string;
  game: GameRef;
  /** Default played faction (a member of `factions`). */
  playerFactionId: string;
  /** Factions offered at run start. Defaults to `[playerFactionId]`. */
  playableFactionIds?: string[];
  factions: Faction[];
  nodes: GalaxyNode[];
  /** Undirected node-id pairs. */
  links: [string, string][];
  rules?: {
    graceTurns?: number;
    /** Hide systems more than two jumps from your territory (see `../fog`). */
    fogOfWar?: boolean;
  };
  theme?: GalaxyTheme;
  createdAt: string;
  updatedAt: string;
  /**
   * Present on procedurally generated docs; carries the generation knobs so
   * the galaxy can be rerolled in place. Maps, AIs and naming pools are
   * deliberately not stored — they re-resolve from installed content and the
   * current profile/branding at reroll time.
   */
  generated?: {
    seed: number;
    nodeCount?: number;
    factionCount?: number;
    layout?: "scatter" | "spiral" | "clusters" | "ring" | "random";
    skin?: "galaxy" | "theatre";
    startingSystems?: number;
    fogOfWar?: boolean;
  };
}

/** An enemy attack on a player node, pending until fought or expired. */
export interface Incursion {
  nodeId: string;
  factionId: string;
  /** Turn at which the node falls if the incursion is still unanswered. */
  expiresOnTurn: number;
}

export interface BattleRecord {
  turn: number;
  nodeId: string;
  mode: "attack" | "defend";
  outcome: "victory" | "defeat";
}

/** Persistent state of one conquest run, stored apart from the (possibly
 * read-only bundled) galaxy document. */
export interface ConquestState {
  /** Drives the seeded enemy phase; rerolled by "Start again". */
  seed: number;
  turn: number;
  /** Faction the player chose at run start. */
  playerFactionId: string;
  /** In-game side for the player's participant (from the game's sides). */
  playerSide?: string;
  /** nodeId -> faction id or {@link NEUTRAL} (full denormalized map). */
  owners: Record<string, string>;
  /**
   * Node ids the player has seen, when the galaxy has `rules.fogOfWar`. Grows
   * monotonically (see `../fog`); absent/ignored when fog is off.
   */
  revealed?: string[];
  incursion?: Incursion;
  status: "active" | "won" | "lost";
  /** Most recent battles, oldest first (capped, see {@link HISTORY_CAP}). */
  history: BattleRecord[];
  updatedAt: string;
}

export const HISTORY_CAP = 200;

export interface ConquestStateFile {
  schemaVersion: 1;
  /** Keyed by galaxy id. */
  conquests: Record<string, ConquestState>;
}

/** The on-disk / shared shape produced by export and consumed by import. */
export interface GalaxyExportFile {
  format: "coilbox-galaxy";
  formatVersion: 1;
  galaxy: GalaxyDoc;
}

/** Coerce an unknown into a string array, dropping non-string members. */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function parseFaction(value: unknown): Faction | null {
  if (typeof value !== "object" || value === null) return null;
  const f = value as Record<string, unknown>;
  if (
    typeof f.id !== "string" ||
    f.id === "" ||
    typeof f.name !== "string" ||
    typeof f.color !== "string"
  ) {
    return null;
  }
  return {
    id: f.id,
    name: f.name,
    color: f.color,
    aggression:
      typeof f.aggression === "number" && Number.isFinite(f.aggression)
        ? clamp(f.aggression, 0, 1)
        : undefined,
    aiKey: typeof f.aiKey === "string" && f.aiKey !== "" ? f.aiKey : undefined,
    side: typeof f.side === "string" && f.side !== "" ? f.side : undefined,
  };
}

function parseBattle(value: unknown): NodeBattleSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const b = value as Record<string, unknown>;
  // The map is the launch payload; a node without one is unplayable.
  if (typeof b.mapName !== "string" || b.mapName === "") return null;
  let modOptionValues: Record<string, string> | undefined;
  if (typeof b.modOptionValues === "object" && b.modOptionValues !== null) {
    const entries = Object.entries(
      b.modOptionValues as Record<string, unknown>,
    ).filter((e): e is [string, string] => typeof e[1] === "string");
    if (entries.length > 0) modOptionValues = Object.fromEntries(entries);
  }
  return {
    mapName: b.mapName,
    mapDownload: parseMapDownload(b.mapDownload),
    enemyAiCount:
      typeof b.enemyAiCount === "number" && Number.isFinite(b.enemyAiCount)
        ? clamp(Math.round(b.enemyAiCount), 1, 8)
        : undefined,
    enemyAiKey:
      typeof b.enemyAiKey === "string" && b.enemyAiKey !== ""
        ? b.enemyAiKey
        : undefined,
    startPosType:
      typeof b.startPosType === "number" && Number.isFinite(b.startPosType)
        ? b.startPosType
        : undefined,
    modOptionValues,
    disabledUnits:
      stringArray(b.disabledUnits).length > 0
        ? stringArray(b.disabledUnits)
        : undefined,
    handicap:
      typeof b.handicap === "number" && Number.isFinite(b.handicap)
        ? clamp(Math.round(b.handicap), 0, 300)
        : undefined,
  };
}

function parseTheme(value: unknown): GalaxyTheme | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const t = value as Record<string, unknown>;
  const theme: GalaxyTheme = {
    skin: t.skin === "galaxy" || t.skin === "theatre" ? t.skin : undefined,
    backdrop: parseImageRef(t.backdrop),
    starPalette:
      stringArray(t.starPalette).length > 0
        ? stringArray(t.starPalette)
        : undefined,
    nebulaColors:
      stringArray(t.nebulaColors).length > 0
        ? stringArray(t.nebulaColors)
        : undefined,
    ambience: parseImageRef(t.ambience),
  };
  return Object.values(theme).some((v) => v !== undefined) ? theme : undefined;
}

/** Parse the reroll knobs of a generated doc; clamps mirror `generateGalaxy`. */
function parseGenerated(value: unknown): GalaxyDoc["generated"] {
  if (typeof value !== "object" || value === null) return undefined;
  const g = value as Record<string, unknown>;
  if (typeof g.seed !== "number" || !Number.isFinite(g.seed)) return undefined;
  return {
    seed: g.seed,
    nodeCount:
      typeof g.nodeCount === "number" && Number.isFinite(g.nodeCount)
        ? clamp(Math.round(g.nodeCount), 8, 80)
        : undefined,
    factionCount:
      typeof g.factionCount === "number" && Number.isFinite(g.factionCount)
        ? clamp(Math.round(g.factionCount), 1, 3)
        : undefined,
    layout:
      g.layout === "scatter" ||
      g.layout === "spiral" ||
      g.layout === "clusters" ||
      g.layout === "ring" ||
      g.layout === "random"
        ? g.layout
        : undefined,
    skin: g.skin === "galaxy" || g.skin === "theatre" ? g.skin : undefined,
    startingSystems:
      typeof g.startingSystems === "number" &&
      Number.isFinite(g.startingSystems)
        ? clamp(Math.round(g.startingSystems), 1, 4)
        : undefined,
    fogOfWar: g.fogOfWar === true ? true : undefined,
  };
}

/**
 * Parse the raw JSON of a stored or imported galaxy into a validated
 * {@link GalaxyDoc}, or `null` if the shape doesn't match. This is the single
 * untrusted-input validator (a bundled or imported galaxy is untrusted) and
 * the future schema-migration point.
 *
 * Rejected outright (unplayable): missing/duplicate ids, a node without a
 * playable battle spec, an unknown `playerFactionId`, or any faction without
 * exactly one capital it owns. Malformed optionals are dropped; unknown node
 * owners normalize to {@link NEUTRAL}; links referencing unknown nodes,
 * self-links and duplicates are dropped.
 */
export function parseGalaxyJson(json: string): GalaxyDoc | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  let d = data as Record<string, unknown>;

  // Also accept the export/share wrapper (`GalaxyExportFile`), so a bundled
  // galaxy can be the exact exported file dropped into `.coilbox/galaxies/`.
  if (
    d.format === "coilbox-galaxy" &&
    typeof d.galaxy === "object" &&
    d.galaxy !== null
  ) {
    d = d.galaxy as Record<string, unknown>;
  }

  const game = d.game as Record<string, unknown> | null | undefined;
  if (
    d.type !== "conquest-galaxy" ||
    typeof d.id !== "string" ||
    d.id === "" ||
    typeof d.title !== "string" ||
    typeof game !== "object" ||
    game === null ||
    typeof game.shortname !== "string" ||
    game.shortname === "" ||
    typeof d.playerFactionId !== "string" ||
    !Array.isArray(d.factions) ||
    !Array.isArray(d.nodes)
  ) {
    return null;
  }

  const factions: Faction[] = [];
  const factionIds = new Set<string>();
  for (const raw of d.factions) {
    const f = parseFaction(raw);
    if (!f || factionIds.has(f.id) || f.id === NEUTRAL) return null;
    factionIds.add(f.id);
    factions.push(f);
  }
  if (factions.length === 0 || !factionIds.has(d.playerFactionId)) return null;

  const nodes: GalaxyNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of d.nodes) {
    if (typeof raw !== "object" || raw === null) return null;
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== "string" || n.id === "" || nodeIds.has(n.id)) {
      return null;
    }
    if (typeof n.name !== "string") return null;
    const pos = n.pos;
    if (
      !Array.isArray(pos) ||
      pos.length < 2 ||
      typeof pos[0] !== "number" ||
      typeof pos[1] !== "number" ||
      !Number.isFinite(pos[0]) ||
      !Number.isFinite(pos[1])
    ) {
      return null;
    }
    const battle = parseBattle(n.battle);
    if (!battle) return null;
    nodeIds.add(n.id);
    nodes.push({
      id: n.id,
      name: n.name,
      pos: [pos[0], pos[1]],
      owner:
        typeof n.owner === "string" && factionIds.has(n.owner)
          ? n.owner
          : NEUTRAL,
      kind: n.kind === "capital" ? "capital" : undefined,
      difficulty:
        typeof n.difficulty === "number" && Number.isFinite(n.difficulty)
          ? clamp(Math.round(n.difficulty), MIN_DIFFICULTY, MAX_DIFFICULTY)
          : MIN_DIFFICULTY,
      blurb:
        typeof n.blurb === "string" && n.blurb !== "" ? n.blurb : undefined,
      battle,
    });
  }
  if (nodes.length === 0) return null;

  // Every faction needs exactly one capital it owns: the played faction's is
  // its homeworld, the others are the win objectives.
  for (const f of factions) {
    const capitals = nodes.filter(
      (n) => n.kind === "capital" && n.owner === f.id,
    );
    if (capitals.length !== 1) return null;
  }

  const links: [string, string][] = [];
  const seenLinks = new Set<string>();
  if (Array.isArray(d.links)) {
    for (const raw of d.links) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      const [a, b] = raw;
      if (typeof a !== "string" || typeof b !== "string") continue;
      if (a === b || !nodeIds.has(a) || !nodeIds.has(b)) continue;
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push([a, b]);
    }
  }

  const playable = stringArray(d.playableFactionIds).filter((id) =>
    factionIds.has(id),
  );

  const rules = d.rules as Record<string, unknown> | null | undefined;
  const graceTurns =
    typeof rules === "object" &&
    rules !== null &&
    typeof rules.graceTurns === "number" &&
    Number.isFinite(rules.graceTurns)
      ? clamp(Math.round(rules.graceTurns), 1, 10)
      : undefined;
  const fogOfWar =
    typeof rules === "object" && rules !== null && rules.fogOfWar === true
      ? true
      : undefined;

  return {
    schemaVersion: 1,
    id: d.id,
    type: "conquest-galaxy",
    title: d.title,
    description: typeof d.description === "string" ? d.description : "",
    game: {
      shortname: game.shortname,
      pinnedName:
        typeof game.pinnedName === "string" && game.pinnedName !== ""
          ? game.pinnedName
          : undefined,
    },
    playerFactionId: d.playerFactionId,
    playableFactionIds: playable.length > 0 ? playable : undefined,
    factions,
    nodes,
    links,
    rules:
      graceTurns !== undefined || fogOfWar !== undefined
        ? { graceTurns, fogOfWar }
        : undefined,
    theme: parseTheme(d.theme),
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    generated: parseGenerated(d.generated),
  };
}

/** Wrap a galaxy in the export/share file shape. */
export function wrapGalaxyForExport(galaxy: GalaxyDoc): GalaxyExportFile {
  return { format: "coilbox-galaxy", formatVersion: 1, galaxy };
}

/** The faction ids the player may play, honouring the doc default. */
export function playableFactions(galaxy: GalaxyDoc): Faction[] {
  const ids = galaxy.playableFactionIds ?? [galaxy.playerFactionId];
  return galaxy.factions.filter((f) => ids.includes(f.id));
}

/** A fresh run state for a galaxy: authored ownership, turn 0, active. */
export function newConquestState(
  galaxy: GalaxyDoc,
  opts: { playerFactionId?: string; playerSide?: string; seed: number },
  now: string = new Date().toISOString(),
): ConquestState {
  const playerFactionId = opts.playerFactionId ?? galaxy.playerFactionId;
  const owners = Object.fromEntries(galaxy.nodes.map((n) => [n.id, n.owner]));
  return {
    seed: opts.seed,
    turn: 0,
    playerFactionId,
    playerSide: opts.playerSide,
    owners,
    revealed: galaxy.rules?.fogOfWar
      ? expandRevealed(galaxy, owners, playerFactionId)
      : undefined,
    status: "active",
    history: [],
    updatedAt: now,
  };
}

/**
 * Heal a saved run state against a (possibly updated) galaxy document: drop
 * ownership entries for nodes that no longer exist, seed newly added nodes
 * from their authored owner, drop a dangling incursion, and fall back to the
 * doc's default faction if the chosen one vanished. Run on every load.
 */
export function reconcileState(
  galaxy: GalaxyDoc,
  state: ConquestState,
): ConquestState {
  const factionIds = new Set(galaxy.factions.map((f) => f.id));
  const owners: Record<string, string> = {};
  for (const n of galaxy.nodes) {
    const saved = state.owners[n.id];
    owners[n.id] =
      saved !== undefined && (saved === NEUTRAL || factionIds.has(saved))
        ? saved
        : n.owner;
  }
  const playerFactionId = factionIds.has(state.playerFactionId)
    ? state.playerFactionId
    : galaxy.playerFactionId;
  const incursion =
    state.incursion &&
    owners[state.incursion.nodeId] === playerFactionId &&
    factionIds.has(state.incursion.factionId)
      ? state.incursion
      : undefined;
  // Fog of war: drop revealed ids for nodes that vanished, and seed a missing
  // set from current territory so a save from before fog was enabled (or a
  // corrupted one) heals into a sensible starting view.
  let revealed: string[] | undefined;
  if (galaxy.rules?.fogOfWar) {
    const nodeIds = new Set(galaxy.nodes.map((n) => n.id));
    const prev = (state.revealed ?? []).filter((id) => nodeIds.has(id));
    revealed = expandRevealed(galaxy, owners, playerFactionId, prev);
  }
  return { ...state, owners, playerFactionId, revealed, incursion };
}

/**
 * Compare two game version strings segment-wise (numeric segments compare as
 * numbers, the rest lexically), so "1.10" > "1.9" and "test-26575" >
 * "test-9999". Returns <0, 0 or >0.
 */
export function compareGameVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/(\d+)/).filter((s) => s !== "");
  const as = split(a);
  const bs = split(b);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? "";
    const y = bs[i] ?? "";
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The minimal shape of an installed game this feature needs (structural
 * subset of `GameItem` from content bindings, to keep this module pure). */
export interface InstalledGame {
  name: string;
  /** modinfo metadata; `shortname` and `version` are what we read. */
  info: Record<string, string>;
}

/**
 * Resolve a {@link GameRef} against the installed games: an exact `pinnedName`
 * match wins; otherwise the newest installed version of the shortname
 * (case-insensitive, by {@link compareGameVersions} on modinfo `version`).
 * Returns `undefined` when nothing matches — the caller shows an install gate.
 */
export function resolveGameByShortname<T extends InstalledGame>(
  game: GameRef,
  installed: T[],
): T | undefined {
  if (game.pinnedName) {
    const pinned = installed.find((g) => g.name === game.pinnedName);
    if (pinned) return pinned;
  }
  const want = game.shortname.trim().toLowerCase();
  let best: T | undefined;
  for (const g of installed) {
    if ((g.info.shortname ?? "").trim().toLowerCase() !== want) continue;
    if (
      !best ||
      compareGameVersions(g.info.version ?? "", best.info.version ?? "") > 0
    ) {
      best = g;
    }
  }
  return best;
}
