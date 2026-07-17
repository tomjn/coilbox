import type { SkirmishAi } from "../content/bindings";
import type { SkirmishDraft } from "../play/drafts";
import {
  hexToRgb,
  PALETTE,
  type Participant,
  resolveAi,
} from "../play/participants";
import {
  type ConquestAiConfig,
  fallbackFactionAi,
  isDeniedAi,
  neutralAi,
} from "./ai";
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

const toRef = (a?: SkirmishAi): Participant["ai"] | undefined =>
  a ? { kind: a.kind, shortName: a.shortName, name: a.name } : undefined;

/**
 * Resolve the enemy AI for a node. Authored keys (node override, then the
 * faction's AI) win, but a key resolving to a denied do-nothing bot is ignored
 * — conquest never fields a test/null AI. The fallback depends on the enemy:
 * a neutral garrison (no faction) prefers a chicken/wildlife AI as a hazard;
 * a faction enemy gets the first real playing AI installed.
 */
function enemyAi(
  node: GalaxyNode,
  faction: Faction | undefined,
  ais: SkirmishAi[],
  config?: ConquestAiConfig,
): Participant["ai"] | undefined {
  const fromKey = (key?: string) => {
    const ref = key ? resolveAi(key, ais) : undefined;
    return ref && !isDeniedAi(ref, config) ? ref : undefined;
  };
  const fallback = faction
    ? fallbackFactionAi(ais, config)
    : neutralAi(ais, config);
  return (
    fromKey(node.battle.enemyAiKey) ??
    fromKey(faction?.aiKey) ??
    toRef(fallback)
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
    /** Per-game conquest AI config (deny-list, faction pool, neutral AI). */
    aiConfig?: ConquestAiConfig;
  },
): SkirmishDraft | null {
  const node = galaxy.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const spec = node.battle;
  const playerFaction = galaxy.factions.find(
    (f) => f.id === state.playerFactionId,
  );
  const enemyFaction = opposingFaction(galaxy, state, node, mode);
  const ai = enemyAi(node, enemyFaction, opts.ais, opts.aiConfig);
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

  // Neutral (chicken) garrisons carry the catalog's neutral mod options; an
  // authored battle spec overrides them per-node.
  const neutralOptions = enemyFaction
    ? undefined
    : opts.aiConfig?.neutralModOptions;

  return {
    participants: [you, ...enemies],
    gameName: opts.gameName,
    mapName: spec.mapName,
    startPosType: spec.startPosType ?? 0,
    modOptionValues: { ...neutralOptions, ...spec.modOptionValues },
  };
}
