import { useEffect, useState } from "react";
import {
  type SkirmishAi,
  type SkirmishAisResult,
  unitsyncSkirmishAis,
} from "../content/bindings";
import { useContentState, usePreferredEngine } from "../content/config";
import type { BattleConfig } from "./bindings";

/* -------------------------------------------------------------------------- *
 * Engine target — always the resolved preferred engine (no picker).
 * -------------------------------------------------------------------------- */

/** The launcher's engine/content target, with the engine *executable* to run. */
export interface PlayTarget {
  /** Engine dir holding `libunitsync.*` (for unitsync scans). */
  enginePath: string;
  /** Absolute path to the engine binary (for launching). */
  executable: string;
  /** Content root (`SPRING_DATADIR`). */
  dataDir: string;
  engineVersion: string;
}

/**
 * The target the launcher uses: the user's *preferred* engine (newest by
 * default), resolved from content state — including its executable, which the
 * scan-target shape omits. Unlike the content browser there's no per-page
 * override; the singleplayer screen always uses the preferred engine.
 */
export function usePreferredTarget(): {
  target: PlayTarget | null;
  loading: boolean;
  error: string | null;
} {
  const { state, loading, error } = useContentState();
  const roots = state?.roots ?? [];
  const engines = roots.flatMap((r) =>
    r.engines.map((e) => ({ id: e.id, version: e.syncVersion ?? e.version })),
  );
  const { resolvedId } = usePreferredEngine(engines);

  const build = (
    rootPath: string,
    e: (typeof roots)[number]["engines"][number],
  ) => ({
    enginePath: e.path,
    executable: e.executable,
    dataDir: rootPath,
    engineVersion: e.syncVersion ?? e.version,
  });

  // Preferred engine, else the first engine in any root.
  let target: PlayTarget | null = null;
  for (const r of roots) {
    const e = r.engines.find((en) => en.id === resolvedId);
    if (e) {
      target = build(r.path, e);
      break;
    }
  }
  if (!target) {
    const r = roots.find((r) => r.engines.length > 0);
    if (r) target = build(r.path, r.engines[0]);
  }
  return { target, loading, error };
}

/* -------------------------------------------------------------------------- *
 * Skirmish AIs — native engine AIs + the selected game's Lua AIs.
 * -------------------------------------------------------------------------- */

/** Session cache of AI lists, keyed by `dataDir::enginePath::gameArchive`. */
const skirmishAiCache = new Map<string, SkirmishAisResult>();

/**
 * List the skirmish AIs available for a game: native engine AIs plus the game's
 * bundled Lua AIs. Re-fetched when the game changes (Lua AIs live per-game).
 */
export function useSkirmishAis(
  enginePath?: string,
  dataDir?: string,
  gameArchive?: string,
) {
  const [ais, setAis] = useState<SkirmishAi[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setAis([]);
      return;
    }
    const key = `${dataDir}::${enginePath}::${gameArchive ?? ""}`;
    const cached = skirmishAiCache.get(key);
    if (cached) {
      setAis(cached.ais);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncSkirmishAis({ enginePath, dataDir, gameArchive })
      .then((res) => {
        if (cancelled) return;
        skirmishAiCache.set(key, res);
        setAis(res.ais);
      })
      .catch(() => {
        if (!cancelled) setAis([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive]);

  return { ais, loading };
}

/* -------------------------------------------------------------------------- *
 * Participant model + derivation to a BattleConfig.
 * -------------------------------------------------------------------------- */

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
): Participant {
  const aiCount = existing.filter((p) => p.kind === "ai").length;
  return {
    id: nextId(),
    kind: "ai",
    name: `AI ${aiCount + 1}`,
    side: defaultSide,
    color: PALETTE[existing.length % PALETTE.length],
    allyTeam: 1,
    spectator: false,
  };
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
}): BattleConfig {
  const { participants, mapName, gameType, startPosType, modOptions } = opts;
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
  };
}
