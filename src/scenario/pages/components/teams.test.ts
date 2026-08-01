import { describe, expect, it } from "vitest";
import type { Participant } from "@/play/participants";
import { newScenario } from "../../create";
import { parseScenario, type Scenario } from "../../model";
import {
  addStartUnit,
  clampAmount,
  clampStartCount,
  engineStarts,
  everyStartSuppressed,
  MAX_AMOUNT,
  MAX_START_UNITS,
  removeStartUnit,
  setStartUnitCount,
  setTeamAmount,
  setTeamNoCommander,
  startsSummary,
  startsWarning,
  startUnitDefs,
  startUnits,
  startUnitTotal,
  teamOf,
} from "./teams";

function participant(id: string, over: Partial<Participant> = {}): Participant {
  return {
    id,
    kind: "ai",
    name: id,
    side: "",
    color: [1, 1, 1],
    allyTeam: 0,
    spectator: false,
    ...over,
  } as Participant;
}

/** A scenario with the named participants and nothing else set. */
function base(ids: string[], over: Partial<Participant>[] = []): Scenario {
  const scenario = newScenario("Test");
  return {
    ...scenario,
    setup: {
      ...scenario.setup,
      participants: ids.map((id, i) => participant(id, over[i] ?? {})),
    },
  };
}

describe("start units", () => {
  it("counts a flat def list by def, in first-appearance order", () => {
    expect(startUnits({ startUnits: ["ak", "lifter", "ak", "ak"] })).toEqual([
      { def: "ak", count: 3 },
      { def: "lifter", count: 1 },
    ]);
  });

  it("adds one of a def, and one more of a def already there", () => {
    let s = base(["player"]);
    s = addStartUnit(s, "player", "ak");
    s = addStartUnit(s, "player", "lifter");
    s = addStartUnit(s, "player", "ak");
    expect(s.teams.player.startUnits).toEqual(["ak", "ak", "lifter"]);
  });

  it("ignores a blank def", () => {
    const s = base(["player"]);
    expect(addStartUnit(s, "player", "   ")).toBe(s);
  });

  it("expands a count into that many defs", () => {
    let s = addStartUnit(base(["player"]), "player", "ak");
    s = setStartUnitCount(s, "player", "ak", 3);
    expect(s.teams.player.startUnits).toEqual(["ak", "ak", "ak"]);
    expect(startUnitTotal(s.teams.player)).toBe(3);
  });

  it("caps a count and refuses to add past the cap", () => {
    let s = addStartUnit(base(["player"]), "player", "ak");
    s = setStartUnitCount(s, "player", "ak", 9999);
    expect(s.teams.player.startUnits).toHaveLength(MAX_START_UNITS);
    expect(addStartUnit(s, "player", "ak")).toBe(s);
    expect(clampStartCount(0)).toBe(1);
    expect(clampStartCount(Number.NaN)).toBe(1);
  });

  it("takes a def off at a count of zero, and the entry with the last def", () => {
    let s = addStartUnit(base(["player"]), "player", "ak");
    s = addStartUnit(s, "player", "lifter");
    s = setStartUnitCount(s, "player", "ak", 0);
    expect(s.teams.player.startUnits).toEqual(["lifter"]);
    s = removeStartUnit(s, "player", "lifter");
    expect(s.teams).toEqual({});
  });

  /**
   * A start unit has no position, so it is not a placement and nothing that
   * reads defs off the map sees it. Changing the game has to.
   */
  it("reports every def any team starts with, once each", () => {
    let s = base(["player", "enemy"]);
    s = addStartUnit(s, "player", "ak");
    s = addStartUnit(s, "player", "ak");
    s = addStartUnit(s, "player", "lifter");
    s = addStartUnit(s, "enemy", "ak");
    expect(startUnitDefs(s).sort()).toEqual(["ak", "lifter"]);
    expect(startUnitDefs(base(["player"]))).toEqual([]);
  });

  it("leaves the document alone for a def the team does not have", () => {
    const s = addStartUnit(base(["player"]), "player", "ak");
    expect(setStartUnitCount(s, "player", "lifter", 4)).toBe(s);
  });
});

describe("resources and income", () => {
  it("sets and clears one number at a time", () => {
    let s = setTeamAmount(
      base(["player"]),
      "player",
      "resources",
      "metal",
      750,
    );
    expect(s.teams.player.resources).toEqual({ metal: 750 });
    s = setTeamAmount(s, "player", "resources", "energy", 500);
    expect(s.teams.player.resources).toEqual({ metal: 750, energy: 500 });
    s = setTeamAmount(s, "player", "resources", "metal", null);
    expect(s.teams.player.resources).toEqual({ energy: 500 });
    s = setTeamAmount(s, "player", "resources", "energy", null);
    expect(s.teams).toEqual({});
  });

  it("keeps a deliberate zero, which is not the same as unset", () => {
    const s = setTeamAmount(base(["player"]), "player", "income", "metal", 0);
    expect(s.teams.player.income).toEqual({ metal: 0 });
  });

  it("holds an amount to a number the engine can carry", () => {
    const s = setTeamAmount(base(["player"]), "player", "income", "energy", -5);
    expect(s.teams.player.income).toEqual({ energy: 0 });
    expect(clampAmount(1e12)).toBe(MAX_AMOUNT);
    expect(clampAmount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampAmount(12.6)).toBe(13);
  });

  it("keeps resources and income apart", () => {
    let s = setTeamAmount(base(["player"]), "player", "resources", "metal", 10);
    s = setTeamAmount(s, "player", "income", "metal", 2);
    expect(s.teams.player).toEqual({
      resources: { metal: 10 },
      income: { metal: 2 },
    });
  });
});

describe("noCommander", () => {
  it("writes true and takes the whole entry away again", () => {
    const empty = base(["player"]);
    const s = setTeamNoCommander(empty, "player", true);
    expect(s.teams.player).toEqual({ noCommander: true });
    expect(setTeamNoCommander(s, "player", false).teams).toEqual({});
  });

  it("leaves the rest of an entry alone when it is turned off", () => {
    let s = setTeamAmount(base(["player"]), "player", "resources", "metal", 5);
    s = setTeamNoCommander(s, "player", true);
    s = setTeamNoCommander(s, "player", false);
    expect(s.teams.player).toEqual({ resources: { metal: 5 } });
  });

  it("hands the document back when nothing changes", () => {
    const s = base(["player"]);
    expect(setTeamNoCommander(s, "player", false)).toBe(s);
  });
});

describe("what the game is asked", () => {
  it("reports one engine team per slot, suppressed or not", () => {
    const s = setTeamNoCommander(base(["player", "enemy"]), "player", true);
    expect(engineStarts(s)).toEqual([
      { team: 0, suppressed: true },
      { team: 1, suppressed: false },
    ]);
    expect(everyStartSuppressed(s)).toBe(false);
  });

  it("is true only once every engine team is owned", () => {
    let s = setTeamNoCommander(base(["player", "enemy"]), "player", true);
    s = setTeamNoCommander(s, "enemy", true);
    expect(everyStartSuppressed(s)).toBe(true);
    expect(startsWarning(s)).toBeNull();
  });

  /**
   * Two participants on one slot share one engine team, and the runtime keys
   * `noCommander` by engine team, so one of the two marking it suppresses that
   * team's start for both.
   */
  it("counts a shared team slot once", () => {
    const shared = base(
      ["player", "mate", "enemy"],
      [{ team: 0 }, { team: 0 }, { team: 1 }],
    );
    let s = setTeamNoCommander(shared, "player", true);
    expect(engineStarts(s)).toEqual([
      { team: 0, suppressed: true },
      { team: 1, suppressed: false },
    ]);
    s = setTeamNoCommander(s, "enemy", true);
    expect(everyStartSuppressed(s)).toBe(true);
  });

  it("ignores a spectating player, who has no start to suppress", () => {
    const s = base(["player", "enemy"], [{ kind: "you", spectator: true }, {}]);
    expect(engineStarts(s)).toEqual([{ team: 0, suppressed: false }]);
    expect(everyStartSuppressed(setTeamNoCommander(s, "enemy", true))).toBe(
      true,
    );
  });

  it("is false when the setup has no engine teams at all", () => {
    const s = base([]);
    expect(everyStartSuppressed(s)).toBe(false);
    expect(startsWarning(s)).toBeNull();
  });

  it("warns about a partly suppressed setup and nothing else", () => {
    const none = base(["player", "enemy"]);
    expect(startsWarning(none)).toBeNull();
    const some = setTeamNoCommander(none, "player", true);
    expect(startsWarning(some)).toContain("1 of 2 teams");
    const all = setTeamNoCommander(some, "enemy", true);
    expect(startsWarning(all)).toBeNull();
  });
});

describe("reading and summarising", () => {
  it("reads an unset participant as an empty entry", () => {
    expect(teamOf(base(["player"]), "player")).toEqual({});
  });

  it("says the game's own start when nothing is set", () => {
    expect(startsSummary(base(["player"]))).toBe("The game's own start");
  });

  it("counts what is set across every participant", () => {
    let s = base(["player", "enemy"]);
    s = addStartUnit(s, "player", "ak");
    s = setStartUnitCount(s, "player", "ak", 3);
    s = setTeamAmount(s, "player", "resources", "metal", 750);
    s = setTeamAmount(s, "enemy", "income", "metal", 5);
    s = setTeamNoCommander(s, "player", true);
    s = setTeamNoCommander(s, "enemy", true);
    expect(startsSummary(s)).toBe(
      "3 start units · 1 banked · 1 on income · 2 without a commander",
    );
  });
});

/**
 * The point of the issue: what the editor writes has to survive the parser and
 * reach the compiler, because a document that will not load takes the author's
 * scenario off the list.
 */
describe("what is written loads again", () => {
  it("round-trips every field through parseScenario", () => {
    let s = base(["player", "enemy"]);
    s = addStartUnit(s, "player", "ak");
    s = setStartUnitCount(s, "player", "ak", 3);
    s = addStartUnit(s, "player", "lifter");
    s = setTeamAmount(s, "player", "resources", "metal", 750);
    s = setTeamAmount(s, "player", "resources", "energy", 750);
    s = setTeamAmount(s, "enemy", "income", "metal", 4);
    s = setTeamAmount(s, "enemy", "income", "energy", 6);
    s = setTeamNoCommander(s, "player", true);
    s = setTeamNoCommander(s, "enemy", true);

    const reloaded = parseScenario(JSON.parse(JSON.stringify(s)));
    expect(reloaded).not.toBeNull();
    expect(reloaded?.teams).toEqual(s.teams);
  });
});
