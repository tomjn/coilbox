import type { NodeEmphasis } from "../conquest/galaxy3d/GalaxyView";
import type { Faction, GalaxyDoc } from "../conquest/model";
import type { RogueliteRun, RunNodeType } from "./model";
import { successors } from "./progress";

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
/** A muted faction for already-crossed nodes, so they read as spent. */
const DONE_FACTION = "done";

const typeFaction = (type: RunNodeType) => `type-${type}`;

/** Build the GalaxyDoc for a run (memoise on run identity — a new object
 * rebuilds the scene; owners/selection/focus update live without a rebuild). */
export function runToGalaxyDoc(run: RogueliteRun): GalaxyDoc {
  const factions: Faction[] = [
    { id: PLAYER_FACTION, name: "You", color: TYPE_COLOR.start },
    { id: DONE_FACTION, name: "Cleared", color: "#5a6577" },
    ...RUN_TYPES.map((t) => ({
      id: typeFaction(t),
      name: TYPE_LABEL[t],
      color: TYPE_COLOR[t],
    })),
  ];

  // Centre each column vertically so columns line up around the lane, instead
  // of all starting at row 0 (which skews the connecting lanes and makes them
  // cross). A column of k nodes spans rows centred on 0.
  const perCol = new Map<number, number>();
  for (const n of run.nodes) perCol.set(n.col, (perCol.get(n.col) ?? 0) + 1);

  const nodes = run.nodes.map((n) => ({
    id: n.id,
    name: TYPE_LABEL[n.type],
    pos: [n.col, n.row - ((perCol.get(n.col) ?? 1) - 1) / 2] as [
      number,
      number,
    ],
    owner: typeFaction(n.type),
    // Start and boss are the run's endpoints — render them as giant stars.
    kind:
      n.type === "boss" || n.type === "start"
        ? ("capital" as const)
        : undefined,
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

/** Live ownership, encoding run state through the ring colour: crossed nodes
 * are muted, the current node is the player's (cyan "you are here", framed by
 * the camera), and everything else flies its bright type colour. */
export function runOwners(run: RogueliteRun): Record<string, string> {
  const visited = new Set(run.progress.visited);
  const owners: Record<string, string> = {};
  for (const n of run.nodes) {
    owners[n.id] = visited.has(n.id) ? DONE_FACTION : typeFaction(n.type);
  }
  owners[run.progress.currentNodeId] = PLAYER_FACTION;
  return owners;
}

/** Opacity for each graded-emphasis tier (see {@link runEmphasis}). The path
 * ahead stays more present than the spent path behind; forks you can no longer
 * reach fall right back. */
export const RUN_DIM = {
  /** A node you've already crossed — spent, behind you. */
  done: 0.42,
  /** Reachable ahead but not an immediate choice — the road onward. */
  future: 0.55,
  /** A branch you passed on / can no longer reach. */
  unreachable: 0.22,
} as const;

/** Every node reachable by following forward edges from `fromId` (inclusive). */
export function forwardReachable(
  run: RogueliteRun,
  fromId: string,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const [a, b] of run.edges) {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  }
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const nb of adj.get(id) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return seen;
}

/**
 * Graded de-emphasis for the run map, complementing {@link runOwners}. The
 * current node and its immediate choices stay full-bright (absent from the map);
 * everything else fades by how it relates to *now*: the crossed path muted, the
 * road ahead dimmed-but-clear, forks you can no longer take pushed right back.
 * Feeds GalaxyView's `emphasis` prop.
 */
export function runEmphasis(run: RogueliteRun): Map<string, NodeEmphasis> {
  const current = run.progress.currentNodeId;
  const nextIds = new Set(successors(run, current).map((n) => n.id));
  const reachable = forwardReachable(run, current);
  const visited = new Set(run.progress.visited);
  const emphasis = new Map<string, NodeEmphasis>();
  for (const n of run.nodes) {
    if (n.id === current || nextIds.has(n.id)) continue; // full brightness
    const opacity = visited.has(n.id)
      ? RUN_DIM.done
      : reachable.has(n.id)
        ? RUN_DIM.future
        : RUN_DIM.unreachable;
    emphasis.set(n.id, { opacity });
  }
  return emphasis;
}
