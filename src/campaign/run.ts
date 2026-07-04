import { useCallback, useState } from "react";
import { useUnitsyncScan } from "../content/config";
import type { BattleConfig } from "../play/bindings";
import { toBattleConfig, usePreferredTarget } from "../play/config";
import { usePlay } from "../play/PlayProvider";
import { useCampaignProgress } from "./campaigns";
import type { Campaign, CampaignMission } from "./model";
import { applyDefeat, applyVictory, nextAvailableMission } from "./results";

/* -------------------------------------------------------------------------- *
 * The mission run hook — install check, launch, and the manual result flow.
 * Pure progress transitions live in `results.ts`.
 * -------------------------------------------------------------------------- */

/**
 * The phases the briefing page moves through. Kept here (not a separate route) so
 * the launch promise and its `exitCode` stay in the component that awaits them;
 * the panorama background is continuous across all phases.
 *   briefing → (launch) → result → victory | defeat
 * A cancelled launch (`exitCode === null`) returns to `briefing` with no prompt.
 */
export type MissionRunPhase = "briefing" | "result" | "victory" | "defeat";

/** What a mission needs installed before it can launch (exact-name match). */
export interface MissionRequirement {
  kind: "game" | "map";
  name: string;
}

/**
 * Drive one mission's play flow: resolve the launch target, check the mission's
 * game+map are installed, launch through {@link usePlay}, then run the manual
 * Victory/Defeat result flow and persist progress. Automatic result detection is
 * a later phase — for now the player reports the outcome.
 */
export function useMissionRun(campaign: Campaign, mission: CampaignMission) {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { running, launch } = usePlay();
  const { progress, save } = useCampaignProgress();

  const [phase, setPhase] = useState<MissionRunPhase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const snapshot = mission.snapshot;
  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const scanReady = !!scan.data;

  // Exact-name install check (no version substitution): the mission plays the
  // game+map it was authored against, or not at all.
  const missing: MissionRequirement | null = !scanReady
    ? null
    : !games.some((g) => g.name === snapshot.gameName)
      ? { kind: "game", name: snapshot.gameName }
      : !maps.some((m) => m.name === snapshot.mapName)
        ? { kind: "map", name: snapshot.mapName }
        : null;

  const noEngine = !targetLoading && !target;
  const scanLoading = !!target && !scanReady && scan.loading;
  const canStart =
    !!target && scanReady && !missing && !running && !scan.loading;

  const start = useCallback(async () => {
    if (!target) return;
    const game = games.find((g) => g.name === snapshot.gameName);
    const map = maps.find((m) => m.name === snapshot.mapName);
    if (!game || !map) return;
    // Build the engine config exactly as the skirmish launcher does, from the
    // snapshot's five draft fields, plus the mission's disabled-unit list. The
    // snapshot already holds only the options the author set, so they pass
    // straight through (see the run.ts note in the page).
    const config: BattleConfig = toBattleConfig({
      participants: snapshot.participants,
      mapName: map.name,
      gameType: game.name,
      startPosType: snapshot.startPosType,
      modOptions: snapshot.modOptionValues,
      disabledUnits: mission.disabledUnits,
    });
    setError(null);
    try {
      const res = await launch("campaign", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      // Cancelled before the game started: no outcome to report, no progress
      // written — drop straight back to the briefing.
      if (res.exitCode === null) return;
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [target, games, maps, snapshot, mission.disabledUnits, launch]);

  const recordVictory = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await save(applyVictory(progress, campaign.id, mission.id));
      setPhase("victory");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [save, progress, campaign.id, mission.id]);

  const recordDefeat = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await save(applyDefeat(progress, campaign.id, mission.id));
      setPhase("defeat");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [save, progress, campaign.id, mission.id]);

  /** Back to the briefing (for a retry after defeat, or to launch again). */
  const reset = useCallback(() => {
    setError(null);
    setPhase("briefing");
  }, []);

  // Computed from the (now-updated) progress after a win, so the victory screen's
  // Continue button points at the right next mission — or `null` when the
  // campaign is complete.
  const nextMission = nextAvailableMission(
    campaign,
    progress.campaigns[campaign.id],
    mission.id,
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
    nextMission,
    start,
    recordVictory,
    recordDefeat,
    reset,
  };
}
