import { describe, expect, it } from "vitest";
import type { DemoInfo } from "./bindings";
import { teamLabel, teamResultLabel } from "./replaySideLabel";

function info(over: Partial<DemoInfo> = {}): DemoInfo {
  return {
    engineVersion: "105",
    startTimeMs: 0,
    durationSec: 600,
    wallclockSec: 600,
    mapName: "Comet Catcher Remake",
    gameType: "Beyond All Reason test",
    winningAllyTeams: [],
    winnersKnown: false,
    numAllyTeams: 2,
    allyTeams: [],
    players: [],
    ais: [],
    modOptions: {},
    ...over,
  };
}

describe("teamLabel", () => {
  it("counts from one, unlike the file's own ally-team index", () => {
    expect(teamLabel(0)).toBe("Team 1");
    expect(teamLabel(1)).toBe("Team 2");
  });

  it("matches the chart's own numbering, so the two surfaces read as one match", () => {
    // matchStats.ts's private sideLabel names ally team 0 "Team 1 (won)" and
    // ally team 1 "Team 2". This must produce the same "Team N" stem, or the
    // bug this file exists to fix (#1209) is back.
    expect(teamLabel(0)).toBe("Team 1");
    expect(teamLabel(1)).toBe("Team 2");
  });
});

describe("teamResultLabel", () => {
  it("says the winner is unknown rather than calling it a draw", () => {
    expect(teamResultLabel(info({ winnersKnown: false }))).toBe("Unknown");
  });

  it("reports a game over that nobody won", () => {
    expect(teamResultLabel(info({ winnersKnown: true }))).toBe("Nobody won");
  });

  it("names every winning ally team in teamLabel's one-based numbering", () => {
    const decided = info({ winnersKnown: true, winningAllyTeams: [0, 2] });
    expect(teamResultLabel(decided)).toBe("Team 1, Team 3 won");
  });
});
