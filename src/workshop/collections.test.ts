import { describe, expect, it } from "vitest";
import {
  type Collections,
  collectionCount,
  collectionTree,
  collectionUnits,
  createCollection,
  EMPTY_COLLECTIONS,
  importCollection,
  parseCollections,
  removeCollection,
  renameCollection,
  restrictEditsToUnits,
  setCollectionMembership,
  setCollectionParent,
  setCollectionRule,
} from "./collections";
import { EMPTY_EDITS } from "./project";

describe("createCollection", () => {
  it("makes a top level collection with a trimmed name and no members", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "  Bots  ");
    expect(collections[id]).toEqual({ id, name: "Bots", units: [] });
  });

  it("nests under a real parent", () => {
    const parent = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const child = createCollection(parent.collections, "Bots", parent.id);
    expect(child.collections[child.id].parentId).toBe(parent.id);
  });

  it("drops a parentId that names no collection, rather than pointing at nothing", () => {
    const { collections, id } = createCollection(
      EMPTY_COLLECTIONS,
      "Orphan",
      "does-not-exist",
    );
    expect(collections[id].parentId).toBeUndefined();
  });

  it("falls back to a name for a blank one", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "   ");
    expect(collections[id].name).toBe("Unnamed collection");
  });
});

describe("renameCollection", () => {
  it("renames", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Bots");
    expect(renameCollection(collections, id, "Robots")[id].name).toBe("Robots");
  });

  it("leaves a blank name alone", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Bots");
    expect(renameCollection(collections, id, "  ")).toBe(collections);
  });

  it("is a no-op for an id it does not hold", () => {
    expect(renameCollection(EMPTY_COLLECTIONS, "nope", "New name")).toBe(
      EMPTY_COLLECTIONS,
    );
  });
});

describe("setCollectionMembership", () => {
  it("adds a unit, lowercased and sorted in", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Bots");
    const next = setCollectionMembership(collections, id, "ARMCOM", true);
    expect(next[id].units).toEqual(["armcom"]);
  });

  it("returns the same object when the unit is already a member", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Bots");
    const once = setCollectionMembership(collections, id, "armcom", true);
    expect(setCollectionMembership(once, id, "armcom", true)).toBe(once);
  });

  it("removes a member", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Bots");
    const added = setCollectionMembership(collections, id, "armcom", true);
    expect(
      setCollectionMembership(added, id, "armcom", false)[id].units,
    ).toEqual([]);
  });
});

describe("setCollectionParent", () => {
  function twoLevels() {
    const top = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const mid = createCollection(top.collections, "Bots", top.id);
    return { collections: mid.collections, topId: top.id, midId: mid.id };
  }

  it("moves a collection to a new parent", () => {
    const other = createCollection(EMPTY_COLLECTIONS, "Other");
    const { collections, midId } = twoLevels();
    const merged = { ...collections, ...other.collections };
    const next = setCollectionParent(merged, midId, other.id);
    expect(next[midId].parentId).toBe(other.id);
  });

  it("moves a collection to the top level with undefined", () => {
    const { collections, midId } = twoLevels();
    const next = setCollectionParent(collections, midId, undefined);
    expect(next[midId].parentId).toBeUndefined();
  });

  it("refuses to make a collection its own parent", () => {
    const { collections, midId } = twoLevels();
    expect(setCollectionParent(collections, midId, midId)).toBe(collections);
  });

  it("refuses to move a collection under its own descendant", () => {
    const { collections, topId, midId } = twoLevels();
    // topId is midId's parent, so moving topId under midId would loop.
    expect(setCollectionParent(collections, topId, midId)).toBe(collections);
  });

  it("refuses a parent the set does not hold", () => {
    const { collections, midId } = twoLevels();
    expect(setCollectionParent(collections, midId, "nowhere")).toBe(
      collections,
    );
  });
});

describe("removeCollection", () => {
  it("re-parents children to the removed collection's own parent", () => {
    const top = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const mid = createCollection(top.collections, "Bots", top.id);
    const leaf = createCollection(mid.collections, "Scouts", mid.id);
    const next = removeCollection(leaf.collections, mid.id);
    expect(next[leaf.id].parentId).toBe(top.id);
    expect(next[mid.id]).toBeUndefined();
  });

  it("drops the parent link entirely when the removed collection was top level", () => {
    const top = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const mid = createCollection(top.collections, "Bots", top.id);
    const next = removeCollection(mid.collections, top.id);
    expect(next[mid.id].parentId).toBeUndefined();
  });
});

describe("collectionUnits", () => {
  it("includes a parent's own units plus every descendant's", () => {
    const top = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const mid = createCollection(top.collections, "Bots", top.id);
    let collections = setCollectionMembership(
      mid.collections,
      top.id,
      "armflash",
      true,
    );
    collections = setCollectionMembership(collections, mid.id, "armcom", true);
    expect(collectionUnits(collections, top.id)).toEqual(
      new Set(["armflash", "armcom"]),
    );
    expect(collectionUnits(collections, mid.id)).toEqual(new Set(["armcom"]));
  });

  it("is undefined for an id the project holds no collection for", () => {
    expect(collectionUnits(EMPTY_COLLECTIONS, "gone")).toBeUndefined();
  });

  it("adds units the rule matches, alongside the explicit list, when live units are given", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    const withRule = setCollectionRule(collections, id, "cost < 200");
    const withMember = setCollectionMembership(
      withRule,
      id,
      "armexpensive",
      true,
    );
    const live = {
      units: {
        armcheap: { metalCost: 100 },
        armexpensive: { metalCost: 900 },
        armmid: { metalCost: 150 },
      },
      overrides: {},
    };
    expect(collectionUnits(withMember, id, live)).toEqual(
      new Set(["armcheap", "armmid", "armexpensive"]),
    );
  });

  it("ignores the rule when no live units are given", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    const withRule = setCollectionRule(collections, id, "cost < 200");
    expect(collectionUnits(withRule, id)).toEqual(new Set());
  });

  it("matches nothing for a rule that fails to parse, rather than throwing", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Broken");
    const withRule = setCollectionRule(collections, id, "cost >");
    const live = { units: { armcom: { metalCost: 100 } }, overrides: {} };
    expect(collectionUnits(withRule, id, live)).toEqual(new Set());
  });

  it("reads a project's override before the game's own field", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    const withRule = setCollectionRule(collections, id, "cost < 200");
    const live = {
      units: { armcom: { metalCost: 900 } },
      overrides: { armcom: { metalCost: 50 } },
    };
    expect(collectionUnits(withRule, id, live)).toEqual(new Set(["armcom"]));
  });

  describe("a rule naming a derived field (issue #3074)", () => {
    const gameLaser = {
      weaponType: "Cannon",
      range: 300,
      reloadTime: 2,
      damage: { default: 50 },
    };
    const tank = {
      metalCost: 200,
      weapons: [{ name: "armtank_laser" }],
      weapondefs: { laser: gameLaser },
    };

    it("matches when weapon resolution is supplied", () => {
      const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Hard");
      const withRule = setCollectionRule(collections, id, "dps > 20");
      const live = {
        units: { armtank: tank },
        overrides: {},
        weapons: { weaponDefs: {}, library: {}, equipped: {}, clones: {} },
      };
      // 50 damage every 2 seconds is a DPS of 25.
      expect(collectionUnits(withRule, id, live)).toEqual(new Set(["armtank"]));
    });

    it("matches nothing when no weapon resolution is supplied", () => {
      const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Hard");
      const withRule = setCollectionRule(collections, id, "dps > 20");
      const live = { units: { armtank: tank }, overrides: {} };
      expect(collectionUnits(withRule, id, live)).toEqual(new Set());
    });
  });
});

describe("setCollectionRule", () => {
  it("sets a trimmed rule", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    expect(setCollectionRule(collections, id, "  cost < 200  ")[id].rule).toBe(
      "cost < 200",
    );
  });

  it("clears the rule for a blank string", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    const withRule = setCollectionRule(collections, id, "cost < 200");
    expect(setCollectionRule(withRule, id, "  ")[id].rule).toBeUndefined();
  });

  it("returns the same object when nothing would change", () => {
    const { collections, id } = createCollection(EMPTY_COLLECTIONS, "Cheap");
    expect(setCollectionRule(collections, id, "")).toBe(collections);
  });

  it("is a no-op for an id it does not hold", () => {
    expect(setCollectionRule(EMPTY_COLLECTIONS, "nope", "cost < 200")).toBe(
      EMPTY_COLLECTIONS,
    );
  });
});

describe("collectionTree", () => {
  it("lists depth first, alphabetical among siblings", () => {
    const top = createCollection(EMPTY_COLLECTIONS, "Tier two");
    const zeta = createCollection(top.collections, "Zeta", top.id);
    const alpha = createCollection(zeta.collections, "Alpha", top.id);
    const tree = collectionTree(alpha.collections);
    expect(tree.map((n) => [n.collection.name, n.depth])).toEqual([
      ["Tier two", 0],
      ["Alpha", 1],
      ["Zeta", 1],
    ]);
  });

  it("treats a collection whose parent is missing as top level", () => {
    const collections: Collections = {
      orphan: { id: "orphan", name: "Orphan", parentId: "gone", units: [] },
    };
    expect(collectionTree(collections)).toEqual([
      { collection: collections.orphan, depth: 0 },
    ]);
  });
});

describe("collectionCount", () => {
  it("counts what is defined", () => {
    const { collections } = createCollection(EMPTY_COLLECTIONS, "Bots");
    expect(collectionCount(collections)).toBe(1);
    expect(collectionCount(undefined)).toBe(0);
  });
});

describe("parseCollections", () => {
  it("reads a well formed set", () => {
    const raw = {
      bots: { name: "Bots", units: ["ARMCOM", "armcom", "armflash"] },
    };
    expect(parseCollections(raw)).toEqual({
      bots: { id: "bots", name: "Bots", units: ["armcom", "armflash"] },
    });
  });

  it("drops an entry with no usable name", () => {
    expect(parseCollections({ bots: { units: ["armcom"] } })).toEqual({});
    expect(parseCollections({ bots: { name: "  " } })).toEqual({});
  });

  it("answers empty for anything that is not a record", () => {
    expect(parseCollections(null)).toBe(EMPTY_COLLECTIONS);
    expect(parseCollections([1, 2, 3])).toBe(EMPTY_COLLECTIONS);
  });

  it("keeps a parentId even when it names nothing in the same payload", () => {
    const parsed = parseCollections({
      bots: { name: "Bots", parentId: "gone", units: [] },
    });
    expect(parsed.bots.parentId).toBe("gone");
  });

  it("reads a trimmed rule", () => {
    const parsed = parseCollections({
      cheap: { name: "Cheap", units: [], rule: "  cost < 200  " },
    });
    expect(parsed.cheap.rule).toBe("cost < 200");
  });

  it("drops a blank or non-string rule rather than storing an empty predicate", () => {
    expect(
      parseCollections({ cheap: { name: "Cheap", units: [], rule: "  " } })
        .cheap.rule,
    ).toBeUndefined();
    expect(
      parseCollections({ cheap: { name: "Cheap", units: [], rule: 5 } }).cheap
        .rule,
    ).toBeUndefined();
  });
});

describe("restrictEditsToUnits", () => {
  it("filters every unit-keyed store to the kept set, leaving project-wide stores alone", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { maxDamage: 5000 }, armflash: { buildTime: 900 } },
      clones: { supercom: { key: "supercom" } },
      menus: { armlab: [{ op: "add", unit: "armcom" }] },
      text: { armcom: { en: { name: "Commander" } } },
      disabled: ["armaser", "armcom"],
      weapons: { heavylaser: { key: "heavylaser" } },
      equipped: { armcom: { "0": "heavylaser" }, armflash: { "0": "x" } },
      armorClasses: {
        base: { commanders: ["armcom"] },
        moves: { armcom: "heavyunits", armflash: "heavyunits" },
      },
      explosionGenerators: { purpleflash: { className: "X" } },
    };
    const keep = new Set(["armcom"]);
    const restricted = restrictEditsToUnits(edits, keep);
    expect(restricted.overrides).toEqual({ armcom: { maxDamage: 5000 } });
    expect(restricted.clones).toEqual({});
    expect(restricted.menus).toEqual({});
    expect(restricted.text).toEqual({ armcom: { en: { name: "Commander" } } });
    expect(restricted.disabled).toEqual(["armcom"]);
    expect(restricted.equipped).toEqual({ armcom: { "0": "heavylaser" } });
    expect(restricted.armorClasses).toEqual({
      base: { commanders: ["armcom"] },
      moves: { armcom: "heavyunits" },
    });
    // Left as they are: not per-unit stores.
    expect(restricted.weapons).toBe(edits.weapons);
    expect(restricted.explosionGenerators).toBe(edits.explosionGenerators);
  });
});

describe("importCollection", () => {
  it("copies a rule-based collection verbatim, since a rule stays current on its own", () => {
    const { collections: source, id } = createCollection(
      EMPTY_COLLECTIONS,
      "Cheap",
    );
    const withRule = setCollectionRule(source, id, "cost < 200");
    const result = importCollection(
      EMPTY_COLLECTIONS,
      withRule[id],
      new Set(["armcom"]),
    );
    expect(result.collections[result.id]).toEqual({
      id: result.id,
      name: "Cheap",
      units: [],
      rule: "cost < 200",
    });
    expect(result.droppedUnits).toEqual([]);
  });

  it("drops units the current game does not have, and says which", () => {
    const { collections: source, id } = createCollection(
      EMPTY_COLLECTIONS,
      "Tier two",
    );
    const withMembers = setCollectionMembership(source, id, "armcom", true);
    const both = setCollectionMembership(withMembers, id, "armflash", true);
    const result = importCollection(
      EMPTY_COLLECTIONS,
      both[id],
      new Set(["armcom"]),
    );
    expect(result.collections[result.id].units).toEqual(["armcom"]);
    expect(result.droppedUnits).toEqual(["armflash"]);
  });

  it("numbers the copy when its name is already taken in this project", () => {
    const { collections: source, id: sourceId } = createCollection(
      EMPTY_COLLECTIONS,
      "Tier two",
    );
    const { collections: existing } = createCollection(
      EMPTY_COLLECTIONS,
      "Tier two",
    );
    const result = importCollection(
      existing,
      source[sourceId],
      new Set(["armcom"]),
    );
    expect(result.name).toBe("Tier two 2");
    expect(result.collections[result.id].name).toBe("Tier two 2");
  });

  it("copies in as a top level collection, ignoring the source's own nesting", () => {
    const top = createCollection(EMPTY_COLLECTIONS, "Parent");
    const { collections: source, id: childId } = createCollection(
      top.collections,
      "Child",
      top.id,
    );
    const result = importCollection(
      EMPTY_COLLECTIONS,
      source[childId],
      new Set(["armcom"]),
    );
    expect(result.collections[result.id].parentId).toBeUndefined();
  });
});
