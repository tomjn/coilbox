import type { Faction, GalaxyDoc } from "../conquest/model";
import type { RogueliteRun, RunNodeType } from "./model";

/**
 * Adapt a run into a conquest {@link GalaxyDoc} so the run map renders through
 * the real `GalaxyView` — getting its full visual language (stellar classes,
 * binaries, coronas, asteroid/comet void bodies, connection styling) and its
 * camera (focus-on-select zoom, snap-back rotation, eased transitions) for free,
 * instead of a lesser bespoke renderer.
 *
 * The mapping: each run node becomes a system positioned by its `(col, row)`
 * (GalaxyView reprojects the 2D `pos`); node *type* is a pseudo-faction so the
 * ownership ring carries the type colour; the current node is owned by the
 * player, so the camera frames it and the lanes out of it light up as frontier.
 * Edges become undirected links (GalaxyView draws them the same either way).
 */

const TYPE_COLOR: Record<RunNodeType, string> = {
  start: "#4fe6d6",
  battle: "#c3d0e6",
  elite: "#ffb64d",
  event: "#b98cff",
  reward: "#ffcf5c",
  shop: "#7fe08a",
  boss: "#ff5468",
};

const TYPE_LABEL: Record<RunNodeType, string> = {
  start: "Command",
  battle: "Battle",
  elite: "Elite",
  event: "Event",
  reward: "Salvage",
  shop: "Depot",
  boss: "Warlord",
};

const RUN_TYPES = Object.keys(TYPE_COLOR) as RunNodeType[];

/** The faction id the run is "played as" (the current node), so the galaxy
 * view frames it and highlights its outgoing lanes. */
export const PLAYER_FACTION = "you";

const typeFaction = (type: RunNodeType) => `type-${type}`;

/** Build the GalaxyDoc for a run (memoise on run identity — a new object
 * rebuilds the scene; owners/selection/focus update live without a rebuild). */
export function runToGalaxyDoc(run: RogueliteRun): GalaxyDoc {
  const factions: Faction[] = [
    { id: PLAYER_FACTION, name: "You", color: TYPE_COLOR.start },
    ...RUN_TYPES.map((t) => ({
      id: typeFaction(t),
      name: TYPE_LABEL[t],
      color: TYPE_COLOR[t],
    })),
  ];

  const nodes = run.nodes.map((n) => ({
    id: n.id,
    name: TYPE_LABEL[n.type],
    pos: [n.col, n.row] as [number, number],
    owner: typeFaction(n.type),
    kind: n.type === "boss" ? ("capital" as const) : undefined,
    difficulty: Math.max(1, Math.min(5, n.battle?.techTier ?? 2)),
    battle: { mapName: n.battle?.mapName ?? "" },
  }));

  const links = run.edges.map(([a, b]) => [a, b] as [string, string]);

  return {
    schemaVersion: 1,
    id: "run",
    type: "conquest-galaxy",
    title: "Run",
    description: "",
    game: run.settings.game,
    playerFactionId: PLAYER_FACTION,
    factions,
    nodes,
    links,
    theme: { skin: run.settings.skin },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/** Live ownership: every node flies its type colour, except the current node,
 * which is the player's (cyan "you are here", framed by the camera). */
export function runOwners(run: RogueliteRun): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const n of run.nodes) owners[n.id] = typeFaction(n.type);
  owners[run.progress.currentNodeId] = PLAYER_FACTION;
  return owners;
}
