import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
    // The chart's side lines are `sideLabel(ally, info)` in matchStats.ts,
    // which is this plus " (won)". One rule, so the off-by-one #1209 fixed
    // cannot come back by one surface being edited and the other not.
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
const MATCH_STATS = readFileSync(`${HERE}matchStats.ts`, "utf8");

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

  it("the chart's own side lines are named by teamLabel", () => {
    expect(MATCH_STATS).toMatch(/from "\.\/replaySideLabel"/);
    expect(MATCH_STATS).toMatch(/\bteamLabel\(ally\)/);
  });

  it("the chart no longer prints the file's zero-based ally index", () => {
    expect(MATCH_STATS).not.toMatch(/Ally \$\{/);
  });
});

/**
 * #1211: the same numbering written out a second time is how #1209 got in, and
 * it gets in silently, because each copy has passing tests of its own. So this
 * reads every source file in `src` and fails on a second one, rather than
 * trusting the next reader of `teamLabel` to notice it exists.
 *
 * Deliberately about the rule, `Team` and one added to an index, not about the
 * words: `Team ${t.team}` in `matchStats.ts` names an engine team by its own
 * number and is not this.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "src");

/** The rule's home, and this file, which has to spell it out to look for it. */
const OWNS_THE_NUMBERING = [
  "src/content/replaySideLabel.ts",
  "src/content/replaySideLabel.test.ts",
];

/** The numbering as a template, and the same by concatenation. */
const COPIES = [/`Team \$\{[^}]*\+\s*1/, /["']Team ["']\s*\+/];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe("what to call a side is written down once", () => {
  it("no other file in src turns an ally index into its one-based name", () => {
    const offenders = sourceFiles(SRC)
      .map((f) => relative(REPO, f).split("\\").join("/"))
      .filter((rel) => !OWNS_THE_NUMBERING.includes(rel))
      .filter((rel) =>
        COPIES.some((c) => c.test(readFileSync(join(REPO, rel), "utf8"))),
      );
    expect(
      offenders,
      "call teamLabel from src/content/replaySideLabel.ts instead",
    ).toEqual([]);
  });

  it("catches a copy when there is one, so the scan is doing something", () => {
    // Built by interpolation because a plain string holding a placeholder is
    // itself a lint error. These are the shapes a second copy would arrive in.
    const dollar = "$";
    const template = `\`Team ${dollar}{side + 1}\``;
    const concatenated = '"Team " + (side + 1)';
    const engineTeam = `\`Team ${dollar}{t.team}\``;
    expect(COPIES.some((c) => c.test(template))).toBe(true);
    expect(COPIES.some((c) => c.test(concatenated))).toBe(true);
    expect(COPIES.some((c) => c.test(engineTeam))).toBe(false);
  });
});
