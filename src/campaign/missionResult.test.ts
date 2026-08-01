import { describe, expect, it } from "vitest";
import type { DemoInfo } from "../content/bindings";
import { resultFromDemoInfo } from "../play/detect";
import type { ProgressFile } from "./model";
import { applyDefeat, applyVictory } from "./results";

/**
 * What a scenario mission's replay says, and what the campaign does with it.
 *
 * The mission runtime ends a mission with `Spring.GameOver`, the call an
 * ordinary game ends with, so a scenario mission's outcome reaches the campaign
 * through the replay path a preset mission's already takes: find the replay the
 * launch wrote, decode it, read the local player's result off it, and apply the
 * same progress transition. This file pins that contract from both ends.
 *
 * The three demos below are transcriptions of real replays. Each was written by
 * spring-headless running the mission runtime through
 * `scripts/mission-headless.sh` (engine 2026.06.06-90-gb54146d macos, map
 * AcidicQuarry 5.17, the harness's `probe` player on team 0 / ally team 0), and
 * decoded with the content plugin's demotool reader. The numbers are what that
 * reader returned, not what it ought to return.
 */

/** A decoded mission replay: the harness run, with its winners and verdict. */
function missionDemo(opts: {
  winningAllyTeams: number[];
  won?: boolean;
  spectator?: boolean;
  durationSec: number;
}): DemoInfo {
  return {
    engineVersion: "2026.06.06-90-gb54146d macos/test-integration",
    startTimeMs: 0,
    durationSec: opts.durationSec,
    wallclockSec: opts.durationSec,
    mapName: "AcidicQuarry 5.17",
    gameType: "Coilbox mission harness scratch",
    winningAllyTeams: opts.winningAllyTeams,
    winnersKnown: true,
    numAllyTeams: 2,
    allyTeams: [],
    players: [
      {
        name: "probe",
        team: 0,
        allyTeam: 0,
        side: "ARM",
        spectator: opts.spectator ?? false,
        won: opts.won,
      },
    ],
    modOptions: { coilbox_mission: "siege" },
  };
}

/** The `victory` action: the named participant's ally team is the only winner. */
const victoryDemo = missionDemo({
  winningAllyTeams: [0],
  won: true,
  durationSec: 61,
});

/** The `defeat` action: every other ally team wins, so the player's does not. */
const defeatDemo = missionDemo({
  winningAllyTeams: [1],
  won: false,
  durationSec: 5,
});

const empty: ProgressFile = { schemaVersion: 1, campaigns: {} };

describe("a scenario mission's replay", () => {
  it("reads a runtime victory as a victory", () => {
    expect(resultFromDemoInfo(victoryDemo, "probe")).toBe("victory");
  });

  it("reads a runtime defeat as a defeat", () => {
    expect(resultFromDemoInfo(defeatDemo, "probe")).toBe("defeat");
  });

  it("is ambiguous when the player launched as a spectator", () => {
    // A mission the author watches rather than plays. The runtime picks a team
    // for the mission anyway, but the replay has no result for a spectator, so
    // the manual Victory/Defeat prompt is what answers.
    const watched = missionDemo({
      winningAllyTeams: [0],
      spectator: true,
      durationSec: 61,
    });
    expect(resultFromDemoInfo(watched, "probe")).toBe("ambiguous");
  });

  it("is ambiguous when the replay does not name the launched player", () => {
    // The name detection asks about comes from the start script the engine was
    // given, so this is the shape of a mismatch rather than an expected state.
    expect(resultFromDemoInfo(victoryDemo, "someone-else")).toBe("ambiguous");
  });
});

describe("the campaign progress a scenario mission's replay writes", () => {
  it("completes the mission on a detected victory", () => {
    const outcome = resultFromDemoInfo(victoryDemo, "probe");
    expect(outcome).toBe("victory");
    const next = applyVictory(empty, "c1", "m1", "2026-08-01T00:00:00.000Z");
    expect(next.campaigns.c1.completedMissionIds).toEqual(["m1"]);
    expect(next.campaigns.c1.lastPlayedMissionId).toBe("m1");
  });

  it("leaves the mission incomplete on a detected defeat", () => {
    const outcome = resultFromDemoInfo(defeatDemo, "probe");
    expect(outcome).toBe("defeat");
    const next = applyDefeat(empty, "c1", "m1", "2026-08-01T00:00:00.000Z");
    expect(next.campaigns.c1.completedMissionIds).toEqual([]);
    expect(next.campaigns.c1.lastPlayedMissionId).toBe("m1");
  });
});
