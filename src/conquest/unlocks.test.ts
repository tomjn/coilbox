import { describe, expect, it } from "vitest";
import { generateGalaxy } from "./generate";
import { newConquestState } from "./model";
import { maxUnlockedNodeCount } from "./size";
import { MAX_THREAT_LEVEL } from "./threat";
import {
  type FinishedConquest,
  finishedConquest,
  foldFinishedConquest,
  levelChoices,
  sizeOptions,
  startPositionRequirement,
  startPositionUnlocked,
  unlockedLevel,
} from "./unlocks";

const run = (over: Partial<FinishedConquest> = {}): FinishedConquest => ({
  runId: "g1:1",
  game: "tg",
  won: true,
  level: 0,
  ...over,
});

describe("foldFinishedConquest", () => {
  it("starts a game at level 0 with nothing counted", () => {
    expect(unlockedLevel({}, "tg")).toBe(0);
  });

  it("unlocks one level for a win at the ceiling", () => {
    const next = foldFinishedConquest({}, run());
    expect(unlockedLevel(next, "tg")).toBe(1);
    expect(next.tg).toMatchObject({ finished: 1, won: 1 });
  });

  it("unlocks only one level at a time", () => {
    let u = foldFinishedConquest({}, run({ runId: "a" }));
    u = foldFinishedConquest(u, run({ runId: "b", level: 1 }));
    expect(unlockedLevel(u, "tg")).toBe(2);
  });

  it("unlocks nothing for a win below the ceiling", () => {
    let u = foldFinishedConquest({}, run({ runId: "a" }));
    u = foldFinishedConquest(u, run({ runId: "b", level: 0 }));
    expect(unlockedLevel(u, "tg")).toBe(1);
    expect(u.tg).toMatchObject({ finished: 2, won: 2 });
  });

  it("unlocks nothing for a win above the ceiling, such as a challenge at a locked level", () => {
    const u = foldFinishedConquest({}, run({ level: 2 }));
    expect(unlockedLevel(u, "tg")).toBe(0);
    expect(u.tg).toMatchObject({ finished: 1, won: 1 });
  });

  it("unlocks nothing for a loss, and counts it", () => {
    const u = foldFinishedConquest({}, run({ won: false }));
    expect(unlockedLevel(u, "tg")).toBe(0);
    expect(u.tg).toMatchObject({ finished: 1, won: 0 });
  });

  it("counts a win on an authored galaxy and never unlocks from it", () => {
    const u = foldFinishedConquest({}, run({ level: null }));
    expect(unlockedLevel(u, "tg")).toBe(0);
    expect(u.tg).toMatchObject({ finished: 1, won: 1 });
  });

  it("counts the same finished conquest once", () => {
    const once = foldFinishedConquest({}, run());
    const twice = foldFinishedConquest(once, run());
    expect(twice).toBe(once);
    expect(twice.tg).toMatchObject({ finished: 1, won: 1, threatLevel: 1 });
  });

  it("keeps the top level the top", () => {
    let u = {};
    for (let i = 0; i < MAX_THREAT_LEVEL + 3; i++) {
      u = foldFinishedConquest(
        u,
        run({ runId: `r${i}`, level: Math.min(i, MAX_THREAT_LEVEL) }),
      );
    }
    expect(unlockedLevel(u, "tg")).toBe(MAX_THREAT_LEVEL);
  });

  it("keeps each game's record apart, whatever the case of its shortname", () => {
    let u = foldFinishedConquest({}, run({ game: "TG" }));
    u = foldFinishedConquest(u, run({ runId: "x", game: "other" }));
    expect(unlockedLevel(u, "tg")).toBe(1);
    expect(unlockedLevel(u, "Tg")).toBe(1);
    expect(unlockedLevel(u, "other")).toBe(1);
    expect(Object.keys(u).sort()).toEqual(["other", "tg"]);
  });
});

describe("levelChoices", () => {
  it("offers level 0 alone, with level 1 locked, to a new player", () => {
    expect(levelChoices(0)).toEqual({
      unlocked: [0],
      locked: { level: 1, requirement: "Win a conquest" },
    });
  });

  it("offers every unlocked level and names what unlocks the next", () => {
    expect(levelChoices(2)).toEqual({
      unlocked: [0, 1, 2],
      locked: { level: 3, requirement: "Win a conquest at level 2" },
    });
  });

  it("has nothing locked at the top", () => {
    const c = levelChoices(MAX_THREAT_LEVEL);
    expect(c.locked).toBeNull();
    expect(c.unlocked).toHaveLength(MAX_THREAT_LEVEL + 1);
  });
});

describe("finishedConquest", () => {
  const galaxy = generateGalaxy(
    {
      seed: 5,
      game: { shortname: "TG" },
      maps: [{ name: "M", width: 4, height: 4 }],
      nodeCount: 10,
      factionCount: 1,
      threatLevel: 2,
    },
    "t0",
  );
  const active = newConquestState(galaxy, { seed: 9 }, "t0");

  it("is null while the run is going", () => {
    expect(finishedConquest(galaxy, active)).toBeNull();
  });

  it("keys a finished run by galaxy and state seed and carries the galaxy's level", () => {
    expect(finishedConquest(galaxy, { ...active, status: "won" })).toEqual({
      runId: `${galaxy.id}:9`,
      game: "tg",
      won: true,
      level: 2,
    });
    expect(finishedConquest(galaxy, { ...active, status: "lost" })?.won).toBe(
      false,
    );
  });

  it("reads a galaxy saved before levels existed as level 0", () => {
    const old = {
      ...galaxy,
      generated: galaxy.generated && {
        ...galaxy.generated,
        threatLevel: undefined,
      },
    };
    expect(finishedConquest(old, { ...active, status: "won" })?.level).toBe(0);
  });

  it("gives an authored galaxy no level, so it can never unlock", () => {
    const authored = { ...galaxy, generated: undefined };
    expect(
      finishedConquest(authored, { ...active, status: "won" })?.level,
    ).toBe(null);
  });
});

describe("size choices (issue #3433)", () => {
  it("offers the 80 and under sizes to everyone and locks the next one, naming what unlocks it", () => {
    const options = sizeOptions(0);
    expect(options.filter((o) => !o.disabled).map((o) => o.value)).toEqual([
      "12",
      "18",
      "28",
      "40",
      "56",
      "80",
    ]);
    const locked = options.filter((o) => o.disabled);
    expect(locked.map((o) => o.value)).toEqual(["120"]);
    expect(locked[0].description).toBe("Locked. Win a conquest at level 1.");
  });

  it("unlocks 120 at threat level 2 and 160 at threat level 3, the levels they are tied to", () => {
    const at2 = sizeOptions(2);
    expect(at2.filter((o) => !o.disabled).map((o) => o.value)).toContain("120");
    expect(at2.find((o) => o.value === "160")?.disabled).toBe(true);
    expect(at2.find((o) => o.value === "160")?.description).toBe(
      "Locked. Win a conquest at level 2.",
    );
    const at3 = sizeOptions(MAX_THREAT_LEVEL);
    expect(at3.every((o) => !o.disabled)).toBe(true);
    expect(at3.map((o) => o.value).slice(-2)).toEqual(["120", "160"]);
  });

  it("never locks a size that was on offer before", () => {
    const open = sizeOptions(0)
      .filter((o) => !o.disabled)
      .map((o) => Number(o.value));
    expect(open).toEqual([12, 18, 28, 40, 56, 80]);
  });

  it("caps what a game may build at its largest unlocked size", () => {
    expect(maxUnlockedNodeCount(0)).toBe(80);
    expect(maxUnlockedNodeCount(1)).toBe(80);
    expect(maxUnlockedNodeCount(2)).toBe(120);
    expect(maxUnlockedNodeCount(3)).toBe(160);
    expect(maxUnlockedNodeCount(99)).toBe(160);
  });
});

describe("start position unlock (issue #3432)", () => {
  it("is locked for a game with no record and names what unlocks it", () => {
    expect(startPositionUnlocked({}, "tg")).toBe(false);
    expect(startPositionRequirement()).toBe("Win a conquest");
  });

  it("opens with the first win, the same as threat level 1", () => {
    const won = foldFinishedConquest(
      {},
      { runId: "a:1", game: "tg", won: true, level: 0 },
    );
    expect(startPositionUnlocked(won, "TG")).toBe(true);
    expect(startPositionUnlocked(won, "other")).toBe(false);
  });

  it("stays locked after a loss", () => {
    const lost = foldFinishedConquest(
      {},
      { runId: "a:1", game: "tg", won: false, level: 0 },
    );
    expect(startPositionUnlocked(lost, "tg")).toBe(false);
  });
});
