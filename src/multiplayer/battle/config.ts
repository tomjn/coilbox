import type { Battle, BattleStatus } from "../bindings";

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

/** HSL (h in 0..360, s/l in 0..1) -> `#rrggbb`. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * A fresh random team colour as `#rrggbb`. A random hue at fixed saturation/
 * lightness always yields a bright, distinct colour — never the muddy or
 * near-black values a uniform-random RGB would sometimes produce. Used when the
 * user has no remembered colour yet, so they never join a battle as black.
 */
export function randomTeamColorHex(): string {
  return hslToHex(Math.floor(Math.random() * 360), 0.65, 0.55);
}

/** Ally-team letters (A, B, C…) mapped to 0-based indices. */
export const allyLetter = (n: number): string => String.fromCharCode(65 + n);

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
  ready: boolean;
  /** 0 unknown, 1 synced, 2 unsynced. */
  sync: number;
  spectator: boolean;
  teamId: number;
  ally: number;
  side: number;
  colorHex: string;
  /** Bots only: the AI dll and its owning player. */
  aiDll?: string;
  owner?: string;
}

function rowFromStatus(
  name: string,
  kind: "human" | "bot",
  s: BattleStatus,
  teamColor: number,
  flags: { self: boolean; host: boolean },
): MemberRow {
  return {
    name,
    kind,
    self: flags.self,
    host: flags.host,
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
export function membersToRows(battle: Battle, me: string | null): MemberRow[] {
  const rank = (name: string) =>
    name === battle.host ? 0 : name === me ? 1 : 2;
  const humans = Object.entries(battle.members)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, m]) =>
      rowFromStatus(name, "human", m.battleStatus, m.teamColor, {
        self: name === me,
        host: name === battle.host,
      }),
    );
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
