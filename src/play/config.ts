import { useSetting } from "@picoframe/frame";
import { useEffect, useState } from "react";
import {
  type ConfigOption,
  type SkirmishAi,
  type SkirmishAisResult,
  unitsyncSkirmishAis,
} from "../content/bindings";
import {
  primeGameInfo,
  primeMapInfo,
  useContentState,
  usePreferredEngine,
  useUnitsyncScan,
} from "../content/config";
import { compareEngineVersions } from "../content/engineVersion";
import { withoutGeneratedGames } from "../lib/generatedGames";

export type { Participant, Rgb } from "./participants";
// The pure participant model lives in ./participants (no hooks, no frame
// imports) so campaign/conquest logic and unit tests can use it directly;
// re-exported here so existing launcher imports keep working.
export {
  aiByline,
  aiKey,
  applyRestrictions,
  defaultAi,
  effectiveTeams,
  hexToRgb,
  initialParticipants,
  makeAiParticipant,
  PALETTE,
  RANDOM_SIDE,
  resolveAi,
  resolveRandomSides,
  rgbToHex,
  sanitizeColors,
  setParticipantTeam,
  toBattleConfig,
} from "./participants";

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

/**
 * The game's option list, for a caller about to build a `BattleConfig` but with
 * no loaded schema to hand. Reads through the same session cache
 * `useUnitsyncGameInfo` fills, so a screen that already showed the game's
 * options pays nothing, and awaiting it is safe where waiting a render for a
 * hook to settle is not.
 *
 * Answers `[]` rather than throwing. A game unitsync cannot read is one the
 * engine is about to refuse anyway, and a launch without the game's defaults
 * beats no launch at all.
 */
export async function gameOptionSchema(
  target: PlayTarget | null | undefined,
  gameArchive: string | undefined,
): Promise<ConfigOption[]> {
  if (!target || !gameArchive) return [];
  try {
    const info = await primeGameInfo(
      target.enginePath,
      target.dataDir,
      gameArchive,
    );
    return info.options;
  } catch {
    return [];
  }
}

/**
 * The map's own option list, for a caller about to build a `BattleConfig`. The
 * map-side twin of {@link gameOptionSchema}, reading through the same session
 * cache `useUnitsyncMapInfo` fills and answering `[]` rather than throwing.
 *
 * Fetched at launch rather than read off a hook, because a hook still holds the
 * previous map's options for a render after the map changes, and a launch that
 * lands a render early would write the wrong map's block.
 */
export async function mapOptionSchema(
  target: PlayTarget | null | undefined,
  mapName: string | undefined,
): Promise<ConfigOption[]> {
  if (!target || !mapName) return [];
  try {
    const info = await primeMapInfo(target.enginePath, target.dataDir, mapName);
    return info.options;
  } catch {
    return [];
  }
}

/**
 * Whether the play modes that generate their own content (Conquest, Warpath)
 * have what they need to run: a preferred engine, and at least one installed
 * game (a unitsync question, not a file count — rapid installs live in
 * packages/pool rather than as an archive in games/). This is the single
 * source of truth `ConquestListPage`, `RunListPage` and the sidebar nav badge
 * (issue #419) all read, so the empty-state guidance and the nav marker never
 * disagree.
 *
 * `loading` covers both "resolving the preferred engine" and "engine resolved,
 * scan not back yet" so callers can hold off rendering a verdict until the
 * first scan settles, avoiding a flash of "needs a game" before it's known.
 */
export function usePlayReadiness(): {
  ready: boolean;
  loading: boolean;
  target: PlayTarget | null;
  hasGames: boolean;
} {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const scanResolved = scan.data != null;
  // Coilbox's own generated games do not count. A player whose only game is the
  // one the unit builder wrote has nothing to play, and every empty state that
  // reads this says so.
  const hasGames = withoutGeneratedGames(scan.data?.games ?? []).length > 0;
  const needsGame = !target || (scanResolved && !hasGames);
  const loading = targetLoading || (!!target && !scanResolved);
  return { ready: !needsGame, loading, target, hasGames };
}

/** A resolved replay launch target plus whether its engine exactly matches the
 * version the demo was recorded on. */
export interface ReplayTarget {
  target: PlayTarget;
  matched: boolean;
}

/**
 * The target to watch a replay with, for a demo's recorded engine version.
 *
 * A demo replays cleanly only under its recording engine version, so an engine
 * whose label (`syncVersion ?? version`) matches `demoVersion` wins
 * (`compareEngineVersions` keys off the dotted release + commit count and ignores
 * the trailing branch label like `BAR105`). With no exact match it falls back to
 * the preferred engine — surfaced as `matched: false` so the UI can warn. Returns
 * `null` when no engine is installed at all.
 */
export function useReplayTarget(demoVersion: string): {
  resolved: ReplayTarget | null;
  loading: boolean;
} {
  const { state, loading } = useContentState();
  const roots = state?.roots ?? [];
  const engines = roots.flatMap((r) =>
    r.engines.map((e) => ({ id: e.id, version: e.syncVersion ?? e.version })),
  );
  const { resolvedId } = usePreferredEngine(engines);

  const build = (
    rootPath: string,
    e: (typeof roots)[number]["engines"][number],
  ): PlayTarget => ({
    enginePath: e.path,
    executable: e.executable,
    dataDir: rootPath,
    engineVersion: e.syncVersion ?? e.version,
  });

  // Exact version match wins.
  for (const r of roots) {
    for (const e of r.engines) {
      if (
        compareEngineVersions(demoVersion, e.syncVersion ?? e.version) === 0
      ) {
        return {
          resolved: { target: build(r.path, e), matched: true },
          loading,
        };
      }
    }
  }
  // Fallback: preferred engine, else the first engine in any root.
  for (const r of roots) {
    const e = r.engines.find((en) => en.id === resolvedId);
    if (e)
      return {
        resolved: { target: build(r.path, e), matched: false },
        loading,
      };
  }
  const first = roots.find((r) => r.engines.length > 0);
  if (first) {
    return {
      resolved: { target: build(first.path, first.engines[0]), matched: false },
      loading,
    };
  }
  return { resolved: null, loading };
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
  // The key whose AI list `ais` currently holds, set once the query settles
  // (cache hit or fetch resolved). Lets callers tell "still loading" (an empty
  // list that hasn't settled) from "genuinely no AIs" (settled but empty), so a
  // reconciliation never runs against a premature list. Null until the first
  // settle, or when there is no target.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const key =
    enginePath && dataDir
      ? `${dataDir}::${enginePath}::${gameArchive ?? ""}`
      : null;

  useEffect(() => {
    if (!enginePath || !dataDir) {
      setAis([]);
      setLoadedKey(null);
      return;
    }
    const k = `${dataDir}::${enginePath}::${gameArchive ?? ""}`;
    const cached = skirmishAiCache.get(k);
    if (cached) {
      setAis(cached.ais);
      setLoadedKey(k);
      return;
    }
    let cancelled = false;
    setLoading(true);
    unitsyncSkirmishAis({ enginePath, dataDir, gameArchive })
      .then((res) => {
        if (cancelled) return;
        skirmishAiCache.set(k, res);
        setAis(res.ais);
      })
      .catch(() => {
        if (!cancelled) setAis([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadedKey(k);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enginePath, dataDir, gameArchive]);

  // `ais` matches the current key only once this key has settled. During a key
  // change `loadedKey` still points at the previous key, so `loaded` is false
  // until the new query settles.
  const loaded = key != null && loadedKey === key;

  return { ais, loading, loaded };
}

/**
 * Remember the last AI the user picked so new opponents default to it. Stored as
 * an `aiKey` string; empty means "nothing picked yet".
 */
export function useLastAi() {
  return useSetting<string>("play.lastAi", "");
}
