import { useCallback, useState } from "react";
import {
  contentDemoInfo,
  contentListReplays,
  type ReplayFile,
} from "../content/bindings";
import { useBrandingEntry } from "../content/branding";
import { useUnitsyncScan } from "../content/config";
import { useReplayUserState } from "../content/replayUserState";
import type { BattleConfig } from "../play/bindings";
import type { PlayTarget } from "../play/config";
import {
  toBattleConfig,
  usePreferredTarget,
  useSkirmishAis,
} from "../play/config";
import {
  type DetectedResult,
  diffNewReplays,
  engineFailureMessage,
  pickNewestReplay,
  resultFromDemoInfo,
} from "../play/detect";
import type { SkirmishDraft } from "../play/drafts";
import { mergeGameAi } from "../play/gameAi";
import { usePlay } from "../play/PlayProvider";
import { getProfile } from "../profile/profile";
import { useConquestState } from "./conquests";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "./model";
import { resolveGameByShortname } from "./model";
import { advanceAfterBattle } from "./rules";
import { synthesizeBattle } from "./synthesize";

/* -------------------------------------------------------------------------- *
 * The conquest battle hook — mirrors `campaign/run.ts` (`useMissionRun`):
 * install check, launch, automatic result detection from the replay, and the
 * manual result flow as its fallback. On a resolved outcome the full strategic
 * pipeline runs in one tested call (`advanceAfterBattle`: ownership → expiry →
 * enemy phase → status) and the state file is saved.
 * -------------------------------------------------------------------------- */

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the content root for a replay that appeared after the snapshot (the
 * filesystem flush can lag briefly behind the engine exiting). */
async function findNewReplay(
  dataDir: string,
  beforePaths: ReadonlySet<string>,
): Promise<ReplayFile | null> {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    const { replays } = await contentListReplays({ root: dataDir });
    const newest = pickNewestReplay(diffNewReplays(beforePaths, replays));
    if (newest) return newest;
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }
  return null;
}

/** Decode the new replay and read off the player's result; every failure mode
 * resolves to `"ambiguous"` so the caller falls back to the manual prompt. The
 * replay itself (when found) is returned alongside so the caller can tag it
 * with provenance at exactly the moment its filename becomes known. */
async function detectBattleResult(opts: {
  target: PlayTarget;
  beforePaths: ReadonlySet<string>;
  playerName: string;
}): Promise<{ outcome: DetectedResult; replay: ReplayFile | null }> {
  const { target, beforePaths, playerName } = opts;
  try {
    const replay = await findNewReplay(target.dataDir, beforePaths);
    if (!replay) return { outcome: "ambiguous", replay: null };
    const { info } = await contentDemoInfo({
      enginePath: target.enginePath,
      replayPath: replay.path,
    });
    return { outcome: resultFromDemoInfo(info, playerName), replay };
  } catch {
    return { outcome: "ambiguous", replay: null };
  }
}

/** Phases of the battle screen, matching the campaign flow:
 *   briefing → (launch) → checking → result → victory | defeat
 * A cancelled launch returns to `briefing` — the turn is not consumed. */
export type BattleRunPhase =
  | "briefing"
  | "checking"
  | "result"
  | "victory"
  | "defeat";

/** What the battle needs installed before it can launch. The game resolves by
 * shortname (newest installed version); the map is an exact-name match. */
export interface BattleRequirement {
  kind: "game" | "map";
  name: string;
}

/** The player participant's display name in synthesized battles. */
const PLAYER_NAME = "You";

/**
 * Drive one strategic battle: resolve the launch target and the galaxy's game
 * (newest installed version of its shortname), synthesize the skirmish for
 * the contested node, launch, detect the outcome from the replay (manual
 * prompt on ambiguity), then advance the conquest state through the full
 * post-battle pipeline and persist it.
 */
export function useConquestBattleRun(
  galaxy: GalaxyDoc,
  state: ConquestState | undefined,
  node: GalaxyNode | undefined,
  mode: "attack" | "defend",
) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const { saveFor } = useConquestState();
  const { setProvenance } = useReplayUserState();

  const [phase, setPhase] = useState<BattleRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  // The state as it was AFTER the battle resolved (for the result screens —
  // the hook's `state` prop refreshes underneath once saved).
  const [resolved, setResolved] = useState<ConquestState | null>(null);
  // The exact draft last launched, so saving a preset from the *outcome* screen
  // captures the fight as fought — the conquest advances ownership on resolve, so a
  // fresh `snapshot()` would describe the node's next (possibly neutral) matchup.
  const [lastSnapshot, setLastSnapshot] = useState<SkirmishDraft | null>(null);

  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const scanReady = !!scan.data;

  const installedGame = resolveGameByShortname(galaxy.game, games);
  const mapName = node?.battle.mapName ?? "";
  const missing: BattleRequirement | null = !scanReady
    ? null
    : !installedGame
      ? { kind: "game", name: galaxy.game.pinnedName ?? galaxy.game.shortname }
      : !maps.some((m) => m.name === mapName)
        ? { kind: "map", name: mapName }
        : null;

  const { ais } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  // The game's AI catalogue: the branding entry's, with any profile override on
  // top. Called unconditionally, since useBrandingEntry accepts undefined.
  const brandingAi = useBrandingEntry(installedGame)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target &&
    scanReady &&
    !missing &&
    !running &&
    !scan.loading &&
    !!state &&
    !!node &&
    state.status === "active" &&
    ais.length > 0;

  /** Advance the conquest through the resolved battle and persist. Shared by
   * the manual buttons and automatic detection. */
  const applyResult = useCallback(
    async (outcome: "victory" | "defeat", auto: boolean) => {
      if (!state || !node) return;
      setSaving(true);
      setError(null);
      try {
        const next = advanceAfterBattle(galaxy, state, node.id, mode, outcome);
        await saveFor(galaxy.id, next);
        setResolved(next);
        setAutoDetected(auto);
        setPhase(outcome);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // Never strand the player on "checking": fall back to the manual
        // prompt, which shows this error and offers the buttons again.
        setPhase("result");
      } finally {
        setSaving(false);
      }
    },
    [galaxy, state, node, mode, saveFor],
  );

  // The node battle as a launchable skirmish snapshot: the synthesized roster plus
  // the node's disabled-unit restrictions, so "Save as preset" and the live launch
  // below capture exactly the same fight. Conquest has no per-team perks.
  const snapshot = useCallback((): SkirmishDraft | null => {
    if (!state || !node || !installedGame) return null;
    const draft = synthesizeBattle(galaxy, state, node.id, mode, {
      playerName: PLAYER_NAME,
      gameName: installedGame.name,
      ais,
      aiConfig,
    });
    if (!draft) return null;
    const disabledUnits = node.battle.disabledUnits;
    return disabledUnits && disabledUnits.length > 0
      ? { ...draft, restrictions: { disabledUnits } }
      : draft;
  }, [galaxy, state, node, mode, installedGame, ais, aiConfig]);

  const start = useCallback(async () => {
    if (!target || !state || !node || !installedGame) return;
    const draft = snapshot();
    if (!draft) return;
    setLastSnapshot(draft);
    const config: BattleConfig = toBattleConfig({
      participants: draft.participants,
      mapName: draft.mapName,
      gameType: draft.gameName,
      startPosType: draft.startPosType,
      modOptions: draft.modOptionValues,
      disabledUnits: draft.restrictions?.disabledUnits,
    });
    setError(null);
    // Snapshot the replays that exist before the engine runs; a failure here
    // only disables detection, never the launch.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const res = await launch("conquest", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      // Cancelled before the game started: no turn consumed, no detection.
      if (res.exitCode === null) return;
      const exitCode = res.exitCode;
      if (beforePaths === null) {
        // No baseline to detect a replay against, so a nonzero exit is read
        // the same way as "no replay found" below.
        const failure = engineFailureMessage(exitCode, false);
        if (failure) {
          setError(failure);
          return;
        }
        setPhase("result");
        return;
      }
      setPhase("checking");
      const { outcome, replay } = await detectBattleResult({
        target,
        beforePaths,
        playerName: PLAYER_NAME,
      }).catch((): { outcome: DetectedResult; replay: null } => ({
        outcome: "ambiguous",
        replay: null,
      }));
      // Tag the replay with where it came from the moment its filename is
      // known — regardless of whether the outcome itself was readable.
      if (replay) {
        setProvenance(replay.filename, {
          mode: "conquest",
          galaxyId: galaxy.id,
          nodeId: node.id,
        });
      }
      // A nonzero exit with no new replay is stronger than either signal
      // alone: the engine died before anything was recorded, so this says so
      // directly rather than asking the player to guess how the battle ended.
      // A nonzero exit alongside a replay is left to detection below, since
      // the engine can exit nonzero after a completed battle, and that
      // replay is real evidence not to discard.
      const failure = engineFailureMessage(exitCode, replay !== null);
      if (failure) {
        setError(failure);
        setPhase("briefing");
        return;
      }
      if (outcome === "ambiguous") {
        setPhase("result");
      } else {
        await applyResult(outcome, true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    target,
    state,
    node,
    installedGame,
    snapshot,
    launch,
    applyResult,
    galaxy.id,
    setProvenance,
  ]);

  const recordVictory = useCallback(
    () => applyResult("victory", false),
    [applyResult],
  );
  const recordDefeat = useCallback(
    () => applyResult("defeat", false),
    [applyResult],
  );

  return {
    phase,
    error,
    canStart,
    missing,
    noEngine,
    scanLoading,
    running,
    saving,
    autoDetected,
    resolved,
    installedGame,
    ais,
    start,
    snapshot,
    lastSnapshot,
    recordVictory,
    recordDefeat,
    /** Force a rescan so a just-installed game/map clears `missing`. */
    recheck: () => scan.run(true),
  };
}
