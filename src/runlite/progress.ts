import {
  HISTORY_CAP,
  type RewardOption,
  type RogueliteRun,
  type RunNode,
  type RunProgress,
} from "./model";

/**
 * Pure state transitions for crossing a run. The run graph is static; these
 * functions take a run + an action and return the next run (never mutating), so
 * every rule is unit-testable and the React layer stays a thin dispatcher.
 *
 * Progression model (Slay-the-Spire style): `currentNodeId` is the last node you
 * *committed* to — always a resolved node. Its forward successors are the
 * choices ahead. *Opening* a choice's overlay is only a preview and moves
 * nothing; the move commits (advancing `currentNodeId` to that node) only when
 * you resolve it — launch the battle, take the reward, choose the event, or shop.
 * So backing out of an overlay leaves you free to pick a different branch. The
 * start node is pre-resolved.
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

/** The forward choices available now: the current node's successors. Won/lost
 * runs offer nothing. */
export function nextChoices(run: RogueliteRun): RunNode[] {
  if (run.progress.status !== "active") return [];
  return successors(run, run.progress.currentNodeId);
}

/** Whether the player may act on `nodeId` now: it's a forward choice of the
 * current node (about to be committed), or the node already committed to (e.g.
 * buying again at the shop you're standing in). */
export function canActOn(run: RogueliteRun, nodeId: string): boolean {
  if (nodeId === run.progress.currentNodeId) return true;
  return successors(run, run.progress.currentNodeId).some(
    (n) => n.id === nodeId,
  );
}

const touch = (): string => new Date().toISOString();

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
  if (isResolved(run, nodeId) || !canActOn(run, nodeId)) return run;

  const p: RunProgress = { ...run.progress };
  p.visited = [...p.visited, nodeId];
  p.currentNodeId = nodeId; // committing the move happens on resolution

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

// --- Reward / event / shop resolution --------------------------------------

/** Apply one reward option to progress (mutates the passed copy). An unlock
 * widens the shared arsenal; a perk is banked for the player's team. */
function grantOption(p: RunProgress, option: RewardOption): void {
  if (option.kind === "unlock") {
    p.unlockedUnits = [
      ...new Set([...p.unlockedUnits, option.unit, ...option.opens]),
    ];
  } else {
    p.perks = [...p.perks, option.perk];
  }
}

const clampHull = (v: number, max: number) => Math.max(0, Math.min(max, v));

/** Take one option at a reward node, then mark it resolved. */
export function applyReward(
  run: RogueliteRun,
  nodeId: string,
  optionIndex: number,
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  if (!node?.reward || isResolved(run, nodeId) || !canActOn(run, nodeId)) {
    return run;
  }
  const p: RunProgress = { ...run.progress };
  const option = node.reward.options[optionIndex];
  if (option) grantOption(p, option);
  p.visited = [...p.visited, nodeId];
  p.currentNodeId = nodeId;
  return {
    ...run,
    progress: p,
    history: pushHistory(run, { nodeId, type: node.type }),
    updatedAt: now ?? touch(),
  };
}

/** Take one choice at an event node, applying its effects, then resolve it. */
export function applyEvent(
  run: RogueliteRun,
  nodeId: string,
  choiceIndex: number,
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  if (!node?.event || isResolved(run, nodeId) || !canActOn(run, nodeId)) {
    return run;
  }
  const choice = node.event.choices[choiceIndex];
  const p: RunProgress = { ...run.progress };
  if (choice) {
    if (choice.hull) p.hull = clampHull(p.hull + choice.hull, p.maxHull);
    if (choice.salvage) p.salvage = Math.max(0, p.salvage + choice.salvage);
    if (choice.perk) p.perks = [...p.perks, choice.perk];
    if (choice.unlock) {
      p.unlockedUnits = [...new Set([...p.unlockedUnits, choice.unlock])];
    }
  }
  if (p.hull <= 0) p.status = "lost";
  p.visited = [...p.visited, nodeId];
  p.currentNodeId = nodeId;
  return {
    ...run,
    progress: p,
    history: pushHistory(run, { nodeId, type: node.type }),
    updatedAt: now ?? touch(),
  };
}

/** Buy one shop offer (if affordable). The shop stays open — resolve it with
 * {@link leaveNode} when the player is done. A no-op if unaffordable. */
export function buyOffer(
  run: RogueliteRun,
  nodeId: string,
  offerIndex: number,
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  const offer = node?.shop?.offers[offerIndex];
  if (!offer || run.progress.salvage < offer.cost || !canActOn(run, nodeId)) {
    return run;
  }
  const p: RunProgress = {
    ...run.progress,
    salvage: run.progress.salvage - offer.cost,
    currentNodeId: nodeId, // stepping into the depot commits the move
  };
  grantOption(p, offer.option);
  return { ...run, progress: p, updatedAt: now ?? touch() };
}

/** Take the shop's rest option (hull for salvage), if offered and affordable. */
export function restAtShop(
  run: RogueliteRun,
  nodeId: string,
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  const shop = node?.shop;
  if (!shop?.restHull || run.progress.hull >= run.progress.maxHull) return run;
  if (!canActOn(run, nodeId)) return run;
  const cost = shop.restCost ?? 0;
  if (run.progress.salvage < cost) return run;
  const p: RunProgress = {
    ...run.progress,
    salvage: run.progress.salvage - cost,
    hull: clampHull(run.progress.hull + shop.restHull, run.progress.maxHull),
    currentNodeId: nodeId,
  };
  return { ...run, progress: p, updatedAt: now ?? touch() };
}

/** Mark a non-battle node resolved (leave a shop, or dismiss a resolved card). */
export function leaveNode(
  run: RogueliteRun,
  nodeId: string,
  now?: string,
): RogueliteRun {
  const node = nodeById(run, nodeId);
  if (!node || isResolved(run, nodeId) || !canActOn(run, nodeId)) return run;
  return {
    ...run,
    progress: {
      ...run.progress,
      visited: [...run.progress.visited, nodeId],
      currentNodeId: nodeId,
    },
    history: pushHistory(run, { nodeId, type: node.type }),
    updatedAt: now ?? touch(),
  };
}

/** The deepest column the player has reached (for meta stats). */
export function deepestColumn(run: RogueliteRun): number {
  let deepest = 0;
  for (const n of run.nodes) {
    if (run.progress.visited.includes(n.id)) deepest = Math.max(deepest, n.col);
  }
  return deepest;
}
