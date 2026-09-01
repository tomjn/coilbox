/**
 * Setting and clearing a difficulty range in the editor (issue #2164).
 *
 * The pickers themselves are a shadcn `Select`, which is not worth driving in a
 * DOM test. What is worth pinning is what each of them hands back, and what the
 * four edit functions do with it, because a range that survives being cleared
 * would leave every scenario an author opened asking for a runtime it does not
 * need.
 */

import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import { usesDifficulty } from "../../model";
import { editBase } from "./bases";
import { rangeWith } from "./DifficultyRangeFields";
import { editActor } from "./editing";
import { editGroup } from "./groups";
import { editTrigger } from "./triggers";

describe("rangeWith", () => {
  it("sets one bound and keeps the other", () => {
    expect(rangeWith(undefined, "atLeast", "hard")).toEqual({
      atLeast: "hard",
    });
    expect(rangeWith({ atLeast: "easy" }, "atMost", "normal")).toEqual({
      atLeast: "easy",
      atMost: "normal",
    });
  });

  it("clears one bound and keeps the range while the other stands", () => {
    expect(
      rangeWith({ atLeast: "easy", atMost: "hard" }, "atLeast", "any"),
    ).toEqual({ atLeast: undefined, atMost: "hard" });
  });

  it("hands back no range at all once neither bound is set", () => {
    expect(rangeWith({ atLeast: "hard" }, "atLeast", "any")).toBeUndefined();
    expect(rangeWith(undefined, "atMost", "any")).toBeUndefined();
  });
});

describe("a range on each thing that can carry one", () => {
  /** A scenario with one of everything, all of it at every difficulty. */
  function populated(): Scenario {
    const scenario = newScenario("Demo");
    return {
      ...scenario,
      actors: [
        {
          id: "boss",
          unitDef: "corcom",
          team: "enemy",
          pos: { x: 100, z: 100 },
          facing: 0,
        },
      ],
      groups: [
        {
          id: "wave",
          team: "enemy",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: 200, z: 200 },
          orders: [],
          dormant: true,
        },
      ],
      blueprints: [
        {
          id: "layout",
          name: "Outpost",
          buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
        },
      ],
      bases: [
        {
          id: "outpost",
          blueprint: "layout",
          team: "enemy",
          origin: { x: 300, z: 300 },
          buildings: [],
        },
      ],
      triggers: [
        {
          id: "wave-one",
          enabled: true,
          repeat: false,
          conditions: { op: "all", conditions: [] },
          actions: [],
        },
      ],
    };
  }

  const ranged = { atLeast: "hard" } as const;

  /** Each thing a range can sit on, and the edit that puts one there. */
  const carriers: [string, (s: Scenario, r?: typeof ranged) => Scenario][] = [
    ["actor", (s, r) => editActor(s, "boss", { difficulty: r })],
    ["group", (s, r) => editGroup(s, "wave", { difficulty: r })],
    ["base", (s, r) => editBase(s, "outpost", { difficulty: r })],
    ["trigger", (s, r) => editTrigger(s, "wave-one", { difficulty: r })],
  ];

  it("puts one on an actor, a group, a base and a trigger", () => {
    for (const [what, apply] of carriers) {
      expect(usesDifficulty(apply(populated(), ranged)), what).toBe(true);
    }
  });

  it("takes one off again, leaving a document that asks for nothing", () => {
    for (const [what, apply] of carriers) {
      const cleared = apply(apply(populated(), ranged), undefined);
      expect(usesDifficulty(cleared), what).toBe(false);
    }
  });
});
