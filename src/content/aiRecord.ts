import type { StatAi, StatRecord } from "./bindings";
import { isGenuineMatch } from "./stats";

/**
 * Your record against AI opponents, built from the same replay records as the
 * rest of the stats page (`record.ais`, #1148). No second store.
 *
 * What counts as a game against AI, decided here and nowhere else:
 * - You are a seated player, not a spectator, on a known ally team.
 * - Every seat on another ally team is an AI, and at least one is. A game with a
 *   human opponent as well is a multiplayer game and stays out.
 * - An AI on your own ally team is an ally. It is ignored, and a game whose only
 *   AI is your ally does not count.
 * - A seat with no ally team cannot be placed, so a game with one on the
 *   opposing side does not count.
 * - You win or lose with your ally team. With no winner recorded the game is
 *   played but neither won nor lost.
 *
 * Games from other modes (campaign, Conquest, Warpath) and remix or refight
 * reruns are left out by the caller's filename sets. A replay with no provenance
 * tag counts as a skirmish.
 */

export type AiGameResult = "win" | "loss" | "undecided";

/** One game against AI, from `me`'s point of view. */
export interface AiGame {
  record: StatRecord;
  /** The AIs on other ally teams, in script order. */
  opponents: StatAi[];
  result: AiGameResult;
}

/** One row: one AI, in one game, at one bonus. */
export interface AiRecordRow {
  key: string;
  /** The game the replay was played on. */
  game: string;
  /** The AI's identity (`shortName`). Versions of one AI share a row. */
  ai: string;
  /** Null for a plain AI. Rows with different bonuses are never merged. */
  bonus: string | null;
  games: number;
  wins: number;
  losses: number;
  /** Played with no winner recorded. */
  undecided: number;
}

export interface AiRecord {
  /** Games against AI, each counted once however many AIs were in it. */
  games: number;
  wins: number;
  losses: number;
  undecided: number;
  /** Most-played first. Rows overlap when a game had several different AIs. */
  rows: AiRecordRow[];
}

/** The AI's team bonus as text, or null when it has none. */
export function bonusLabel(ai: StatAi): string | null {
  const parts: string[] = [];
  const advantage = Math.round((ai.advantage ?? 0) * 100);
  if (advantage !== 0) parts.push(`${advantage > 0 ? "+" : ""}${advantage}%`);
  const income = Math.round((ai.incomeMultiplier ?? 1) * 100) / 100;
  if (income !== 1) parts.push(`x${income} income`);
  return parts.length ? parts.join(", ") : null;
}

/** `record` as a game against AI for `me`, or null when it is not one. */
export function aiGameFor(record: StatRecord, me: string): AiGame | null {
  const mine = record.players.find((p) => !p.spectator && p.name === me);
  if (!mine || mine.allyTeam == null) return null;

  const humanFoe = record.players.some(
    (p) => !p.spectator && p !== mine && p.allyTeam !== mine.allyTeam,
  );
  if (humanFoe) return null;

  const others = record.ais.filter((a) => a.allyTeam !== mine.allyTeam);
  if (others.length === 0 || others.some((a) => a.allyTeam == null)) {
    return null;
  }

  const won = record.winnersKnown ? mine.won : undefined;
  return {
    record,
    opponents: others,
    result: won === undefined ? "undecided" : won ? "win" : "loss",
  };
}

/**
 * `me`'s record against AI. `refights` are the remix/refight reruns (as for the
 * other aggregates) and `scripted` the replays tagged campaign, Conquest or
 * Warpath.
 */
export function aiRecordFor(
  records: StatRecord[],
  me: string,
  refights: ReadonlySet<string>,
  scripted: ReadonlySet<string>,
): AiRecord {
  const total: AiRecord = {
    games: 0,
    wins: 0,
    losses: 0,
    undecided: 0,
    rows: [],
  };
  const rows = new Map<string, AiRecordRow>();

  for (const record of records) {
    if (!isGenuineMatch(record, refights) || scripted.has(record.filename)) {
      continue;
    }
    const game = aiGameFor(record, me);
    if (!game) continue;

    total.games += 1;
    tallyResult(total, game.result);

    // A game counts once on a row, even with several identical AIs in it.
    const seen = new Set<string>();
    for (const ai of game.opponents) {
      const bonus = bonusLabel(ai);
      const key = JSON.stringify([record.gameType, ai.shortName, bonus]);
      if (seen.has(key)) continue;
      seen.add(key);
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          game: record.gameType,
          ai: ai.shortName,
          bonus,
          games: 0,
          wins: 0,
          losses: 0,
          undecided: 0,
        };
        rows.set(key, row);
      }
      row.games += 1;
      tallyResult(row, game.result);
    }
  }

  total.rows = [...rows.values()].sort(
    (a, b) =>
      b.games - a.games ||
      a.ai.localeCompare(b.ai) ||
      a.game.localeCompare(b.game) ||
      (a.bonus ?? "").localeCompare(b.bonus ?? ""),
  );
  return total;
}

/** A game `me` won against AI, for the achievements evaluator. */
export interface AiWinFact {
  startTimeMs: number;
  /** The AIs beaten, by `shortName` (as `aiRecordFor` keys them), once each. */
  ais: string[];
}

/**
 * `me`'s wins against AI, chronological, filtered exactly as `aiRecordFor` is.
 * A sibling of `playerGameFacts` rather than part of it, because that keeps AIs
 * out of the per-player history. Records with no AIs give no facts.
 */
export function aiWinFacts(
  records: StatRecord[],
  me: string,
  refights: ReadonlySet<string>,
  scripted: ReadonlySet<string>,
): AiWinFact[] {
  const out: AiWinFact[] = [];
  for (const record of records) {
    if (!isGenuineMatch(record, refights) || scripted.has(record.filename)) {
      continue;
    }
    const game = aiGameFor(record, me);
    if (game?.result !== "win") continue;
    out.push({
      startTimeMs: record.startTimeMs,
      ais: [...new Set(game.opponents.map((a) => a.shortName))],
    });
  }
  return out.sort((a, b) => a.startTimeMs - b.startTimeMs);
}

function tallyResult(
  into: { wins: number; losses: number; undecided: number },
  result: AiGameResult,
) {
  if (result === "win") into.wins += 1;
  else if (result === "loss") into.losses += 1;
  else into.undecided += 1;
}
