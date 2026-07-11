import { isBlackHex, pickTeamColorHex } from "@/lib/teamColor";
import type { SkirmishAi } from "../content/bindings";
import type { BattleConfig } from "./bindings";

/**
 * The pure participant model and its derivation to an engine `BattleConfig`,
 * kept free of hooks and frame imports so consumers (campaign, conquest) and
 * their unit tests can use it without loading the UI stack. The launcher-side
 * hooks live in `./config`, which re-exports everything here.
 */

/** Encode an AI reference to the persisted key (`kind:shortName`). */
export const aiKey = (a: { kind: string; shortName: string }) =>
  `${a.kind}:${a.shortName}`;

/** Narrow a full `SkirmishAi` to the reference stored on a participant. */
const toAiRef = (a?: SkirmishAi): Participant["ai"] | undefined =>
  a ? { kind: a.kind, shortName: a.shortName, name: a.name } : undefined;

/** Resolve a persisted `aiKey` against the current AI list, if still available. */
export function resolveAi(
  key: string,
  ais: SkirmishAi[],
): Participant["ai"] | undefined {
  if (!key) return undefined;
  const [kind, shortName] = key.split(/:(.*)/s);
  return toAiRef(ais.find((a) => a.kind === kind && a.shortName === shortName));
}

/**
 * The AI a new opponent should default to: the last one the user picked, or the
 * first available AI when nothing's been picked yet (or the last pick is gone).
 */
export function defaultAi(
  lastAi: string,
  ais: SkirmishAi[],
): Participant["ai"] | undefined {
  return resolveAi(lastAi, ais) ?? toAiRef(ais[0]);
}

export type Rgb = [number, number, number];

/** Distinct default team colours (0..1), cycled as participants are added. */
export const PALETTE: Rgb[] = [
  [0.9, 0.24, 0.2], // red
  [0.31, 0.55, 1.0], // blue
  [0.32, 0.79, 0.54], // green
  [0.96, 0.7, 0.26], // amber
  [0.7, 0.4, 0.9], // purple
  [0.36, 0.8, 0.85], // teal
  [0.95, 0.5, 0.7], // pink
  [0.6, 0.63, 0.7], // grey
];

/** One participant in the UI model. Index 0 is always "you". */
export interface Participant {
  id: string;
  kind: "you" | "ai";
  name: string;
  /** Selected AI (for `kind === "ai"`); absent = an empty/open slot. */
  ai?: { shortName: string; kind: "native" | "lua"; name?: string };
  /** Faction/side name; empty means "engine default (first side)". */
  side: string;
  color: Rgb;
  allyTeam: number;
  /** Only meaningful on the "you" row. */
  spectator: boolean;
  /** Team handicap % (resource/damage bonus). Undefined = 0 (not emitted). */
  handicap?: number;
}

let idSeq = 0;
const nextId = () => `p${idSeq++}`;

/** The initial two-participant setup: you (ally 0) vs one AI (ally 1). */
export function initialParticipants(): Participant[] {
  return [
    {
      id: nextId(),
      kind: "you",
      name: "You",
      side: "",
      color: PALETTE[0],
      allyTeam: 0,
      spectator: false,
    },
    {
      id: nextId(),
      kind: "ai",
      name: "AI 1",
      side: "",
      color: PALETTE[1],
      allyTeam: 1,
      spectator: false,
    },
  ];
}

/**
 * Build a fresh AI opponent, cycling the colour palette and numbering by count.
 * `defaultSide` is the game's first faction, chosen up-front so a new row never
 * shows a meaningless "default" faction.
 */
export function makeAiParticipant(
  existing: Participant[],
  defaultSide = "",
  ai?: Participant["ai"],
): Participant {
  const aiCount = existing.filter((p) => p.kind === "ai").length;
  return {
    id: nextId(),
    kind: "ai",
    name: `AI ${aiCount + 1}`,
    ai,
    side: defaultSide,
    // Prefer the palette, but skip colours already taken (and never black), then
    // bridge hex -> play's float RGB (never the lobby's 0xBBGGRR int).
    color: hexToRgb(
      pickTeamColorHex({
        used: existing.map((p) => rgbToHex(p.color)),
        palette: PALETTE.map(rgbToHex),
      }),
    ),
    allyTeam: 1,
    spectator: false,
  };
}

/**
 * Replace any black/invalid participant colour with a distinct, non-black pick,
 * so a stale persisted draft (or older seeding) never shows a player as black.
 * The "you" row is seeded from the `remembered` colour when its own colour is
 * black/invalid; a valid draft colour is kept untouched. Colours already valid on
 * other rows are preserved and count as taken so heals stay distinct. Returns the
 * same array reference when nothing needed healing. Hex core -> play float RGB.
 */
export function sanitizeColors(
  participants: Participant[],
  remembered?: string,
): Participant[] {
  const palette = PALETTE.map(rgbToHex);
  const used: string[] = [];
  let changed = false;
  const next = participants.map((p) => {
    const hex = rgbToHex(p.color);
    if (!isBlackHex(hex)) {
      used.push(hex);
      return p;
    }
    const pick = pickTeamColorHex({
      remembered: p.kind === "you" ? remembered : undefined,
      used,
      palette,
    });
    used.push(pick);
    changed = true;
    return { ...p, color: hexToRgb(pick) };
  });
  return changed ? next : participants;
}

/** `#rrggbb` -> RGB in 0..1. */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** RGB in 0..1 -> `#rrggbb`. */
export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Derive the engine-shaped `BattleConfig` from the UI model. Spectators are
 * dropped from the team list; non-spectator participants get team indices by
 * order; ally-team values are remapped to a contiguous 0..k range. A native AI
 * becomes an `[AI]` block; a Lua AI is set on its team via `LuaAI`.
 */
export function toBattleConfig(opts: {
  participants: Participant[];
  mapName: string;
  gameType: string;
  startPosType: number;
  modOptions: Record<string, string>;
  /** Units to disable entirely (rendered as `[RESTRICT]` limit 0). */
  disabledUnits?: string[];
}): BattleConfig {
  const {
    participants,
    mapName,
    gameType,
    startPosType,
    modOptions,
    disabledUnits,
  } = opts;
  const you = participants[0];
  const active = participants.filter((p) => !(p.kind === "you" && p.spectator));

  const teamIndexById = new Map(active.map((p, i) => [p.id, i] as const));

  const allyValues = [...new Set(active.map((p) => p.allyTeam))].sort(
    (a, b) => a - b,
  );
  const allyIndexByValue = new Map(allyValues.map((v, i) => [v, i] as const));

  const teams = active.map((p) => {
    const team: BattleConfig["teams"][number] = {
      teamLeader: 0,
      allyTeam: allyIndexByValue.get(p.allyTeam) ?? 0,
      rgbColor: p.color,
      side: p.side || undefined,
    };
    // Handicap % maps onto the engine's `Advantage` (a resource-income bonus
    // fraction — the modern spelling of the legacy `Handicap` field), which
    // the play crate already emits per team.
    if (p.handicap) team.advantage = p.handicap / 100;
    if (p.ai?.kind === "lua") team.luaAi = p.ai.shortName;
    return team;
  });

  const ais = active
    .filter((p) => p.ai?.kind === "native")
    .map((p) => ({
      name: p.name,
      shortName: p.ai?.shortName ?? "",
      team: teamIndexById.get(p.id) ?? 0,
      host: 0,
    }));

  return {
    mapName,
    gameType,
    myPlayerName: you.name,
    startPosType,
    players: [
      {
        name: you.name,
        spectator: you.spectator,
        team: you.spectator ? undefined : teamIndexById.get(you.id),
      },
    ],
    ais,
    teams,
    allyTeams: allyValues.map(() => ({ numAllies: 0 })),
    modOptions: Object.keys(modOptions).length > 0 ? modOptions : undefined,
    restrictedUnits:
      disabledUnits && disabledUnits.length > 0
        ? Object.fromEntries(disabledUnits.map((name) => [name, 0]))
        : undefined,
  };
}
