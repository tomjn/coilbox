import { useSetting } from "@picoframe/frame";
import { useEffect, useState } from "react";
import {
  type SkirmishAi,
  type SkirmishAisResult,
  unitsyncSkirmishAis,
} from "../content/bindings";
import { useContentState, usePreferredEngine } from "../content/config";
import { compareEngineVersions } from "../content/engineVersion";

export type { Participant, Rgb } from "./participants";
// The pure participant model lives in ./participants (no hooks, no frame
// imports) so campaign/conquest logic and unit tests can use it directly;
// re-exported here so existing launcher imports keep working.
export {
  aiKey,
  defaultAi,
  hexToRgb,
  initialParticipants,
  makeAiParticipant,
  PALETTE,
  resolveAi,
  rgbToHex,
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

/**
 * Remember the last AI the user picked so new opponents default to it. Stored as
 * an `aiKey` string; empty means "nothing picked yet".
 */
export function useLastAi() {
  return useSetting<string>("play.lastAi", "");
}
