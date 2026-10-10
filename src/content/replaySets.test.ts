import { describe, expect, it } from "vitest";
import {
  addMembers,
  createSet,
  deleteSet,
  normaliseSets,
  type ReplaySet,
  removeMembers,
  resolveSet,
  updateSet,
  validateSetName,
} from "./replaySets";

const made = (sets: ReplaySet[], id: string, name: string) => {
  const r = createSet(sets, id, name);
  if (!r.ok) throw new Error(r.error);
  return r.sets;
};

describe("creating and naming sets", () => {
  it("trims the name and starts the set empty", () => {
    const sets = made([], "a", "  BPL Season 9  ");
    expect(sets).toEqual([{ id: "a", name: "BPL Season 9", members: [] }]);
  });

  it("keeps a trimmed description and drops a blank one", () => {
    const r = createSet([], "a", "One", "  Finals night ");
    expect(r.ok && r.sets[0].description).toBe("Finals night");
    const blank = createSet([], "b", "Two", "   ");
    expect(blank.ok && "description" in blank.sets[0]).toBe(false);
  });

  it("refuses an empty name", () => {
    expect(createSet([], "a", "   ")).toEqual({
      ok: false,
      error: "Give the set a name.",
    });
  });

  it("refuses a name that matches another set ignoring case and spaces", () => {
    const sets = made([], "a", "Nation Wars");
    expect(validateSetName(" nation wars ", sets)).toMatch(/already exists/);
    expect(createSet(sets, "b", "NATION WARS").ok).toBe(false);
  });

  it("lets a set keep its own name when it is saved", () => {
    const sets = made([], "a", "Nation Wars");
    const r = updateSet(sets, "a", "nation wars", "Round one");
    expect(r.ok && r.sets[0]).toEqual({
      id: "a",
      name: "nation wars",
      description: "Round one",
      members: [],
    });
  });

  it("refuses to rename a set onto another set's name", () => {
    const sets = made(made([], "a", "One"), "b", "Two");
    expect(updateSet(sets, "b", "one", "").ok).toBe(false);
  });

  it("clears the description when it is saved empty", () => {
    const r = createSet([], "a", "One", "Notes");
    if (!r.ok) throw new Error("setup");
    const cleared = updateSet(r.sets, "a", "One", "");
    expect(cleared.ok && "description" in cleared.sets[0]).toBe(false);
  });
});

describe("membership", () => {
  const base = made([], "a", "One");

  it("adds a replay once however often it is added", () => {
    const once = addMembers(base, "a", [{ filename: "x.sdfz" }]);
    const twice = addMembers(once, "a", [{ filename: "x.sdfz" }]);
    expect(twice[0].members).toEqual([{ filename: "x.sdfz" }]);
  });

  it("adds a game id to a member that had none", () => {
    const once = addMembers(base, "a", [{ filename: "x.sdfz" }]);
    const twice = addMembers(once, "a", [{ filename: "x.sdfz", gameId: "g1" }]);
    expect(twice[0].members).toEqual([{ filename: "x.sdfz", gameId: "g1" }]);
  });

  it("removes replays and leaves other sets alone", () => {
    const two = made(base, "b", "Two");
    const filled = addMembers(
      addMembers(two, "a", [{ filename: "x" }, { filename: "y" }]),
      "b",
      [{ filename: "x" }],
    );
    const out = removeMembers(filled, "a", ["x"]);
    expect(out[0].members).toEqual([{ filename: "y" }]);
    expect(out[1].members).toEqual([{ filename: "x" }]);
  });

  it("deletes the set and nothing else", () => {
    const two = made(base, "b", "Two");
    expect(deleteSet(two, "a").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resolving a set against the library", () => {
  const set: ReplaySet = {
    id: "a",
    name: "One",
    members: [
      { filename: "kept.sdfz", gameId: "g1" },
      { filename: "renamed-old.sdfz", gameId: "g2" },
      { filename: "gone.sdfz", gameId: "g3" },
      { filename: "nogame.sdfz" },
    ],
  };

  it("keeps members that left the library and counts them as missing", () => {
    const items = [{ filename: "kept.sdfz" }, { filename: "other.sdfz" }];
    const r = resolveSet(set, items);
    expect(r.present.map((i) => i.filename)).toEqual(["kept.sdfz"]);
    expect(r.missing.map((m) => m.filename)).toEqual([
      "renamed-old.sdfz",
      "gone.sdfz",
      "nogame.sdfz",
    ]);
    // Resolving never edits the set.
    expect(set.members).toHaveLength(4);
  });

  it("finds a renamed file by its game id", () => {
    const items = [
      { filename: "renamed-new.sdfz", gameId: "g2" },
      { filename: "kept.sdfz", gameId: "g1" },
    ];
    const r = resolveSet(set, items);
    expect(r.present.map((i) => i.filename)).toEqual([
      "renamed-new.sdfz",
      "kept.sdfz",
    ]);
    expect(r.missing.map((m) => m.filename)).toEqual([
      "gone.sdfz",
      "nogame.sdfz",
    ]);
  });

  it("does not let a remix of a member's match stand in for it", () => {
    const items = [{ filename: "remix.sdfz", gameId: "g3", remixed: true }];
    const r = resolveSet(set, items);
    expect(r.present).toEqual([]);
  });

  it("does not match a member by game id when the file is still there", () => {
    const items = [
      { filename: "kept.sdfz", gameId: "g1" },
      { filename: "copy.sdfz", gameId: "g1" },
    ];
    const r = resolveSet(set, items);
    expect(r.present.map((i) => i.filename)).toEqual(["kept.sdfz"]);
  });

  it("reads the game id through a lookup when the item has none", () => {
    const ids: Record<string, string> = { "new.sdfz": "g2" };
    const r = resolveSet(
      set,
      [{ filename: "new.sdfz" }],
      (i) => ids[i.filename],
    );
    expect(r.present).toHaveLength(1);
  });
});

describe("storage shape", () => {
  it("round trips through JSON", () => {
    const sets = addMembers(made([], "a", "One"), "a", [
      { filename: "x", gameId: "g" },
    ]);
    expect(normaliseSets(JSON.parse(JSON.stringify(sets)))).toEqual(sets);
  });

  it("reads nothing stored, or something that is not a list, as no sets", () => {
    expect(normaliseSets(undefined)).toEqual([]);
    expect(normaliseSets(null)).toEqual([]);
    expect(normaliseSets({})).toEqual([]);
    expect(normaliseSets("sets")).toEqual([]);
  });

  it("reads a set with no members list and skips malformed entries", () => {
    const raw = [
      { id: "a", name: "Old shape" },
      { id: 3, name: "bad id" },
      null,
      {
        id: "b",
        name: "Mixed",
        members: [{ filename: "x" }, { gameId: "g" }, 4],
      },
    ];
    expect(normaliseSets(raw)).toEqual([
      { id: "a", name: "Old shape", members: [] },
      { id: "b", name: "Mixed", members: [{ filename: "x" }] },
    ]);
  });
});
