import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import type { LogEvent } from "./replayAnalysisEvents";
import {
  AWARD_KINDS,
  type Award,
  type AwardId,
  matchAwards,
  pickAwards,
} from "./replayAwards";

/** The log the logger's own tests record, which Rust reads too. */
const RECORDED: LogEvent[] = readFileSync(
  new URL(
    "../../lua/replay-logger/tests/fixtures/match.jsonl",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const unit = (
  metalCost: number,
  kind: "mex" | "tank" | "turret" | "radar" = "radar",
) =>
  ({
    name: `${kind}${metalCost}`,
    mobile: kind === "tank",
    buildOptions: [],
    stats: {
      metalCost,
      ...(kind === "mex" ? { extractsMetal: 1 } : {}),
      ...(kind === "tank" || kind === "turret" ? { weapons: [{}] } : {}),
      ...(kind === "radar" ? { radarDistance: 100 } : {}),
    },
  }) as unknown as UnitDatasetEntry;

/** A unit list in id order, with the ids the recorded log uses. */
const RECORDED_UNITS = Array.from({ length: 60 }, (_, i) => {
  const id = i + 1;
  if (id === 31) return unit(1000, "tank");
  if (id === 50) return unit(200, "mex");
  return unit(10);
});

const sides = (...allies: number[]) =>
  new Map(allies.map((ally, team) => [team, ally]));

const placesOf = (awards: Award[], id: AwardId) =>
  awards
    .find((a) => a.id === id)
    ?.places.map((p) => [p.place, p.team, p.score]);

/** A unit finished on `frame`. Definition 1 is a mex, 2 a tank, 3 a turret and
 *  4 a radar, each costing 100 times its id. */
const built = (id: number, def: number, team: number, frame = 0) => [
  { kind: "unit_created", frame, unit: id, def, team },
  { kind: "unit_finished", frame, unit: id, def, team },
];
const UNITS = [
  unit(100, "mex"),
  unit(200, "tank"),
  unit(300, "turret"),
  unit(400, "radar"),
];
const lost = (
  id: number,
  def: number,
  team: number,
  attackerTeam: number,
  frame: number,
) => ({
  kind: "unit_destroyed",
  frame,
  unit: id,
  def,
  team,
  attackerTeam,
});
const over = (frame: number, teams: Record<string, number>[] = []) => ({
  kind: "game_over",
  frame,
  teams,
});

describe("the awards of a recorded log", () => {
  it("gives each award to the team that earned it", () => {
    const { awards, unpriced } = matchAwards(
      RECORDED,
      RECORDED_UNITS,
      sides(0, 1),
    );
    expect(unpriced).toBe(0);
    expect(awards.map((a) => a.id)).toEqual([
      "economyKilled",
      "fightingKilled",
      "efficiency",
      "produced",
      "damageTaken",
      "noKill",
    ]);
    expect(placesOf(awards, "economyKilled")).toEqual([[1, 0, 200]]);
    expect(placesOf(awards, "fightingKilled")).toEqual([[1, 0, 1000]]);
    // 1200 metal destroyed over the 1234.57 the trailer says was spent. The
    // Gaia unit team 0 also destroyed counts nothing.
    expect(placesOf(awards, "efficiency")).toEqual([
      [1, 0, 1200 / 1234.5677490234375],
    ]);
    expect(placesOf(awards, "produced")).toEqual([[1, 0, 1500]]);
    expect(placesOf(awards, "damageTaken")).toEqual([[1, 1, 4100]]);
    // Team 1 never destroyed anything, and had no units from frame 1500.
    expect(placesOf(awards, "noKill")).toEqual([[1, 1, 50]]);
  });

  it("reads the events in any order, as a read grouped by kind gives them", () => {
    const grouped = AWARD_KINDS.toReversed().flatMap((kind) =>
      RECORDED.filter((e) => e.kind === kind),
    );
    expect(matchAwards(grouped, RECORDED_UNITS, sides(0, 1))).toEqual(
      matchAwards(RECORDED, RECORDED_UNITS, sides(0, 1)),
    );
  });

  it("leaves out the awards that need a cost when there is no unit list", () => {
    const { awards } = matchAwards(RECORDED, null, sides(0, 1));
    expect(awards.map((a) => a.id)).toEqual([
      "produced",
      "damageTaken",
      "noKill",
    ]);
  });
});

describe("what counts", () => {
  it("counts economy buildings and armed units and turrets apart", () => {
    const { awards } = matchAwards(
      [
        ...built(1, 2, 0),
        ...built(2, 1, 1),
        ...built(3, 2, 1),
        ...built(4, 3, 1),
        ...built(5, 4, 1),
        lost(2, 1, 1, 0, 30),
        lost(3, 2, 1, 0, 60),
        lost(4, 3, 1, 0, 90),
        lost(5, 4, 1, 0, 120),
        over(150, [{ team: 0, metalUsed: 500 }]),
      ],
      UNITS,
      sides(0, 1),
    );
    expect(placesOf(awards, "economyKilled")).toEqual([[1, 0, 100]]);
    expect(placesOf(awards, "fightingKilled")).toEqual([[1, 0, 500]]);
    expect(placesOf(awards, "efficiency")).toEqual([[1, 0, 2]]);
  });

  it("counts nothing for an ally, itself, Gaia or a unit still being built", () => {
    const { awards } = matchAwards(
      [
        ...built(1, 2, 0),
        ...built(2, 2, 1),
        ...built(3, 2, 0),
        ...built(4, 2, 3),
        { kind: "unit_created", frame: 0, unit: 5, def: 2, team: 2 },
        lost(2, 2, 1, 0, 30),
        lost(3, 2, 0, 0, 40),
        lost(4, 2, 3, 0, 50),
        lost(5, 2, 2, 0, 60),
        over(90),
      ],
      UNITS,
      // Teams 0 and 1 are allies, team 2 is against them and team 3 is Gaia.
      sides(0, 0, 1),
    );
    expect(placesOf(awards, "fightingKilled")).toBeUndefined();
  });

  it("says how many destroyed units had no cost", () => {
    const { unpriced } = matchAwards(
      [...built(1, 99, 1), lost(1, 99, 1, 0, 30), over(60)],
      UNITS,
      sides(0, 1),
    );
    expect(unpriced).toBe(1);
  });

  it("gives nothing without a game over line", () => {
    expect(
      matchAwards([...built(1, 2, 1), lost(1, 2, 1, 0, 30)], UNITS, sides(0, 1))
        .awards,
    ).toEqual([]);
  });
});

describe("places", () => {
  it("lists three, shares a place between equal scores and leaves out zero", () => {
    const { awards } = matchAwards(
      [
        ...[1, 2, 3, 4, 5, 6, 7].flatMap((id) => built(id, 2, 5)),
        // Team 0 destroys three, teams 1 and 2 one each, team 3 one, and team
        // 4 none.
        lost(1, 2, 5, 0, 30),
        lost(2, 2, 5, 0, 30),
        lost(3, 2, 5, 0, 30),
        lost(4, 2, 5, 2, 30),
        lost(5, 2, 5, 1, 30),
        lost(6, 1, 5, 3, 30),
        over(60),
      ],
      UNITS,
      sides(0, 0, 0, 0, 0, 1),
    );
    expect(placesOf(awards, "fightingKilled")).toEqual([
      [1, 0, 600],
      [2, 1, 200],
      [2, 2, 200],
    ]);
  });
});

describe("the longest time without a kill", () => {
  it("stops counting for a team with no units left", () => {
    const { awards } = matchAwards(
      [
        ...built(1, 2, 0),
        ...built(2, 2, 1),
        // Team 1 is knocked out after 10 seconds of a 100 second match.
        lost(2, 2, 1, 0, 300),
        // Its last shot lands afterwards and ends no wait.
        lost(1, 2, 0, 1, 330),
        ...built(3, 2, 0, 330),
        over(3000),
      ],
      UNITS,
      sides(0, 1),
    );
    expect(placesOf(awards, "noKill")).toEqual([[1, 0, 90]]);
  });

  it("counts a unit given away as leaving its team", () => {
    const { awards } = matchAwards(
      [
        ...built(1, 2, 0),
        ...built(2, 2, 1),
        { kind: "unit_given", frame: 150, unit: 2, def: 2, team: 0, from: 1 },
        over(600),
      ],
      UNITS,
      sides(0, 1),
    );
    expect(placesOf(awards, "noKill")).toEqual([[1, 0, 20]]);
  });
});

describe("winning everything", () => {
  const match = (damageToOther: number) =>
    matchAwards(
      [
        ...built(1, 4, 0),
        ...built(2, 1, 1),
        ...built(3, 2, 1),
        ...built(4, 4, 1),
        // Team 0 destroys an economy building and a tank in the first two
        // seconds, and team 1 a radar much later.
        lost(2, 1, 1, 0, 30),
        lost(3, 2, 1, 0, 60),
        lost(1, 4, 0, 1, 2000),
        ...built(5, 4, 0, 2000),
        over(3000, [
          { team: 0, metalUsed: 100, metalProduced: 900, damageReceived: 50 },
          {
            team: 1,
            metalUsed: 1000,
            metalProduced: 100,
            damageReceived: damageToOther,
          },
        ]),
      ],
      UNITS,
      sides(0, 1),
    ).awards;

  it("gives one more award to a team alone in first place in all six", () => {
    // Team 1 waits 2000 frames and team 0 from frame 60 to the end.
    const awards = match(10);
    expect(placesOf(awards, "noKill")).toEqual([[1, 0, 98]]);
    expect(placesOf(awards, "everything")).toEqual([[1, 0, null]]);
  });

  it("does not for a first place that is shared", () => {
    expect(placesOf(match(50), "everything")).toBeUndefined();
  });

  it("does not for a team that misses one", () => {
    expect(placesOf(match(60), "everything")).toBeUndefined();
  });
});

describe("which awards a replay shows", () => {
  const recorded: Award[] = [{ id: "produced", places: [] }];
  const analysed: Award[] = [{ id: "noKill", places: [] }];

  it("shows the recorded ones over the analysed ones", () => {
    expect(pickAwards({ recorded, analysed })).toEqual({
      source: "recorded",
      awards: recorded,
    });
  });

  it("shows the analysed ones when nothing was recorded", () => {
    expect(pickAwards({ recorded: null, analysed })?.source).toBe("analysis");
    expect(pickAwards({ recorded: [], analysed })?.source).toBe("analysis");
  });

  it("shows nothing when there are neither", () => {
    expect(pickAwards({ recorded: null, analysed: [] })).toBeNull();
  });
});
