import { randomTeamColorHex } from "@/lib/teamColor";
import type { Battle, BattleStatus, Rating, User, Vote } from "../bindings";

// Re-exported so existing call sites (and config.test.ts) keep importing the
// random-colour helper from `./config` unchanged; the implementation now lives in
// the shared hook-free core at `@/lib/teamColor`.
export { randomTeamColorHex };

/**
 * Pure, unit-tested helpers for the battle room. No React, no bindings — the
 * derivations the room reads out of the mirror (colour codec, row model, sync
 * roll-up) live here so they can be tested in isolation and stay stable.
 */

/* -------------------------------------------------------------------------- *
 * Team colour codec.
 *
 * The protocol's `teamColor` is a decimal `0xBBGGRR` int — red is the LOW byte,
 * the reverse of a CSS `#rrggbb`. This is distinct from play's `hexToRgb`/
 * `rgbToHex` (which work on 0..1 floats), so the battle room gets its own pair.
 * -------------------------------------------------------------------------- */

/** `0xBBGGRR` int -> `#rrggbb`. */
export function colorIntToHex(c: number): string {
  const r = c & 0xff;
  const g = (c >> 8) & 0xff;
  const b = (c >> 16) & 0xff;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** `#rrggbb` -> `0xBBGGRR` int. */
export function hexToColorInt(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (b << 16) | (g << 8) | r;
}

/**
 * The colours already taken in a battle, as `#rrggbb`, for collision avoidance
 * when we (or the host) assign a new colour. Every member (except `self`) and
 * every bot contributes its `teamColor`; the protocol's 0 "unset" is dropped so a
 * black default never counts as taken. Converts via `colorIntToHex` — the lobby's
 * `0xBBGGRR` space, never play's float RGB (they must not be crossed).
 */
export function usedColorsFromBattle(
  battle: Battle,
  self: string | null,
): string[] {
  const out: string[] = [];
  for (const [name, m] of Object.entries(battle.members)) {
    if (name === self || m.teamColor === 0) continue;
    out.push(colorIntToHex(m.teamColor));
  }
  for (const b of Object.values(battle.bots)) {
    if (b.teamColor === 0) continue;
    out.push(colorIntToHex(b.teamColor));
  }
  return out;
}

/** Ally-team letters (A, B, C…) mapped to 0-based indices. */
export const allyLetter = (n: number): string => String.fromCharCode(65 + n);

/**
 * Parse a unitsync hex CRC into the signed 32-bit int the OPENBATTLE /
 * UPDATEBATTLEINFO wire carries. `| 0` folds a >2^31 checksum into the signed
 * range the server reads it back in.
 */
export function hexToI32(hex?: string): number {
  if (!hex) return 0;
  return Number.parseInt(hex, 16) | 0;
}

/** Black or white text, whichever reads better on `hex` (perceived luminance). */
export function readableText(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

/** The start-position mode from the battle's script tags (0 fixed by default). */
export function startPosTypeOf(battle: Battle): number {
  for (const [k, v] of Object.entries(battle.scriptTags)) {
    if (k.toLowerCase() === "game/startpostype") {
      const n = Number.parseInt(v, 10);
      return Number.isNaN(n) ? 0 : n;
    }
  }
  return 0;
}

/* -------------------------------------------------------------------------- *
 * Row model — humans + bots unified into one sortable list.
 * -------------------------------------------------------------------------- */

export interface MemberRow {
  name: string;
  kind: "human" | "bot";
  /** This row is the logged-in user (the one editable row). */
  self: boolean;
  /** This row is the battle's founder/host (usually the autohost bot). */
  host: boolean;
  /**
   * This row is a boss of the lobby, so they may change it. Tachyon only: a
   * lobby has no founder, and a boss is what it has in place of one.
   */
  boss: boolean;
  ready: boolean;
  /** 0 unknown, 1 synced, 2 unsynced. */
  sync: number;
  spectator: boolean;
  teamId: number;
  ally: number;
  side: number;
  colorHex: string;
  /** Humans only: ISO 3166-1 alpha-2 country (from ADDUSER), when known. */
  country?: string;
  /** Humans only: server rank 0-7 (from ClientStatus), when known. */
  rank?: number;
  /** Humans only: what the server says about their skill, where it says
   * anything (issue #2002). Absent for a bot, which nobody rates, and for a
   * connection to a server that rates nobody. */
  rating?: Rating;
  /** Humans only: stable account id (from `User.userId`), when known. Used to
   * key client-local per-player notes so they survive a nick change. */
  userId?: string;
  /** Bots only: the AI dll and its owning player. */
  aiDll?: string;
  owner?: string;
}

function rowFromStatus(
  name: string,
  kind: "human" | "bot",
  s: BattleStatus,
  teamColor: number,
  flags: { self: boolean; host: boolean; boss?: boolean },
): MemberRow {
  return {
    name,
    kind,
    self: flags.self,
    host: flags.host,
    boss: !!flags.boss,
    ready: s.ready,
    sync: s.sync,
    spectator: !s.mode,
    teamId: s.teamId,
    ally: s.ally,
    side: s.side,
    colorHex: colorIntToHex(teamColor),
  };
}

/**
 * The battle's members + bots as an ordered row list: host first, then the
 * logged-in user, then remaining humans alphabetically, then bots. Bots carry
 * their `aiDll`/`owner` for display.
 */
export function membersToRows(
  battle: Battle,
  me: string | null,
  users?: Record<string, User>,
): MemberRow[] {
  const rank = (name: string) =>
    name === battle.host ? 0 : name === me ? 1 : 2;
  const humans = Object.entries(battle.members)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, m]) => {
      const u = users?.[name];
      return {
        ...rowFromStatus(name, "human", m.battleStatus, m.teamColor, {
          self: name === me,
          host: name === battle.host,
          boss: battle.bosses.includes(name),
        }),
        country: u?.country,
        rank: u?.status.rank,
        rating: u?.rating,
        userId: u?.userId,
      };
    });
  const bots = Object.entries(battle.bots)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bot]) => ({
      ...rowFromStatus(name, "bot", bot.battleStatus, bot.teamColor, {
        self: false,
        host: false,
      }),
      aiDll: bot.aiDll,
      owner: bot.owner,
    }));
  return [...humans, ...bots];
}

/* -------------------------------------------------------------------------- *
 * Bot AI availability (#501, false positive fixed in #547).
 * -------------------------------------------------------------------------- */

/**
 * A bot's `aiDll` as carried on the wire can be more than a bare shortName.
 * Some autohosts (seen with SplinterFaction) prefix it with a numeric id, e.g.
 * `"11772313 SimpleAI"`. The addable-AI list is always keyed by the bare
 * shortName, so the last whitespace-separated token is what should be
 * compared against it. A plain `"SimpleAI"` has only the one token, so it is
 * unaffected.
 */
export function aiShortNameFromDll(aiDll: string): string {
  const parts = aiDll.trim().split(/\s+/);
  return parts[parts.length - 1] || aiDll;
}

/**
 * Whether a bot's current AI should read as unavailable (#501): its shortName
 * (extracted from `aiDll`, ignoring any id/version prefix, see
 * `aiShortNameFromDll`) isn't offered by the hosted game at all. Never flags
 * while the addable-AI list isn't ready yet (`ready`, e.g. `addableAisReady`
 * from `useBattleRoom`, #531). An unloaded list must not read as "this game
 * has no AIs".
 */
/**
 * Whether a room of this mode will accept a bot at all. Pure.
 *
 * Zero-K's server takes bots in a Custom or a Cooperative room and refuses them
 * everywhere else, answering with a message box rather than an error, so an Add
 * AI button offered in a Teams room does nothing anyone can see. A room with no
 * mode is one whose protocol has no such rule.
 */
export function roomTakesBots(mode: string | null): boolean {
  return mode == null || mode === "custom" || mode === "coop";
}

export function isAiUnavailable(
  aiDll: string | undefined,
  addableAis: { shortName: string }[],
  ready: boolean,
): boolean {
  if (!ready || !aiDll) return false;
  const named = (name: string) =>
    addableAis.some((a) => a.shortName.toLowerCase() === name);
  // The whole string first. Stripping a prefix off a name that never had one
  // is how "Chicken: Beginner" became "Beginner", which is nothing's name, so
  // every Zero-K chicken read as an AI the game does not have.
  if (named(aiDll.trim().toLowerCase())) return false;
  return !named(aiShortNameFromDll(aiDll).toLowerCase());
}

/* -------------------------------------------------------------------------- *
 * Sync roll-up for the top status pill.
 * -------------------------------------------------------------------------- */

export type SyncState = "synced" | "pending" | "error";

/**
 * Roll the battle's per-player sync flags plus local content presence into a
 * single pill state. Missing map/game or any unsynced player (sync=2) is an
 * error; an unknown player (sync=0) is pending; otherwise synced. Spectators are
 * ignored — their sync doesn't gate the match starting.
 */
export function deriveSync(
  battle: Battle,
  content: { mapMissing: boolean; gameMissing: boolean },
): SyncState {
  if (content.mapMissing || content.gameMissing) return "error";
  const players = Object.values(battle.members)
    .filter((m) => m.battleStatus.mode)
    .map((m) => m.battleStatus.sync);
  if (players.some((s) => s === 2)) return "error";
  if (players.some((s) => s === 0)) return "pending";
  return "synced";
}

/**
 * Whether the Start button should enable: the battle has at least one non-spectator
 * participant (human *or* bot) and every non-spectator human has readied up. Bots
 * count as players and are always ready, so an all-bot match with the host
 * spectating is startable (the engine/autohost still enforces its own team rules).
 * An all-spectator room is never startable.
 */
export function battleStartable(rows: MemberRow[]): boolean {
  const playing = rows.filter((r) => !r.spectator);
  if (playing.length === 0) return false;
  return playing.every((r) => r.kind !== "human" || r.ready);
}

/* -------------------------------------------------------------------------- *
 * Vote-open notification gate.
 * -------------------------------------------------------------------------- */

/**
 * Whether a vote-called notification should fire for this render: only on the
 * null -> set transition. `prevVote` is whatever `currentVote` was the last
 * time this ran (tracked by the caller in a ref), so a re-render with the same
 * open vote (tally ticking up, countdown ticking down) never re-fires — those
 * still produce a non-null `vote`, but `prevVote` is non-null too. Once the
 * vote clears (`currentVote` goes back to null) the caller's ref resets, so
 * the next distinct vote opening fires again.
 */
export function shouldNotifyVoteOpened(
  prevVote: Vote | null,
  vote: Vote | null,
): boolean {
  return prevVote === null && vote !== null;
}
