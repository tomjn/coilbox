import { describe, expect, it } from "vitest";
import { encodeContainerJson } from "../container/container";
import { settleInPlace } from "./inPlaceProject";
import { setOverride } from "./overrides";
import {
  EMPTY_EDITS,
  editCounts,
  editSlot,
  type GameEdits,
  isEmptyEdits,
  MOD_PROJECT_KIND_VERSION,
  type ModProject,
  modProjectJson,
  parseGameEdits,
  parseModProjectJson,
} from "./project";
import {
  composeRelative,
  describeFollow,
  describeRelative,
  followGame,
  type RelativeRule,
  relativeResult,
  resetField,
  resetUnit,
  setRelativeEdit,
} from "./relativeEdits";

const PLUS_15: Omit<RelativeRule, "base"> = {
  factor: 1.15,
  offset: 0,
  rounding: { kind: "integer" },
};

/** armpw at 260 health with "+15%" on it, as a project saved against that
 *  game holds it. */
const tougher = (): GameEdits =>
  setRelativeEdit(EMPTY_EDITS, "armpw", "health", PLUS_15, 260);

const game = (health: unknown) => ({
  armpw: health === undefined ? { speed: 2 } : { health, speed: 2 },
});

describe("working a rule out", () => {
  it("is round(base * factor + offset)", () => {
    expect(relativeResult({ ...PLUS_15, base: 260 })).toBe(299);
    expect(
      relativeResult({
        factor: 1,
        offset: 40,
        rounding: { kind: "none" },
        base: 280,
      }),
    ).toBe(320);
    expect(
      relativeResult({
        factor: 1.1,
        offset: 0,
        rounding: { kind: "nearest", step: 5 },
        base: 47,
      }),
    ).toBe(50);
  });

  it("writes the worked-out number into overrides and the rule beside it", () => {
    const edits = tougher();
    expect(edits.overrides).toEqual({ armpw: { health: 299 } });
    expect(edits.relative).toEqual({
      armpw: { health: { ...PLUS_15, base: 260 } },
    });
  });

  it("keeps a rule whose result equals the game's value, with no override key", () => {
    const edits = setRelativeEdit(
      EMPTY_EDITS,
      "armpw",
      "health",
      { factor: 1.01, offset: 0, rounding: { kind: "integer" } },
      20,
    );
    expect(edits.overrides).toEqual({});
    expect(edits.relative?.armpw?.health?.base).toBe(20);
    // Still a change the author made, so the project is not empty.
    expect(isEmptyEdits(edits)).toBe(false);
    expect(editCounts(edits).fields).toBe(1);
  });

  it("changes nothing when the same rule is set again", () => {
    const edits = tougher();
    expect(setRelativeEdit(edits, "armpw", "health", PLUS_15, 260)).toBe(edits);
  });
});

describe("editing a field with a rule", () => {
  it("makes it fixed again when a number is typed into it", () => {
    const typed = editSlot(tougher(), "overrides", (o) =>
      setOverride(o, "armpw", "health", 350, 260),
    );
    expect(typed.overrides).toEqual({ armpw: { health: 350 } });
    expect(typed.relative ?? {}).toEqual({});
  });

  it("makes it fixed when the typed number is the game's own", () => {
    const typed = editSlot(tougher(), "overrides", (o) =>
      setOverride(o, "armpw", "health", 260, 260),
    );
    expect(typed.overrides).toEqual({});
    expect(typed.relative ?? {}).toEqual({});
  });

  it("keeps the rule when a different field is typed into", () => {
    const typed = editSlot(tougher(), "overrides", (o) =>
      setOverride(o, "armpw", "speed", 3, 2),
    );
    expect(typed.relative?.armpw?.health).toBeDefined();
  });

  it("clears both on reset, including a rule with no override key", () => {
    expect(resetField(tougher(), "armpw", "health")).toMatchObject({
      overrides: {},
      relative: {},
    });
    const equal = setRelativeEdit(
      EMPTY_EDITS,
      "armpw",
      "health",
      { factor: 1.01, offset: 0, rounding: { kind: "integer" } },
      20,
    );
    expect(resetField(equal, "armpw", "health").relative ?? {}).toEqual({});
    expect(resetUnit(equal, "armpw").relative ?? {}).toEqual({});
  });

  it("drops the rule on a field an in-place write moved into the game", () => {
    const project: ModProject = {
      id: "p1",
      name: "p",
      gameName: "BA",
      edits: tougher(),
      createdAt: "",
      updatedAt: "",
    };
    const settled = settleInPlace(
      project,
      {
        kind: "write",
        changed: true,
        carried: [{ unit: "armpw", field: "health", undoable: true }],
        copies: [],
      },
      "abc",
    );
    expect(settled.edits.overrides).toEqual({});
    expect(settled.edits.relative ?? {}).toEqual({});
  });
});

describe("following the game when the project is opened", () => {
  it("works the number out again and moves base, listing what moved", () => {
    const { edits, follows } = followGame(tougher(), game(280));
    expect(edits.overrides).toEqual({ armpw: { health: 322 } });
    expect(edits.relative?.armpw?.health?.base).toBe(280);
    expect(follows).toEqual([
      {
        kind: "moved",
        unit: "armpw",
        path: "health",
        gameBefore: 260,
        gameNow: 280,
        projectBefore: 299,
        projectNow: 322,
      },
    ]);
    expect(describeFollow(follows[0])).toBe(
      "armpw health follows the game: game 260 to 280, project 299 to 322.",
    );
  });

  it("changes nothing, not even the object, when the game has not moved", () => {
    const edits = tougher();
    const followed = followGame(edits, game(260));
    expect(followed.edits).toBe(edits);
    expect(followed.follows).toEqual([]);
  });

  it("keeps the rule when the new result equals the game's value", () => {
    const edits = setRelativeEdit(
      EMPTY_EDITS,
      "armpw",
      "health",
      { factor: 1, offset: 0.4, rounding: { kind: "integer" } },
      20,
    );
    expect(edits.overrides).toEqual({});
    const followed = followGame(edits, game(30));
    expect(followed.edits.overrides).toEqual({});
    expect(followed.edits.relative?.armpw?.health?.base).toBe(30);
    expect(followed.follows[0]).toMatchObject({
      kind: "moved",
      projectBefore: 20,
      projectNow: 30,
    });
  });

  it("keeps the last number and reports it when the game's field has gone", () => {
    const edits = tougher();
    const followed = followGame(edits, game(undefined));
    expect(followed.edits).toBe(edits);
    expect(followed.follows).toEqual([
      { kind: "missing", unit: "armpw", path: "health", kept: 299 },
    ]);
    expect(describeFollow(followed.follows[0])).toBe(
      "The game no longer has health on armpw, so the change that followed it keeps its last number, 299.",
    );
  });

  it("keeps the last number and reports it when the field is no longer a number", () => {
    const followed = followGame(tougher(), game("lots"));
    expect(followed.edits.overrides).toEqual({ armpw: { health: 299 } });
    expect(followed.follows).toEqual([
      { kind: "not-numeric", unit: "armpw", path: "health", kept: 299 },
    ]);
    expect(describeFollow(followed.follows[0])).toBe(
      "armpw health is no longer a number in the game, so the change that followed it keeps its last number, 299.",
    );
  });

  it("writes the last number down when it had equalled the game's and the field went", () => {
    const edits = setRelativeEdit(
      EMPTY_EDITS,
      "armpw",
      "health",
      { factor: 1, offset: 0.4, rounding: { kind: "integer" } },
      20,
    );
    const followed = followGame(edits, game(undefined));
    expect(followed.edits.overrides).toEqual({ armpw: { health: 20 } });
    expect(followed.follows[0]).toMatchObject({ kind: "missing", kept: 20 });
  });

  it("lets a number an older build typed over the rule win", () => {
    const edits: GameEdits = {
      ...tougher(),
      overrides: { armpw: { health: 400 } },
    };
    const followed = followGame(edits, game(280));
    expect(followed.edits.overrides).toEqual({ armpw: { health: 400 } });
    expect(followed.edits.relative ?? {}).toEqual({});
    expect(followed.follows).toEqual([]);
  });

  it("reads a rule on a copied unit against the copy's own definition", () => {
    const edits: GameEdits = {
      ...setRelativeEdit(EMPTY_EDITS, "supercom", "health", PLUS_15, 1000),
      clones: {
        supercom: {
          key: "supercom",
          source: "armcom",
          replacesGameUnit: false,
          def: { health: 1000 },
        },
      },
    };
    const followed = followGame(edits, { armcom: { health: 5 } });
    expect(followed.edits).toBe(edits);
  });

  it("leaves a unit the game no longer has to the compatibility check", () => {
    const edits = tougher();
    expect(followGame(edits, {})).toEqual({ edits, follows: [] });
  });
});

describe("folding a bulk edit into a rule (for issue #3175)", () => {
  it("multiplies the factor and offset for a percentage", () => {
    expect(
      composeRelative(
        { factor: 1.1, offset: 10, rounding: { kind: "none" } },
        { kind: "multiply", factor: 2 },
        { kind: "integer" },
      ),
    ).toEqual({ factor: 2.2, offset: 20, rounding: { kind: "integer" } });
  });

  it("moves the offset for an add, and starts from no change", () => {
    expect(
      composeRelative(
        undefined,
        { kind: "offset", amount: 40 },
        { kind: "none" },
      ),
    ).toEqual({ factor: 1, offset: 40, rounding: { kind: "none" } });
  });

  it("has no rule for a set", () => {
    expect(
      composeRelative(undefined, { kind: "set", value: 5 }, { kind: "none" }),
    ).toBeUndefined();
  });
});

describe("the rule as the page says it", () => {
  const rule = (
    factor: number,
    offset: number,
    base: number,
  ): RelativeRule => ({
    factor,
    offset,
    rounding: { kind: "integer" },
    base,
  });

  it("names a percentage, an add, or both", () => {
    expect(describeRelative(rule(1.15, 0, 280))).toBe("+15% of 280 = 322");
    expect(describeRelative(rule(0.9, 0, 280))).toBe("-10% of 280 = 252");
    expect(describeRelative(rule(1, 40, 280))).toBe("+40 on 280 = 320");
    expect(describeRelative(rule(1, -40, 280))).toBe("-40 on 280 = 240");
    expect(describeRelative(rule(1.15, 40, 280))).toBe("+15% +40 of 280 = 362");
  });
});

describe("saving and sharing a project with rules", () => {
  const project: ModProject = {
    id: "p1",
    name: "Tougher peewees",
    gameName: "Balanced Annihilation V15.9.8",
    edits: tougher(),
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };

  it("round-trips the rule through export and import", () => {
    const imported = parseModProjectJson(modProjectJson(project));
    expect(imported?.edits.overrides).toEqual({ armpw: { health: 299 } });
    expect(imported?.edits.relative).toEqual(project.edits.relative);
  });

  it("round-trips a project with no rules as one with none", () => {
    const plain = { ...project, edits: { ...EMPTY_EDITS } };
    const imported = parseModProjectJson(modProjectJson(plain));
    expect(imported?.edits).toEqual(EMPTY_EDITS);
  });

  it("reads a project saved before the store as one with no rules", () => {
    const { relative: _none, ...before } = EMPTY_EDITS;
    expect(parseGameEdits(before).relative).toEqual({});
  });

  it("does not move the kind version", () => {
    expect(MOD_PROJECT_KIND_VERSION).toBe(1);
  });

  it("reads as its last worked-out number to a reader that knows nothing of rules", () => {
    // What an older build or the hub sees: the same payload with the key it
    // does not know dropped on the way in.
    const payload = JSON.parse(modProjectJson(project)).payload;
    const { relative: _unknown, ...olderEdits } = payload.edits;
    const older = parseModProjectJson(
      encodeContainerJson("mod-project", 1, { ...payload, edits: olderEdits }),
    );
    expect(older?.edits.overrides).toEqual({ armpw: { health: 299 } });
    expect(older?.edits.relative ?? {}).toEqual({});
  });

  it("drops a rule it cannot read and keeps the number", () => {
    const edits = parseGameEdits({
      overrides: { armpw: { health: 299 } },
      relative: {
        armpw: {
          health: { factor: "lots", offset: 0, rounding: { kind: "none" } },
          speed: {
            factor: 1,
            offset: 1,
            rounding: { kind: "cubic" },
            base: 2,
          },
        },
      },
    });
    expect(edits.overrides).toEqual({ armpw: { health: 299 } });
    expect(edits.relative).toEqual({});
  });
});
