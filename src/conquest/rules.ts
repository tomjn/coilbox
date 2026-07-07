import type { ConquestState, GalaxyDoc, GalaxyNode } from "./model";
import { DEFAULT_AGGRESSION, DEFAULT_GRACE_TURNS, HISTORY_CAP } from "./model";
import { mulberry32, type Rng } from "./rng";

/**
 * Pure strategic rules for conquest, kept apart from the run hook so the
 * territory bookkeeping is directly unit-testable (no React / frame imports).
 * Every transition returns a fresh state, never mutating its input.
 *
 * The v1 loop: one battle per turn (attack an adjacent node or defend an
 * incursion), then a seeded enemy phase that may open at most one incursion
 * globally. Ignoring an incursion for `graceTurns` turns forfeits the node.
 */

/** Undirected adjacency map from the galaxy's links. */
export function adjacency(galaxy: GalaxyDoc): Map<string, string[]> {
  const adj = new Map<string, string[]>(galaxy.nodes.map((n) => [n.id, []]));
  for (const [a, b] of galaxy.links) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  return adj;
}

/** Enemy/neutral nodes adjacent to player territory — the legal attacks. */
export function attackableNodes(
  galaxy: GalaxyDoc,
  state: ConquestState,
): GalaxyNode[] {
  const adj = adjacency(galaxy);
  const player = state.playerFactionId;
  return galaxy.nodes.filter(
    (n) =>
      state.owners[n.id] !== player &&
      (adj.get(n.id) ?? []).some((m) => state.owners[m] === player),
  );
}

/** Player-owned nodes adjacent to `factionId` territory — its raid targets. */
export function frontierNodes(
  galaxy: GalaxyDoc,
  state: ConquestState,
  factionId: string,
): GalaxyNode[] {
  const adj = adjacency(galaxy);
  const player = state.playerFactionId;
  return galaxy.nodes.filter(
    (n) =>
      state.owners[n.id] === player &&
      (adj.get(n.id) ?? []).some((m) => state.owners[m] === factionId),
  );
}

/** The capital node of a faction (authored owner), or undefined. */
export function capitalOf(
  galaxy: GalaxyDoc,
  factionId: string,
): GalaxyNode | undefined {
  return galaxy.nodes.find(
    (n) => n.kind === "capital" && n.owner === factionId,
  );
}

/** Enemy AI count for a node difficulty: 1-2 -> one, 3-4 -> two, 5 -> three. */
export function difficultyTable(difficulty: number): number {
  if (difficulty >= 5) return 3;
  if (difficulty >= 3) return 2;
  return 1;
}

/** Default enemy team handicap % for a node difficulty. */
export function difficultyHandicap(difficulty: number): number {
  return [0, 0, 10, 25, 40][Math.min(4, Math.max(0, difficulty - 1))];
}

/**
 * Won / lost / active from the ownership map. Won = the player owns every
 * enemy faction's capital; lost = the player's own capital is gone. Factions
 * without a capital in the doc are ignored (reconcile can produce that after
 * a doc edit).
 */
export function evaluateStatus(
  galaxy: GalaxyDoc,
  state: ConquestState,
): ConquestState["status"] {
  const player = state.playerFactionId;
  const own = capitalOf(galaxy, player);
  if (own && state.owners[own.id] !== player) return "lost";
  const enemies = galaxy.factions.filter((f) => f.id !== player);
  const objectives = enemies
    .map((f) => capitalOf(galaxy, f.id))
    .filter((n): n is GalaxyNode => n !== undefined);
  if (
    objectives.length > 0 &&
    objectives.every((n) => state.owners[n.id] === player)
  ) {
    return "won";
  }
  return "active";
}

/**
 * Record a resolved battle: flip ownership per the v1 rules, clear a defended
 * incursion, tick the turn, append history and re-evaluate status. A cancelled
 * launch never reaches this — cancelling consumes nothing.
 */
export function applyBattleOutcome(
  galaxy: GalaxyDoc,
  state: ConquestState,
  nodeId: string,
  mode: "attack" | "defend",
  outcome: "victory" | "defeat",
  now: string = new Date().toISOString(),
): ConquestState {
  const owners = { ...state.owners };
  let incursion = state.incursion;
  if (mode === "attack") {
    if (outcome === "victory") owners[nodeId] = state.playerFactionId;
    // A lost attack costs nothing but the turn.
  } else {
    if (outcome === "defeat" && incursion) {
      owners[nodeId] = incursion.factionId;
    }
    incursion = undefined;
  }
  const next: ConquestState = {
    ...state,
    turn: state.turn + 1,
    owners,
    incursion,
    history: [
      ...state.history,
      { turn: state.turn, nodeId, mode, outcome },
    ].slice(-HISTORY_CAP),
    updatedAt: now,
  };
  return { ...next, status: evaluateStatus(galaxy, next) };
}

/**
 * If the active incursion's grace has run out, the node falls without a
 * battle. Trading space for tempo is allowed; ignoring a threat has a real,
 * bounded cost.
 */
export function applyExpiry(
  galaxy: GalaxyDoc,
  state: ConquestState,
  now: string = new Date().toISOString(),
): ConquestState {
  const inc = state.incursion;
  if (!inc || state.turn < inc.expiresOnTurn) return state;
  const next: ConquestState = {
    ...state,
    owners: { ...state.owners, [inc.nodeId]: inc.factionId },
    incursion: undefined,
    updatedAt: now,
  };
  return { ...next, status: evaluateStatus(galaxy, next) };
}

/**
 * The seeded enemy phase, run after every resolved battle. At most one
 * incursion exists globally (v1 keeps the pressure legible); while one is
 * active the phase is skipped. Each surviving enemy faction (doc order) rolls
 * against its `aggression`; the first success opens an incursion against a
 * player frontier node, weighted away from the player's capital unless it is
 * the only reachable target.
 */
export function enemyPhase(
  galaxy: GalaxyDoc,
  state: ConquestState,
  rng: Rng,
  now: string = new Date().toISOString(),
): ConquestState {
  if (state.status !== "active" || state.incursion) return state;
  const graceTurns = galaxy.rules?.graceTurns ?? DEFAULT_GRACE_TURNS;
  const playerCapital = capitalOf(galaxy, state.playerFactionId);

  for (const faction of galaxy.factions) {
    if (faction.id === state.playerFactionId) continue;
    const alive = Object.values(state.owners).some((o) => o === faction.id);
    if (!alive) continue;
    if (rng() >= (faction.aggression ?? DEFAULT_AGGRESSION)) continue;

    const targets = frontierNodes(galaxy, state, faction.id);
    if (targets.length === 0) continue;
    const weights = targets.map((n) =>
      playerCapital && n.id === playerCapital.id && targets.length > 1
        ? 0.25
        : 1,
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let target = targets[targets.length - 1];
    for (let i = 0; i < targets.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        target = targets[i];
        break;
      }
    }
    return {
      ...state,
      incursion: {
        nodeId: target.id,
        factionId: faction.id,
        expiresOnTurn: state.turn + graceTurns,
      },
      updatedAt: now,
    };
  }
  return state;
}

/** The deterministic RNG for a given turn's enemy phase. */
export function turnRng(state: ConquestState): Rng {
  // Mix the turn in so each phase draws a fresh, reproducible stream.
  return mulberry32((state.seed ^ (state.turn * 0x9e3779b9)) >>> 0);
}

/**
 * The full post-battle pipeline: outcome -> enemy phase -> expiry -> status.
 * One call in the run hook keeps the ordering in one tested place.
 */
export function advanceAfterBattle(
  galaxy: GalaxyDoc,
  state: ConquestState,
  nodeId: string,
  mode: "attack" | "defend",
  outcome: "victory" | "defeat",
  now: string = new Date().toISOString(),
): ConquestState {
  let next = applyBattleOutcome(galaxy, state, nodeId, mode, outcome, now);
  if (next.status !== "active") return next;
  // Expiry first: an incursion opened before this battle may have just run
  // out; only then may a new one open.
  next = applyExpiry(galaxy, next, now);
  if (next.status !== "active") return next;
  return enemyPhase(galaxy, next, turnRng(next), now);
}
