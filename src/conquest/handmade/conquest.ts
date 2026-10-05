import { type GenMap, tierMapPicker } from "../generate";
import {
  type ConquestState,
  DEFAULT_AGGRESSION,
  type GalaxyDoc,
  type GalaxyNode,
  type GameRef,
  type HandmadeRun,
  type NodeScenario,
  newConquestState,
} from "../model";
import { mulberry32 } from "../rng";
import { readThreatLevel, threatAggression } from "../threat";
import { hasBlankBattle } from "./read";

/**
 * A conquest on a hand-made map. The map is fixed, so a conquest on it chooses
 * only a faction, fog of war, a threat level and a seed. The seed drives the
 * enemy turns and the battle maps of the locations the author left blank. It
 * never changes the map.
 *
 * The saved conquest holds a {@link HandmadeRun} and no copy of the map. On
 * every load the map is read from its folder again and
 * {@link handmadeConquestDoc} puts the conquest's choices back on it, the way
 * a bundled galaxy is read again and its saved state reconciled against it.
 */

/** What the player chooses before a conquest on a hand-made map starts. */
export interface HandmadeConquestOptions {
  seed: number;
  fogOfWar: boolean;
  /** Threat level 0..3 (see `../threat`). */
  threatLevel: number;
  /**
   * nodeId -> the battle map an imported challenge names for a location the
   * author left blank. A named map this install has is used. One it does not
   * have is replaced by a pick from the seed and recorded as a stand-in.
   */
  named?: Record<string, string>;
}

/**
 * Sort the battle maps a challenge names into the ones this install can use
 * and the ones it cannot. Only blank locations count: the author's own battles
 * are the map's, and a code cannot change them.
 */
export function challengeBattles(
  doc: GalaxyDoc,
  maps: GenMap[],
  named: Record<string, string> = {},
): { kept: Record<string, string>; missing: Record<string, string> } {
  const installed = new Set(maps.map((m) => m.name));
  const kept: Record<string, string> = {};
  const missing: Record<string, string> = {};
  for (const node of doc.nodes) {
    const name = named[node.id];
    if (!name || !hasBlankBattle(node)) continue;
    if (installed.has(name)) kept[node.id] = name;
    else missing[node.id] = name;
  }
  return { kept, missing };
}

/**
 * A battle map for each location the author left blank, from the difficulty
 * tiers generation uses. The same seed and the same maps give the same picks.
 * `kept` holds picks made earlier, which are never changed: only a blank
 * location without one draws a map. A location stays out of the result when
 * `maps` is empty.
 */
export function pickBlankBattles(
  doc: GalaxyDoc,
  maps: GenMap[],
  seed: number,
  kept: Record<string, string> = {},
): Record<string, string> {
  const mapFor = tierMapPicker(maps, mulberry32(seed));
  const battles: Record<string, string> = {};
  for (const node of doc.nodes) {
    if (!hasBlankBattle(node)) continue;
    const mapName = kept[node.id] || mapFor(node.difficulty);
    if (mapName) battles[node.id] = mapName;
  }
  return battles;
}

/** The locations still without a battle map once `battles` is applied. */
export function blankLocations(
  doc: GalaxyDoc,
  battles: Record<string, string>,
): string[] {
  return doc.nodes
    .filter((n) => hasBlankBattle(n) && !battles[n.id])
    .map((n) => n.id);
}

/**
 * The document a conquest is played on: the map as read from its folder, with
 * the conquest's own choices applied. Blank battles take their saved map, fog
 * of war is set, and the threat level raises every faction's aggression the
 * way generation does. The player's own faction never takes an enemy turn, so
 * raising it too changes nothing.
 */
export function handmadeConquestDoc(
  map: GalaxyDoc,
  run: Pick<
    HandmadeRun,
    "fogOfWar" | "threatLevel" | "battles" | "substituted"
  >,
): GalaxyDoc {
  const threatLevel = readThreatLevel(run.threatLevel);
  return {
    ...map,
    factions:
      threatLevel === 0
        ? map.factions
        : map.factions.map((f) => ({
            ...f,
            aggression: threatAggression(
              f.aggression ?? DEFAULT_AGGRESSION,
              threatLevel,
            ),
          })),
    nodes: map.nodes.map((node) => {
      const mapName = hasBlankBattle(node) ? run.battles[node.id] : undefined;
      if (!mapName) return node;
      const named = run.substituted?.[node.id];
      return {
        ...node,
        battle: {
          ...node.battle,
          mapName,
          ...(named && named !== mapName ? { mapSubstitutedFrom: named } : {}),
        },
      };
    }),
    rules: run.fogOfWar ? { ...map.rules, fogOfWar: true } : map.rules,
    handmade: {
      ...map.handmade,
      mapId: map.id,
      threatLevel: threatLevel > 0 ? threatLevel : undefined,
      battles: run.battles,
    },
  };
}

/**
 * The installed hand-made maps in the shape of the galaxy list, for the pages
 * that find conquests through it (Home's continue list and Career). A map that
 * is not installed is not in the list, so a conquest on a removed map is not
 * found through it.
 */
export function listedHandmadeMaps(
  maps: readonly { id: string; title: string; game: GameRef }[],
): { galaxy: { id: string; title: string; game: GameRef } }[] {
  return maps.map(({ id, title, game }) => ({ galaxy: { id, title, game } }));
}

/** What a conquest saves about its map and choices when it starts. */
export function handmadeRun(
  map: GalaxyDoc,
  options: HandmadeConquestOptions,
  maps: GenMap[],
): HandmadeRun {
  const threatLevel = readThreatLevel(options.threatLevel);
  const { kept, missing } = challengeBattles(map, maps, options.named);
  const battles = pickBlankBattles(map, maps, options.seed, kept);
  // Only a location that did get a stand-in is recorded as having one.
  const substituted = Object.fromEntries(
    Object.entries(missing).filter(([id]) => battles[id]),
  );
  return {
    mapId: map.id,
    title: map.title,
    fogOfWar: options.fogOfWar ? true : undefined,
    threatLevel: threatLevel > 0 ? threatLevel : undefined,
    battles,
    ...(Object.keys(substituted).length > 0 ? { substituted } : {}),
  };
}

/**
 * A fresh conquest on a hand-made map: ownership and capitals from the
 * manifest, turn 0, and the choices saved beside it.
 */
export function newHandmadeConquest(
  map: GalaxyDoc,
  choice: HandmadeConquestOptions & {
    playerFactionId?: string;
    playerSide?: string;
  },
  maps: GenMap[],
  now: string = new Date().toISOString(),
): ConquestState {
  const run = handmadeRun(map, choice, maps);
  return {
    ...newConquestState(
      handmadeConquestDoc(map, run),
      {
        playerFactionId: choice.playerFactionId,
        playerSide: choice.playerSide,
        seed: choice.seed,
      },
      now,
    ),
    handmade: run,
  };
}

/**
 * Read a saved conquest's hand-made part from untrusted input. Null when the
 * save is not on a hand-made map.
 */
export function readHandmadeRun(state: ConquestState): HandmadeRun | null {
  const raw: unknown = state.handmade;
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.mapId !== "string" || r.mapId === "") return null;
  const battles: Record<string, string> = {};
  if (typeof r.battles === "object" && r.battles !== null) {
    for (const [id, name] of Object.entries(r.battles)) {
      if (typeof name === "string" && name !== "") battles[id] = name;
    }
  }
  const substituted: Record<string, string> = {};
  if (typeof r.substituted === "object" && r.substituted !== null) {
    for (const [id, name] of Object.entries(r.substituted)) {
      if (typeof name === "string" && name !== "") substituted[id] = name;
    }
  }
  const threatLevel = readThreatLevel(r.threatLevel);
  return {
    mapId: r.mapId,
    title: typeof r.title === "string" && r.title !== "" ? r.title : r.mapId,
    fogOfWar: r.fogOfWar === true ? true : undefined,
    threatLevel: threatLevel > 0 ? threatLevel : undefined,
    battles,
    ...(Object.keys(substituted).length > 0 ? { substituted } : {}),
    scenariosWon:
      Array.isArray(r.scenariosWon) && r.scenariosWon.length > 0
        ? r.scenariosWon.filter((id): id is string => typeof id === "string")
        : undefined,
  };
}

/**
 * The scenario a fight at `node` plays, or undefined when it is a skirmish.
 * Only an attack plays one, and only until the player has won it: a defence,
 * and any attack after that win, is a skirmish on the scenario's map.
 */
export function scenarioToPlay(
  state: Pick<ConquestState, "handmade">,
  node: GalaxyNode,
  mode: "attack" | "defend",
): NodeScenario | undefined {
  if (mode !== "attack" || !node.scenario) return undefined;
  const won = readScenariosWon(state);
  return won.includes(node.id) ? undefined : node.scenario;
}

function readScenariosWon(state: Pick<ConquestState, "handmade">): string[] {
  const won: unknown = state.handmade?.scenariosWon;
  return Array.isArray(won)
    ? won.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * Record that the scenario at `nodeId` was won, so it is not played again.
 * A state that is not on a hand-made map comes back unchanged.
 */
export function withScenarioWon(
  state: ConquestState,
  nodeId: string,
): ConquestState {
  if (!state.handmade) return state;
  const won = readScenariosWon(state);
  if (won.includes(nodeId)) return state;
  return {
    ...state,
    handmade: { ...state.handmade, scenariosWon: [...won, nodeId] },
  };
}
