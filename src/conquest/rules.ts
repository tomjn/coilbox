import { expandRevealed } from "./fog";
import type {
  ConquestState,
  GalaxyDoc,
  GalaxyNode,
  Incursion,
  TurnEvent,
} from "./model";
import {
  DEFAULT_AGGRESSION,
  DEFAULT_GRACE_TURNS,
  HISTORY_CAP,
  NEUTRAL,
} from "./model";
import { mulberry32, type Rng } from "./rng";

/**
 * Pure strategic rules for conquest, kept apart from the run hook so the
 * territory bookkeeping is directly unit-testable (no React / frame imports).
 * Every transition returns a fresh state, never mutating its input.
 *
 * The loop: the player fights one battle per turn (attack an adjacent node or
 * defend an incursion), or waits; then a seeded enemy round runs, in which each
 * living enemy faction takes one action — expanding into a neutral system,
 * warring a rival, or opening an incursion against a player frontier. AI-vs-AI
 * and AI-vs-neutral resolve immediately by relative-strength odds; an unanswered
 * incursion auto-resolves by the same odds when its grace runs out.
 */

/** A neutral node defends with this fraction of a faction's per-node strength. */
export const NEUTRAL_GARRISON = 1.5;
/** Capitals are picked as targets less often (harder, later) and defend harder. */
const CAPITAL_PICK_WEIGHT = 0.35;
const CAPITAL_DEFENCE = 2;

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

/** Total strength of a faction: the sum of `1 + difficulty` over its systems. */
export function factionStrength(
  galaxy: GalaxyDoc,
  state: ConquestState,
  factionId: string,
): number {
  let strength = 0;
  for (const n of galaxy.nodes) {
    if (state.owners[n.id] === factionId) strength += 1 + n.difficulty;
  }
  return strength;
}

/**
 * Probability an attacker takes `nodeId`: `atk / (atk + def)`. The defender's
 * whole faction strength backs each of its systems (so strong powers resist),
 * plus the contested node's own value as a local garrison (doubled for a
 * capital); a neutral node defends with a fixed garrison fraction only.
 */
export function winOdds(
  galaxy: GalaxyDoc,
  state: ConquestState,
  attackerId: string,
  nodeId: string,
): number {
  const node = galaxy.nodes.find((n) => n.id === nodeId);
  if (!node) return 0;
  const defenderId = state.owners[nodeId];
  const atk = factionStrength(galaxy, state, attackerId);
  const local =
    (1 + node.difficulty) * (node.kind === "capital" ? CAPITAL_DEFENCE : 1);
  const def =
    defenderId === NEUTRAL
      ? NEUTRAL_GARRISON * local
      : factionStrength(galaxy, state, defenderId) + local;
  return atk + def <= 0 ? 0 : atk / (atk + def);
}

/** Nodes adjacent to `factionId` territory that it does not already own. */
export function expansionTargets(
  galaxy: GalaxyDoc,
  state: ConquestState,
  factionId: string,
): GalaxyNode[] {
  const adj = adjacency(galaxy);
  return galaxy.nodes.filter(
    (n) =>
      state.owners[n.id] !== factionId &&
      (adj.get(n.id) ?? []).some((m) => state.owners[m] === factionId),
  );
}

/** Roll one auto-resolved attack against a node. */
function resolveAttack(
  galaxy: GalaxyDoc,
  state: ConquestState,
  attackerId: string,
  nodeId: string,
  rng: Rng,
): boolean {
  return rng() < winOdds(galaxy, state, attackerId, nodeId);
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
  let incursions = state.incursions;
  if (mode === "attack") {
    if (outcome === "victory") owners[nodeId] = state.playerFactionId;
    // A lost attack costs nothing but the turn.
  } else {
    const inc = state.incursions.find((i) => i.nodeId === nodeId);
    if (outcome === "defeat" && inc) owners[nodeId] = inc.factionId;
    // Either way the defended incursion is now resolved; others still stand.
    incursions = state.incursions.filter((i) => i.nodeId !== nodeId);
  }
  const next: ConquestState = {
    ...state,
    turn: state.turn + 1,
    owners,
    incursions,
    history: [
      ...state.history,
      { turn: state.turn, nodeId, mode, outcome },
    ].slice(-HISTORY_CAP),
    updatedAt: now,
  };
  return { ...next, status: evaluateStatus(galaxy, next) };
}

/**
 * Resolve every incursion whose grace has run out: each auto-resolves by the
 * same relative-strength odds as any AI attack (so a strong system may still
 * hold), and drops from the list either way. Unexpired incursions are kept.
 * Returns the new state and the captures made, for the recap.
 */
export function applyExpiry(
  galaxy: GalaxyDoc,
  state: ConquestState,
  rng: Rng,
  now: string = new Date().toISOString(),
): { state: ConquestState; events: TurnEvent[] } {
  if (state.status !== "active" || state.incursions.length === 0) {
    return { state, events: [] };
  }
  const owners = { ...state.owners };
  const remaining: Incursion[] = [];
  const events: TurnEvent[] = [];
  for (const inc of state.incursions) {
    if (state.turn < inc.expiresOnTurn) {
      remaining.push(inc);
      continue;
    }
    if (
      resolveAttack(
        galaxy,
        { ...state, owners },
        inc.factionId,
        inc.nodeId,
        rng,
      )
    ) {
      const from = owners[inc.nodeId];
      owners[inc.nodeId] = inc.factionId;
      events.push({ factionId: inc.factionId, nodeId: inc.nodeId, from });
    }
  }
  return {
    state: { ...state, owners, incursions: remaining, updatedAt: now },
    events,
  };
}

/**
 * The seeded enemy round: each living enemy faction (doc order) takes one
 * action. It weighs its frontier by `winOdds * value`, scaling attacks on a
 * rival or the player by its `aggression` (peaceful factions still creep into
 * neutrals) and capitals down, then draws one target. A neutral/rival target
 * auto-resolves immediately; a player target opens an incursion (advance
 * warning) it doesn't already hold. Returns the new state and its captures.
 */
export function enemyRound(
  galaxy: GalaxyDoc,
  state: ConquestState,
  rng: Rng,
  now: string = new Date().toISOString(),
): { state: ConquestState; events: TurnEvent[] } {
  if (state.status !== "active") return { state, events: [] };
  const player = state.playerFactionId;
  const graceTurns = galaxy.rules?.graceTurns ?? DEFAULT_GRACE_TURNS;
  const owners = { ...state.owners };
  const incursions = [...state.incursions];
  const events: TurnEvent[] = [];

  for (const faction of galaxy.factions) {
    if (faction.id === player) continue;
    const live = { ...state, owners, incursions };
    if (!Object.values(owners).some((o) => o === faction.id)) continue;
    const targets = expansionTargets(galaxy, live, faction.id);
    if (targets.length === 0) continue;
    const aggression = faction.aggression ?? DEFAULT_AGGRESSION;

    const weights = targets.map((n) => {
      const value = 1 + n.difficulty;
      const capital = n.kind === "capital" ? CAPITAL_PICK_WEIGHT : 1;
      const hostile = owners[n.id] !== NEUTRAL ? aggression : 1;
      return (
        winOdds(galaxy, live, faction.id, n.id) * value * capital * hostile
      );
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    let roll = rng() * total;
    let target = targets[targets.length - 1];
    for (let i = 0; i < targets.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        target = targets[i];
        break;
      }
    }

    if (owners[target.id] === player) {
      if (!incursions.some((i) => i.nodeId === target.id)) {
        incursions.push({
          nodeId: target.id,
          factionId: faction.id,
          expiresOnTurn: state.turn + graceTurns,
        });
      }
    } else if (resolveAttack(galaxy, live, faction.id, target.id, rng)) {
      const from = owners[target.id];
      owners[target.id] = faction.id;
      events.push({ factionId: faction.id, nodeId: target.id, from });
    }
  }
  return {
    state: { ...state, owners, incursions, updatedAt: now },
    events,
  };
}

/** The deterministic RNG for a given turn's enemy round. */
export function turnRng(state: ConquestState): Rng {
  // Mix the turn in so each turn draws a fresh, reproducible stream.
  return mulberry32((state.seed ^ (state.turn * 0x9e3779b9)) >>> 0);
}

/**
 * The post-turn pipeline shared by fighting and waiting: due incursions expire,
 * the enemy round runs, fog widens, status is re-evaluated. `state` must have
 * its turn already advanced. One seeded RNG stream covers the whole turn.
 */
function resolveTurn(
  galaxy: GalaxyDoc,
  state: ConquestState,
  now: string,
): ConquestState {
  if (state.status !== "active") return { ...state, lastRound: [] };
  const rng = turnRng(state);
  const expiry = applyExpiry(galaxy, state, rng, now);
  let next = expiry.state;
  const events = [...expiry.events];
  if (evaluateStatus(galaxy, next) === "active") {
    const round = enemyRound(galaxy, next, rng, now);
    next = round.state;
    events.push(...round.events);
  }
  next = { ...next, lastRound: events };
  if (galaxy.rules?.fogOfWar) {
    next = {
      ...next,
      revealed: expandRevealed(
        galaxy,
        next.owners,
        next.playerFactionId,
        next.revealed,
      ),
    };
  }
  return { ...next, status: evaluateStatus(galaxy, next) };
}

/**
 * The full post-battle pipeline: player outcome, then the shared post-turn
 * resolution (expiry -> enemy round -> fog -> status).
 */
export function advanceAfterBattle(
  galaxy: GalaxyDoc,
  state: ConquestState,
  nodeId: string,
  mode: "attack" | "defend",
  outcome: "victory" | "defeat",
  now: string = new Date().toISOString(),
): ConquestState {
  const afterBattle = applyBattleOutcome(
    galaxy,
    state,
    nodeId,
    mode,
    outcome,
    now,
  );
  return resolveTurn(galaxy, afterBattle, now);
}

/**
 * Advance the galaxy one turn without a player battle ("Hold position"): the
 * world moves — enemies expand, rivals fight, incursions age — while the player
 * holds. No-op on a finished run.
 */
export function advanceTurn(
  galaxy: GalaxyDoc,
  state: ConquestState,
  now: string = new Date().toISOString(),
): ConquestState {
  if (state.status !== "active") return state;
  const ticked: ConquestState = {
    ...state,
    turn: state.turn + 1,
    updatedAt: now,
  };
  return resolveTurn(galaxy, ticked, now);
}
