import type { ImageRef, MapDownloadHint, MediaRef } from "../campaign/model";
import { parseImageRef, parseMapDownload } from "../campaign/model";
import { clamp } from "../lib/helpers";
import type { MapRunKind } from "../runlite/mapRun";
import type { Scenario } from "../scenario/model";
import { expandRevealed } from "./fog";
import { type PlacedModel, parsePlacedModels } from "./placedModels";
import { MAX_NODE_COUNT } from "./size";
import { readStartPosition, type StartPosition } from "./startPosition";
import { readThreatLevel } from "./threat";

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

/**
 * Smallest galaxy the generator will build. Real-star galaxies can be this
 * small: an 8 light year radius holds only six systems.
 */
export const MIN_NODE_COUNT = 5;

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
  /**
   * The map this node was meant to be fought on, when `mapName` is a stand-in.
   * Set when an imported challenge names a map this install cannot offer, so
   * the difference is visible rather than silent (issue #1393).
   */
  mapSubstitutedFrom?: string;
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

/**
 * Authored layout position: 2D for the procedural scatters, 3D for galaxies
 * built from real star positions. Read the third component through
 * {@link posZ} rather than indexing, which the union does not allow.
 */
export type NodePos = [number, number] | [number, number, number];

/** A position's vertical component, 0 for the flat 2D form. */
export function posZ(pos: NodePos): number {
  return pos.length === 3 ? pos[2] : 0;
}

/** Describes a node's real star, when it has one. Absent on procedural nodes,
 * whose appearance stays a hash of the node id. */
export interface NodeStar {
  /** One spectral type per component, brightest first ("A1.0 V", "DA2"). */
  spectral: string[];
}

/**
 * What joins two neighbours: a shared `border`, a `crossing` over a gap such as
 * a sea route or a pass, or a `road` between point locations.
 */
export type LinkKind = "border" | "crossing" | "road";

/**
 * A scenario a location plays in place of a skirmish, as the hand-made map
 * reader read it from the map folder. It lives on the document in memory and
 * is never saved, because a hand-made document is read again on every load.
 */
export interface NodeScenario {
  /** The file in the map folder it was read from. */
  file: string;
  doc: Scenario;
  /** The dialogue clips the file carried, by file name, as `data:` URIs. */
  media: Record<string, string>;
}

export interface GalaxyNode {
  /** Stable id referenced by links, owners and run state. */
  id: string;
  name: string;
  /**
   * Authored layout position on the strategic plane (any units). On a document
   * with `terrain`, x and y are in map units (see {@link GalaxyDoc.terrain}).
   */
  pos: NodePos;
  /** Real stellar data, when this node came from the star catalogue. */
  star?: NodeStar;
  /**
   * One or more closed polygons in map units. Each polygon is a ring of [x, y]
   * points with the last point not repeated, no holes. Absent means a point
   * location such as a city. `pos` stays as the anchor for the label and
   * marker.
   */
  outline?: [number, number][][];
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
  /**
   * The scenario the player plays the first time they attack here. `battle`
   * then names the scenario's map, and is what every other fight here uses.
   * Only the hand-made map reader sets this, and {@link parseGalaxyJson} does
   * not read it.
   */
  scenario?: NodeScenario;
}

/**
 * How a strategic map is presented. `galaxy` is stars in space, `theatre` is
 * points on a flat chart, `cities` is points on generated land joined by
 * roads, and `territories` is provinces on generated land masses.
 */
export type MapSkin = "galaxy" | "theatre" | "cities" | "territories";

export const MAP_SKINS: readonly MapSkin[] = [
  "galaxy",
  "theatre",
  "cities",
  "territories",
];

/** A stored skin value, or undefined for anything that is not one. */
export function readMapSkin(value: unknown): MapSkin | undefined {
  return MAP_SKINS.includes(value as MapSkin) ? (value as MapSkin) : undefined;
}

/** True for the two styles drawn on generated land. */
export function isLandSkin(skin: MapSkin | undefined): boolean {
  return skin === "cities" || skin === "territories";
}

/** Author-controlled presentation of the strategic map. */
export interface GalaxyTheme {
  /** `galaxy` when absent. Every style is drawn by the galaxy view, and
   * reused by the roguelite run map. */
  skin?: MapSkin;
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
  /**
   * The land a map is drawn on. When present, `pos` x and y and every outline
   * point are in map units: origin at the top left of the map image, x to the
   * right, y down, within 0..width and 0..height.
   */
  terrain?: {
    /**
     * URL the webview can load (data:, blob:, asset or http), or a marker a
     * generator understands. Turning a file name in a map folder into a URL is
     * the loader's job, not the model's.
     */
    image: string;
    /** Same, greyscale: black is 0 and white is `heightScale`. */
    heightmap?: string;
    /** Map units. */
    width: number;
    /** Map units. */
    height: number;
    /** Map units of height for a white heightmap pixel. */
    heightScale?: number;
    /** Any other value is refused, so a globe can be added without a format change. */
    projection?: "flat";
  };
  /** Undirected. Every pair must also be in `links`. A link with no entry has no stated kind. */
  linkKinds?: [string, string, LinkKind][];
  /** Pairs of locations that touch but are not neighbours. A pair here must not be in `links`. */
  blockedBorders?: [string, string][];
  /** Scenery stood on the terrain. Drawn only when the document has one. */
  models?: PlacedModel[];
  /**
   * Present when the document was read from a hand-made map folder (see
   * `./handmade`). Such a document is rebuilt from the folder on every load and
   * is never saved, so {@link parseGalaxyJson} does not read this.
   */
  handmade?: {
    /** The id of the map in the hand-made map library. */
    mapId: string;
    /** The game whose archive carries the map, by name, when one does. */
    carriedBy?: string;
    /**
     * What tells this version of the map from another (see
     * `./handmade/fingerprint`). The reader sets it on every read.
     */
    fingerprint?: string;
    /** Threat level 0..3 the conquest was started at. Absent reads as 0. */
    threatLevel?: number;
    /**
     * nodeId -> battle map, for the locations whose battle the author left for
     * coilbox to pick, as the conquest has them. Part of what a challenge on
     * the map is, because the map itself does not settle them.
     */
    battles?: Record<string, string>;
  };
  /**
   * The Warpath markings of a hand-made map whose author gave it a start and a
   * goal: both ends, and the kind of each location the author chose one for,
   * by location id. Only the hand-made map reader sets this and only Warpath
   * reads it. Conquest never looks at it, and {@link parseGalaxyJson} does not
   * read it, for the reason given on `handmade`.
   */
  warpath?: {
    startId: string;
    goalId: string;
    kinds: Record<string, MapRunKind>;
  };
  createdAt: string;
  updatedAt: string;
  /** Set when this galaxy was created by importing a challenge code/file (see
   * `./challenge.ts`) rather than generated locally or bundled — shown on the
   * hub list so a shared-seed run's provenance stays visible. */
  importedChallenge?: boolean;
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
    layout?:
      | "scatter"
      | "spiral"
      | "clusters"
      | "ring"
      | "random"
      | "realstars";
    skin?: MapSkin;
    startingSystems?: number;
    fogOfWar?: boolean;
    /** Threat level 0..3 (see `./threat`). Absent reads as 0. */
    threatLevel?: number;
    /** Where the player starts (see `./startPosition`). Absent is the western edge. */
    startPosition?: StartPosition;
    /** Real-star mode only: the catalogue radius in light years. */
    radiusLy?: number;
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

/** One ownership change made by the enemy round, for the "Last turn" recap. */
export interface TurnEvent {
  /** The faction that captured the node. */
  factionId: string;
  nodeId: string;
  /** Previous owner: a faction id or {@link NEUTRAL}. */
  from: string;
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
  /** Active enemy threats against player systems (advance warnings the player
   * may defend before {@link Incursion.expiresOnTurn}). Several may be open at
   * once. */
  incursions: Incursion[];
  status: "active" | "won" | "lost";
  /**
   * The full name of the game this run launches, set when the player answers a
   * question about it (issue #3465). Beats the galaxy's own `game.pinnedName`.
   * Kept on the run, not the galaxy, so a bundled galaxy stays read-only.
   */
  pinnedGame?: string;
  /** The newer version of the game the player declined to move to. */
  declinedGameUpdate?: string;
  /** Most recent battles, oldest first (capped, see {@link HISTORY_CAP}). */
  history: BattleRecord[];
  /** Captures made by the most recent enemy round, for the map recap. */
  lastRound?: TurnEvent[];
  /** Set when the conquest is played on a hand-made map. */
  handmade?: HandmadeRun;
  updatedAt: string;
}

/**
 * What a conquest on a hand-made map saves besides its progress. The map
 * itself is not saved: it is read from its folder again on every load, so an
 * updated map takes effect and its image addresses are always current.
 */
export interface HandmadeRun {
  /** The id of the map in the hand-made map library. */
  mapId: string;
  /** The map's title when the conquest started, to name it if the map goes. */
  title: string;
  /**
   * The game whose archive carried the map when the conquest started, by
   * name. Set so a save can say a game update took the map away.
   */
  carriedBy?: string;
  fogOfWar?: boolean;
  /** Threat level 0..3 (see `./threat`). Absent reads as 0. */
  threatLevel?: number;
  /**
   * nodeId -> battle map, for each location whose battle the author left for
   * coilbox to pick. Kept so a location stays on the map it was given when
   * the installed maps change.
   */
  battles: Record<string, string>;
  /**
   * nodeId -> the battle map an imported challenge named, for each location
   * that is on another map because this install does not have that one.
   */
  substituted?: Record<string, string>;
  /**
   * The ids of the locations whose scenario the player has won. A scenario is
   * played once, so a later fight at one of these is a skirmish.
   */
  scenariosWon?: string[];
}

export const HISTORY_CAP = 200;

export interface ConquestStateFile {
  schemaVersion: 1;
  /** Keyed by galaxy id. */
  conquests: Record<string, ConquestState>;
}

/** The version of the run-state file this build reads and writes. */
export const CONQUEST_STATE_SCHEMA_VERSION = 1;

/**
 * Parse the raw JSON of the run-state file. An empty string is an empty file, as
 * is the plugin's default for a file that does not exist. Anything else that
 * cannot be read as a whole throws, because reading it as empty would let the
 * next save replace every conquest: text that is not JSON, JSON of the wrong
 * shape, and a file made by a newer version. The saved runs inside are passed
 * through untouched, so a save writes back exactly what was read.
 */
export function parseConquestStateFile(json: string): ConquestStateFile {
  if (json.trim() === "") return { schemaVersion: 1, conquests: {} };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("state.json is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("state.json is not a JSON object");
  }
  const file = data as { schemaVersion?: unknown; conquests?: unknown };
  if (
    typeof file.schemaVersion === "number" &&
    file.schemaVersion > CONQUEST_STATE_SCHEMA_VERSION
  ) {
    throw new Error(
      `state.json was made by a newer version of coilbox (file version ${file.schemaVersion}, this version reads ${CONQUEST_STATE_SCHEMA_VERSION})`,
    );
  }
  if (
    typeof file.conquests !== "object" ||
    file.conquests === null ||
    Array.isArray(file.conquests)
  ) {
    throw new Error("state.json has no conquests object");
  }
  return data as ConquestStateFile;
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
    mapSubstitutedFrom:
      typeof b.mapSubstitutedFrom === "string" && b.mapSubstitutedFrom !== ""
        ? b.mapSubstitutedFrom
        : undefined,
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
    skin: readMapSkin(t.skin),
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
        ? clamp(Math.round(g.nodeCount), MIN_NODE_COUNT, MAX_NODE_COUNT)
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
      g.layout === "random" ||
      g.layout === "realstars"
        ? g.layout
        : undefined,
    radiusLy:
      typeof g.radiusLy === "number" && Number.isFinite(g.radiusLy)
        ? clamp(g.radiusLy, 1, 25)
        : undefined,
    skin: readMapSkin(g.skin),
    startingSystems:
      typeof g.startingSystems === "number" &&
      Number.isFinite(g.startingSystems)
        ? clamp(Math.round(g.startingSystems), 1, 4)
        : undefined,
    fogOfWar: g.fogOfWar === true ? true : undefined,
    threatLevel: readThreatLevel(g.threatLevel) || undefined,
    startPosition: readStartPosition(g.startPosition),
  };
}

/** Order-insensitive key for a pair of node ids. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** An outline as written, or `null` when it is not polygons of 3 or more points. */
function parseOutline(value: unknown): [number, number][][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const outline: [number, number][][] = [];
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const points: [number, number][] = [];
    for (const p of ring) {
      if (
        !Array.isArray(p) ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        typeof p[0] !== "number" ||
        typeof p[1] !== "number"
      ) {
        return null;
      }
      points.push([p[0], p[1]]);
    }
    outline.push(points);
  }
  return outline;
}

/** The terrain block, or the reason it is refused. */
function parseTerrain(
  value: unknown,
): NonNullable<GalaxyDoc["terrain"]> | string {
  if (typeof value !== "object" || value === null) {
    return "terrain is not an object";
  }
  const t = value as Record<string, unknown>;
  if (t.projection !== undefined && t.projection !== "flat") {
    return `terrain projection ${JSON.stringify(t.projection)} is not supported, only "flat" is`;
  }
  if (typeof t.image !== "string" || t.image === "") {
    return "terrain has no image";
  }
  if (!isPositive(t.width) || !isPositive(t.height)) {
    return "terrain width and height must be numbers above 0";
  }
  return {
    image: t.image,
    heightmap:
      typeof t.heightmap === "string" && t.heightmap !== ""
        ? t.heightmap
        : undefined,
    width: t.width,
    height: t.height,
    heightScale: isPositive(t.heightScale) ? t.heightScale : undefined,
    projection: t.projection === "flat" ? "flat" : undefined,
  };
}

/**
 * The first location cut off from the rest of the map, or `undefined` when
 * every location can be reached. Names one from the smaller side of the split,
 * so one stray city is named instead of the continent it is missing from.
 */
function findUnreachable(
  nodes: GalaxyNode[],
  links: [string, string][],
): GalaxyNode | undefined {
  const adjacent = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const [a, b] of links) {
    adjacent.get(a)?.push(b);
    adjacent.get(b)?.push(a);
  }
  const seen = new Set([nodes[0].id]);
  const queue = [nodes[0].id];
  for (const id of queue) {
    for (const next of adjacent.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  if (seen.size === nodes.length) return undefined;
  return seen.size * 2 < nodes.length
    ? nodes[0]
    : nodes.find((n) => !seen.has(n.id));
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
 *
 * The map fields are refused instead of dropped, because a map that lost its
 * terrain or a border would load as a different map: a location that cannot be
 * reached from the others, a `projection` other than `flat`, a malformed
 * `terrain` or `outline`, a `linkKinds` entry that is not a link, and a
 * `blockedBorders` pair that is a link or names an unknown location. Each of
 * those passes its reason to `onRefusal`.
 */
export function parseGalaxyJson(
  json: string,
  onRefusal?: (reason: string) => void,
): GalaxyDoc | null {
  const refuse = (reason: string): null => {
    onRefusal?.(reason);
    return null;
  };

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
    const outline =
      n.outline === undefined ? undefined : parseOutline(n.outline);
    if (outline === null) {
      return refuse(
        `location ${JSON.stringify(n.id)} has an outline that is not a list of polygons of 3 or more [x, y] points`,
      );
    }
    // A third component is optional: pre-3D galaxies stay flat.
    const z =
      typeof pos[2] === "number" && Number.isFinite(pos[2]) ? pos[2] : 0;
    const spectral = stringArray(
      (n.star as Record<string, unknown> | null | undefined)?.spectral,
    );
    nodeIds.add(n.id);
    nodes.push({
      id: n.id,
      name: n.name,
      pos: z === 0 ? [pos[0], pos[1]] : [pos[0], pos[1], z],
      star: spectral.length > 0 ? { spectral } : undefined,
      outline,
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
      const key = pairKey(a, b);
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push([a, b]);
    }
  }

  const stranded = findUnreachable(nodes, links);
  if (stranded) {
    return refuse(
      `location ${JSON.stringify(stranded.id)} (${stranded.name}) cannot be reached from the rest of the map`,
    );
  }

  let terrain: GalaxyDoc["terrain"];
  if (d.terrain !== undefined) {
    const parsed = parseTerrain(d.terrain);
    if (typeof parsed === "string") return refuse(parsed);
    terrain = parsed;
  }

  const linkKinds: [string, string, LinkKind][] = [];
  if (d.linkKinds !== undefined) {
    if (!Array.isArray(d.linkKinds)) return refuse("linkKinds is not a list");
    const seenKinds = new Set<string>();
    for (const raw of d.linkKinds) {
      const [a, b, kind] = Array.isArray(raw) ? raw : [];
      if (typeof a !== "string" || typeof b !== "string") {
        return refuse("linkKinds has an entry that is not [id, id, kind]");
      }
      if (kind !== "border" && kind !== "crossing" && kind !== "road") {
        return refuse(
          `linkKinds gives ${a} and ${b} the kind ${JSON.stringify(kind)}, which is not border, crossing or road`,
        );
      }
      const key = pairKey(a, b);
      if (!seenLinks.has(key)) {
        return refuse(
          `linkKinds names ${a} and ${b}, which are not linked in links`,
        );
      }
      if (seenKinds.has(key)) continue;
      seenKinds.add(key);
      linkKinds.push([a, b, kind]);
    }
  }

  const blockedBorders: [string, string][] = [];
  if (d.blockedBorders !== undefined) {
    if (!Array.isArray(d.blockedBorders)) {
      return refuse("blockedBorders is not a list");
    }
    const seenBlocked = new Set<string>();
    for (const raw of d.blockedBorders) {
      const [a, b] = Array.isArray(raw) ? raw : [];
      if (typeof a !== "string" || typeof b !== "string" || a === b) {
        return refuse(
          "blockedBorders has an entry that is not two different ids",
        );
      }
      const unknown = [a, b].find((id) => !nodeIds.has(id));
      if (unknown !== undefined) {
        return refuse(
          `blockedBorders names ${unknown}, which is not a location`,
        );
      }
      const key = pairKey(a, b);
      if (seenLinks.has(key)) {
        return refuse(
          `blockedBorders names ${a} and ${b}, which are also linked in links`,
        );
      }
      if (seenBlocked.has(key)) continue;
      seenBlocked.add(key);
      blockedBorders.push([a, b]);
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
    terrain,
    linkKinds: linkKinds.length > 0 ? linkKinds : undefined,
    blockedBorders: blockedBorders.length > 0 ? blockedBorders : undefined,
    models: parsePlacedModels(d.models),
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    importedChallenge: d.importedChallenge === true ? true : undefined,
    generated: parseGenerated(d.generated),
  };
}

/** The stated kind of the link between two locations, in either order. */
export function linkKind(
  doc: GalaxyDoc,
  a: string,
  b: string,
): LinkKind | undefined {
  for (const [x, y, kind] of doc.linkKinds ?? []) {
    if ((x === a && y === b) || (x === b && y === a)) return kind;
  }
  return undefined;
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
    incursions: [],
    status: "active",
    history: [],
    updatedAt: now,
  };
}

/**
 * Heal a saved run state against a (possibly updated) galaxy document: drop
 * ownership entries for nodes that no longer exist, seed newly added nodes
 * from their authored owner, drop a dangling incursion and a recap line for a
 * node that is gone, and fall back to the doc's default faction if the chosen
 * one vanished. Run on every load.
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
  // Migrate a pre-existing singular `incursion` save into the `incursions`
  // array, then keep only those still valid (target still player-owned, faction
  // still present).
  const legacy = state as ConquestState & { incursion?: Incursion };
  const incursions = (
    state.incursions ?? (legacy.incursion ? [legacy.incursion] : [])
  ).filter(
    (i) => owners[i.nodeId] === playerFactionId && factionIds.has(i.factionId),
  );
  // Fog of war: drop revealed ids for nodes that vanished, and seed a missing
  // set from current territory so a save from before fog was enabled (or a
  // corrupted one) heals into a sensible starting view.
  let revealed: string[] | undefined;
  if (galaxy.rules?.fogOfWar) {
    const nodeIds = new Set(galaxy.nodes.map((n) => n.id));
    const prev = (state.revealed ?? []).filter((id) => nodeIds.has(id));
    revealed = expandRevealed(galaxy, owners, playerFactionId, prev);
  }
  // The recap names each capture's node, so one that is gone has no line.
  const lastRound = state.lastRound?.filter((e) => owners[e.nodeId]);
  const { incursion: _legacy, ...rest } = legacy;
  return { ...rest, owners, playerFactionId, revealed, incursions, lastRound };
}
