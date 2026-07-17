import {
  HISTORY_CAP,
  type RogueliteRun,
  type RunNode,
  type RunProgress,
} from "./model";

/**
 * Pure state transitions for crossing a run. The run graph is static; these
 * functions take a run + an action and return the next run (never mutating), so
 * every rule is unit-testable and the React layer stays a thin dispatcher.
 *
 * Progression model (Slay-the-Spire style): you occupy `currentNodeId`. A node
 * is *resolved* once it's in `visited`. When the current node is resolved you
 * may move to one of its forward successors (which becomes the new current,
 * unresolved, awaiting its own resolution). The start node is pre-resolved.
 */

function nodeById(run: RogueliteRun, id: string): RunNode | undefined {
  return run.nodes.find((n) => n.id === id);
}

/** Forward successors of a node (edge targets). */
export function successors(run: RogueliteRun, nodeId: string): RunNode[] {
  const ids = run.edges.filter(([a]) => a === nodeId).map(([, b]) => b);
  return ids
    .map((id) => nodeById(run, id))
    .filter((n): n is RunNode => n !== undefined);
}

/** Whether a node has been resolved (its effect applied). */
export function isResolved(run: RogueliteRun, nodeId: string): boolean {
  return run.progress.visited.includes(nodeId);
}

/** The node currently awaiting resolution, or `null` if the current node is
 * already resolved (in which case the player is choosing where to go next). */
export function pendingNode(run: RogueliteRun): RunNode | null {
  const cur = run.progress.currentNodeId;
  return isResolved(run, cur) ? null : (nodeById(run, cur) ?? null);
}

/** The forward choices available now: successors of the current node once it's
 * resolved, else none (the current node must be resolved first). Won/lost runs
 * offer nothing. */
export function nextChoices(run: RogueliteRun): RunNode[] {
  if (run.progress.status !== "active") return [];
  const cur = run.progress.currentNodeId;
  return isResolved(run, cur) ? successors(run, cur) : [];
}

const touch = (): string => new Date().toISOString();

/** Move to a forward successor of the (resolved) current node. Rejected — a
 * no-op returning the same run — if `nodeId` isn't a legal current choice. */
export function moveTo(
  run: RogueliteRun,
  nodeId: string,
  now?: string,
): RogueliteRun {
  if (!nextChoices(run).some((n) => n.id === nodeId)) return run;
  return {
    ...run,
    progress: { ...run.progress, currentNodeId: nodeId },
    updatedAt: now ?? touch(),
  };
}

// --- Battle resolution -----------------------------------------------------

/** Salvage awarded for winning a battle node, scaled by tier and kind. */
export function salvageReward(node: RunNode): number {
  const tier = node.battle?.techTier ?? 1;
  const base = 40 + tier * 15;
  const mult = node.type === "boss" ? 2 : node.type === "elite" ? 1.6 : 1;
  return Math.round(base * mult);
}

/** Hull lost for losing a battle node, scaled by tier and kind. */
export function hullLoss(node: RunNode): number {
  const tier = node.battle?.techTier ?? 1;
  const base = 10 + tier * 4;
  const extra = node.type === "boss" ? 10 : node.type === "elite" ? 6 : 0;
  return base + extra;
}

function pushHistory(
  run: RogueliteRun,
  entry: {
    nodeId: string;
    type: RunNode["type"];
    outcome?: "victory" | "defeat";
    note?: string;
  },
): RogueliteRun["history"] {
  return [...run.history, entry].slice(-HISTORY_CAP);
}

/**
 * Resolve the current battle node's outcome. A win banks salvage (and clears the
 * run if it's the boss); a loss costs hull (a retreat, not an instant death —
 * the node still counts as crossed, so the run can't soft-lock). Either way the
 * node is marked visited. Hull hitting 0 ends the run.
 */
export function resolveBattle(
  run: RogueliteRun,
  nodeId: string,
  outcome: "victory" | "defeat",
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  if (!node || node.type === "start") return run;
  if (isResolved(run, nodeId)) return run;

  const p: RunProgress = { ...run.progress };
  p.visited = [...p.visited, nodeId];

  if (outcome === "victory") {
    p.salvage += salvageReward(node);
    if (node.type === "boss") p.status = "won";
  } else {
    p.hull = Math.max(0, p.hull - hullLoss(node));
    if (p.hull <= 0) p.status = "lost";
  }

  return {
    ...run,
    progress: p,
    history: pushHistory(run, { nodeId, type: node.type, outcome }),
    updatedAt: now ?? touch(),
  };
}
