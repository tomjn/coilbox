import type { SkirmishAi } from "../content/bindings";
import type { SkirmishDraft } from "../play/drafts";
import {
  hexToRgb,
  PALETTE,
  type Participant,
  resolveAi,
} from "../play/participants";
import type { ConquestState, Faction, GalaxyDoc, GalaxyNode } from "./model";
import { difficultyHandicap, difficultyTable } from "./rules";

/**
 * Turn a strategic battle (attack or defend a node) into a launchable
 * {@link SkirmishDraft} — the same shape a campaign mission snapshot carries,
 * so everything downstream (toBattleConfig, launch, result detection) is
 * shared. Pure: the caller resolves the installed game and AI list first.
 */

let idSeq = 0;
const nextId = () => `cq${idSeq++}`;

/** The faction whose forces defend/attack at this node, if any. */
function opposingFaction(
  galaxy: GalaxyDoc,
  state: ConquestState,
  node: GalaxyNode,
  mode: "attack" | "defend",
): Faction | undefined {
  const id =
    mode === "defend" ? state.incursion?.factionId : state.owners[node.id];
  return galaxy.factions.find((f) => f.id === id);
}

/** Resolve the enemy AI for a node: node override -> faction -> first installed. */
function enemyAi(
  node: GalaxyNode,
  faction: Faction | undefined,
  ais: SkirmishAi[],
): Participant["ai"] | undefined {
  const fromKey = (key?: string) => (key ? resolveAi(key, ais) : undefined);
  return (
    fromKey(node.battle.enemyAiKey) ??
    fromKey(faction?.aiKey) ??
    (ais[0]
      ? { kind: ais[0].kind, shortName: ais[0].shortName, name: ais[0].name }
      : undefined)
  );
}

/**
 * Build the skirmish for fighting `nodeId`. Attacks fight the node's owner on
 * the node's map; defences fight the incursion's faction on the same map. The
 * enemy team count derives from node difficulty unless the author overrode it,
 * and enemy teams carry a difficulty-scaled handicap (author-overridable).
 * Neutral garrisons have no faction: default AI, grey colour, engine-default
 * side.
 */
export function synthesizeBattle(
  galaxy: GalaxyDoc,
  state: ConquestState,
  nodeId: string,
  mode: "attack" | "defend",
  opts: {
    playerName: string;
    /** Exact installed game archive name (resolved from `galaxy.game`). */
    gameName: string;
    ais: SkirmishAi[];
  },
): SkirmishDraft | null {
  const node = galaxy.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const spec = node.battle;
  const playerFaction = galaxy.factions.find(
    (f) => f.id === state.playerFactionId,
  );
  const enemyFaction = opposingFaction(galaxy, state, node, mode);
  const ai = enemyAi(node, enemyFaction, opts.ais);
  const enemyCount = spec.enemyAiCount ?? difficultyTable(node.difficulty);
  const handicap = spec.handicap ?? difficultyHandicap(node.difficulty);
  const enemyColor = enemyFaction ? hexToRgb(enemyFaction.color) : PALETTE[7]; // grey — a neutral garrison flies no colours

  const you: Participant = {
    id: nextId(),
    kind: "you",
    name: opts.playerName,
    side: state.playerSide ?? "",
    color: playerFaction ? hexToRgb(playerFaction.color) : PALETTE[0],
    allyTeam: 0,
    spectator: false,
  };
  const enemies: Participant[] = Array.from({ length: enemyCount }, (_, i) => ({
    id: nextId(),
    kind: "ai" as const,
    name: enemyFaction ? `${enemyFaction.name} ${i + 1}` : `Garrison ${i + 1}`,
    ai,
    side: enemyFaction?.side ?? "",
    color: enemyColor,
    allyTeam: 1,
    spectator: false,
    handicap: handicap > 0 ? handicap : undefined,
  }));

  return {
    participants: [you, ...enemies],
    gameName: opts.gameName,
    mapName: spec.mapName,
    startPosType: spec.startPosType ?? 0,
    modOptionValues: spec.modOptionValues ?? {},
  };
}
