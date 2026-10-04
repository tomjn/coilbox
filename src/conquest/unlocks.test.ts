import { describe, expect, it } from "vitest";
import { generateGalaxy } from "./generate";
import { newConquestState } from "./model";
import { MAX_THREAT_LEVEL } from "./threat";
import {
  type FinishedConquest,
  finishedConquest,
  foldFinishedConquest,
  levelChoices,
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
