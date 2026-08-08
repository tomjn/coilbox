import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    // matchStats.ts's private sideLabel names ally team 0 "Team 1 (won)" and
    // ally team 1 "Team 2". This has to produce the same "Team N" stem, or the
    // off-by-one this file exists to fix (#1209) is back.
    expect(teamLabel(0)).toBe("Team 1");
    expect(teamLabel(1)).toBe("Team 2");
    expect(teamLabel(4)).toBe("Team 5");
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

/**
 * Issue #1209 was two working pieces of code, each correct on its own, that
 * happened to number a side differently. `teamLabel` and `teamResultLabel`
 * fix the numbering, but nothing stops a future edit from reverting one call
 * site on replay detail back to its own hardcoded string while leaving the
 * others reading through the shared functions, the exact shape of the
 * original bug. Neither page has a component test (none in this codebase
 * do), so this reads their source instead, the same way `tertiaryText.test.ts`
 * guards against a deleted CSS tier coming back.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROSTER = readFileSync(`${HERE}pages/ReplayDetailPage.tsx`, "utf8");
const STATS_SECTION = readFileSync(
  `${HERE}pages/components/MatchStatsSection.tsx`,
  "utf8",
);

describe("every side-naming site on replay detail agrees with the chart", () => {
  it("the roster heading and start-box title don't hardcode zero-based 'Ally team N'", () => {
    expect(ROSTER).not.toMatch(/`Ally team \$\{/);
  });

  it("the start-box caption doesn't say 'ally team' where the roster says 'Team'", () => {
    expect(ROSTER).not.toMatch(/Start boxes per ally team/);
  });

  it("the start-box number badge counts from one, like the roster next to it", () => {
    expect(ROSTER).toMatch(/\{a\.id \+ 1\}/);
  });

  it("the roster heading and start-box title call teamLabel", () => {
    // Loose on purpose (just "is it called at all"): the numbering itself is
    // covered above and in the teamLabel/teamResultLabel suites, this only
    // guards against the call disappearing entirely.
    expect(ROSTER.match(/teamLabel\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the Details table's Result row reads through teamResultLabel, not matchStats.ts's zero-based resultLabel", () => {
    expect(ROSTER).toMatch(/\bteamResultLabel\(/);
    expect(ROSTER).not.toMatch(/\bresultLabel\(/);
  });

  it("the headline Result tile reads through teamResultLabel too", () => {
    expect(STATS_SECTION).toMatch(/\bteamResultLabel\(/);
    expect(STATS_SECTION).not.toMatch(/\bresultLabel\(/);
  });
});
