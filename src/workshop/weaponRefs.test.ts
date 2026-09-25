import { describe, expect, it } from "vitest";
import {
  equipRefusal,
  type LibraryWeapon,
  suggestWeaponKeyWhere,
  type WeaponLibrary,
} from "./weaponLibrary";
import {
  type CopySource,
  librarySupport,
  planLibraryCopy,
  refProblems,
  resolveRef,
  supportingDefs,
  type WeaponRef,
  weaponRefs,
} from "./weaponRefs";
import { weaponSlots } from "./weaponSlots";

type Defs = Record<string, Record<string, unknown>>;

/**
 * Shaped like Beyond All Reason test-30922's `armmship` as the unitsync worker
 * reads it, after the game's post files: a rocket whose split effect names the
 * unit's unmounted `rocket_split` by full name, and a missile. The plasma
 * shell's cluster child is what Legion's cluster units carry, with the short
 * name already prefixed by `alldefs_post.lua`. Values are made up.
 */
const SHIP = {
  weapons: [{ name: "armmship_rocket" }, { name: "armmship_missile" }],
  weapondefs: {
    rocket: {
      range: 1000,
      customparams: {
        speceffect: "split",
        speceffect_def: "armmship_rocket_split",
      },
    },
    rocket_split: { range: 300 },
    missile: {
      range: 800,
      customparams: { cluster_def: "armmship_cluster_munition" },
    },
    cluster_munition: { range: 100 },
    leftover: { range: 50 },
  },
};

const SHARED: Defs = {
  armmship_rocket: SHIP.weapondefs.rocket,
  armmship_rocket_split: SHIP.weapondefs.rocket_split,
  armmship_missile: SHIP.weapondefs.missile,
  armmship_cluster_munition: SHIP.weapondefs.cluster_munition,
  armmship_leftover: SHIP.weapondefs.leftover,
  cormship_rocket_split: { range: 310 },
};

const ref = (field: string, value: string): WeaponRef => ({
  field: weaponRefs({ customparams: { [field]: value } })[0].field,
  path: `customparams.${field}`,
  value,
});

describe("weaponRefs", () => {
  it("reads the two reference fields a game names weapons by", () => {
    expect(
      weaponRefs(SHIP.weapondefs.rocket).map((r) => [
        r.path,
        r.field.resolution,
        r.value,
      ]),
    ).toEqual([
      ["customparams.speceffect_def", "full", "armmship_rocket_split"],
    ]);
    expect(
      weaponRefs({ CustomParams: { Cluster_Def: " child " } }).map((r) => [
        r.path,
        r.value,
      ]),
    ).toEqual([["CustomParams.Cluster_Def", "child"]]);
    expect(weaponRefs({ customparams: { cluster_def: "" } })).toEqual([]);
  });
});

describe("resolveRef", () => {
  const scope = {
    own: SHIP.weapondefs,
    owners: ["armmship"],
    shared: SHARED,
  };

  it("finds a short name among the unit's own, bare or as the post files prefix it", () => {
    expect(resolveRef(ref("cluster_def", "cluster_munition"), scope)).toEqual({
      kind: "own",
      key: "cluster_munition",
    });
    expect(
      resolveRef(ref("cluster_def", "armmship_cluster_munition"), scope),
    ).toEqual({ kind: "own", key: "cluster_munition" });
    // Beyond All Reason prefixes it with the owning unit, so another unit's
    // child is never what it finds.
    expect(
      resolveRef(ref("cluster_def", "cormship_rocket_split"), scope),
    ).toBeUndefined();
  });

  it("takes a full name only as the full name, from anywhere in the game", () => {
    expect(
      resolveRef(ref("speceffect_def", "armmship_rocket_split"), scope),
    ).toEqual({ kind: "own", key: "rocket_split" });
    expect(
      resolveRef(ref("speceffect_def", "cormship_rocket_split"), scope),
    ).toEqual({ kind: "shared", key: "cormship_rocket_split" });
    expect(
      resolveRef(ref("speceffect_def", "rocket_split"), scope),
    ).toBeUndefined();
  });

  it("names a library weapon first, for a library weapon", () => {
    const library = { rocket_split: {} as LibraryWeapon };
    expect(
      resolveRef(ref("speceffect_def", "rocket_split"), { ...scope, library }),
    ).toEqual({ kind: "library", key: "rocket_split" });
  });
});

describe("supportingDefs", () => {
  it("lists what the unit carries and no slot mounts, and what names each", () => {
    const slots = weaponSlots(SHIP, SHARED, ["armmship"]);
    const supporting = supportingDefs(SHIP, SHIP, slots, ["armmship"], SHARED);
    expect(supporting.map((s) => [s.key, s.path, s.usedBy])).toEqual([
      [
        "rocket_split",
        "weapondefs.rocket_split",
        [{ from: "rocket", field: "speceffect_def" }],
      ],
      [
        "cluster_munition",
        "weapondefs.cluster_munition",
        [{ from: "missile", field: "cluster_def" }],
      ],
      ["leftover", "weapondefs.leftover", []],
    ]);
  });

  it("reads what names each off the edited unit", () => {
    const slots = weaponSlots(SHIP, SHARED, ["armmship"]);
    const edited = structuredClone(SHIP);
    edited.weapondefs.missile.customparams.cluster_def = "leftover";
    const supporting = supportingDefs(
      SHIP,
      edited,
      slots,
      ["armmship"],
      SHARED,
    );
    expect(supporting.find((s) => s.key === "leftover")?.usedBy).toEqual([
      { from: "missile", field: "cluster_def" },
    ]);
    expect(
      supporting.find((s) => s.key === "cluster_munition")?.usedBy,
    ).toEqual([]);
  });

  it("finds a copy's through the unit it was copied from", () => {
    const slots = weaponSlots(SHIP, SHARED, ["myship", "armmship"]);
    const supporting = supportingDefs(
      SHIP,
      SHIP,
      slots,
      ["myship", "armmship"],
      SHARED,
    );
    expect(supporting[0].usedBy).toEqual([
      { from: "rocket", field: "speceffect_def" },
    ]);
  });
});

describe("refProblems", () => {
  it("finds nothing wrong with the game as it ships", () => {
    expect(refProblems(SHIP, "Ship", ["armmship"], SHARED, {}, [])).toEqual([]);
  });

  it("says which reference names nothing, and why", () => {
    const edited = structuredClone(SHIP);
    edited.weapondefs.missile.customparams.cluster_def = "gone";
    edited.weapondefs.rocket.customparams.speceffect_def = "rocket_split";
    const problems = refProblems(edited, "Ship", ["armmship"], SHARED, {}, []);
    expect(problems.map((p) => [p.id, p.value])).toEqual([
      ["own:rocket:speceffect_def", "rocket_split"],
      ["own:missile:cluster_def", "gone"],
    ]);
    expect(problems[0].message).toContain("full name");
    expect(problems[1].message).toContain("which Ship carries");
  });

  it("checks a library weapon a slot fires against the library, then the unit", () => {
    const parent: LibraryWeapon = {
      key: "rocket_copy",
      source: "armmship_rocket",
      def: { customparams: { speceffect_def: "split_copy" } },
    };
    const child: LibraryWeapon = {
      key: "split_copy",
      source: "armmship_rocket_split",
      def: { range: 300 },
    };
    const library = { rocket_copy: parent, split_copy: child };
    expect(
      refProblems(SHIP, "Ship", ["armmship"], SHARED, library, [parent]),
    ).toEqual([]);
    const lost = refProblems(
      SHIP,
      "Ship",
      ["armmship"],
      SHARED,
      { rocket_copy: parent },
      [parent],
    );
    expect(lost.map((p) => p.id)).toEqual([
      "library:rocket_copy:speceffect_def",
    ]);
    // A change to the reference is read too.
    const changed = {
      ...parent,
      changes: { "customparams.speceffect_def": "x" },
    };
    expect(
      refProblems(SHIP, "Ship", ["armmship"], SHARED, library, [changed]).map(
        (p) => p.value,
      ),
    ).toEqual(["x"]);
  });
});

describe("library support", () => {
  const weapon = (
    key: string,
    params: Record<string, string> = {},
  ): LibraryWeapon => ({
    key,
    source: `ship_${key}`,
    def: { customparams: params },
  });
  const library: WeaponLibrary = {
    parent: weapon("parent", { cluster_def: "child", speceffect_def: "split" }),
    child: weapon("child", { cluster_def: "grandchild" }),
    grandchild: weapon("grandchild", { cluster_def: "parent" }),
    split: weapon("split"),
  };

  it("lists every library weapon one names, once each", () => {
    expect(librarySupport(library, "parent")).toEqual([
      "child",
      "grandchild",
      "split",
    ]);
    expect(librarySupport(library, "split")).toEqual([]);
  });

  it("refuses to equip into a unit that carries a child's name", () => {
    expect(
      equipRefusal(
        { weapondefs: { grandchild: {} } },
        "Ship",
        "parent",
        library,
      ),
    ).toContain("brings grandchild");
    expect(
      equipRefusal({ weapondefs: { other: {} } }, "Ship", "parent", library),
    ).toBeUndefined();
  });
});

describe("planLibraryCopy", () => {
  const own = SHIP.weapondefs as Record<string, Record<string, unknown>>;
  const childOf = (r: WeaponRef): CopySource | undefined => {
    const target = resolveRef(r, {
      own,
      owners: ["armmship"],
      shared: SHARED,
    });
    return target?.kind === "own"
      ? { source: `armmship_${target.key}`, def: own[target.key] }
      : undefined;
  };

  it("copies what a weapon names and points it at the copies", () => {
    const plan = planLibraryCopy(
      "rocket_copy",
      {
        source: "armmship_rocket",
        def: own.rocket,
        beforePost: {
          values: {
            "customparams.speceffect_def": "armmship_rocket_split",
            range: 900,
          },
        },
      },
      {},
      childOf,
      suggestWeaponKeyWhere,
    );
    expect(plan.map((p) => [p.key, p.from.source])).toEqual([
      ["rocket_copy", "armmship_rocket"],
      ["armmship_rocket_split_copy", "armmship_rocket_split"],
    ]);
    expect(plan[0].from.def).toEqual({
      range: 1000,
      customparams: {
        speceffect: "split",
        speceffect_def: "armmship_rocket_split_copy",
      },
    });
    // The game's value for the renamed reference would undo the rename.
    expect(plan[0].from.beforePost).toEqual({ values: { range: 900 } });
    // The game's own table is never written to.
    expect(own.rocket.customparams).toEqual({
      speceffect: "split",
      speceffect_def: "armmship_rocket_split",
    });
  });

  it("names a child the library already copied rather than copying it again", () => {
    const library: WeaponLibrary = {
      munition: {
        key: "munition",
        source: "armmship_cluster_munition",
        def: { range: 100 },
      },
    };
    const plan = planLibraryCopy(
      "missile_copy",
      { source: "armmship_missile", def: own.missile },
      library,
      childOf,
      suggestWeaponKeyWhere,
    );
    expect(plan.map((p) => p.key)).toEqual(["missile_copy"]);
    expect(plan[0].from.def.customparams).toEqual({ cluster_def: "munition" });
  });
});
