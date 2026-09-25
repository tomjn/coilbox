import { describe, expect, it } from "vitest";
import BA from "./fixtures/ba-units-slice.json";
import { setOverride } from "./overrides";
import type { FieldRow } from "./unitSections";
import {
  libraryWeaponGroup,
  slotEditCount,
  slotOfPath,
  unitsMounting,
  type WeaponSlot,
  weaponSlots,
  weaponSlotView,
} from "./weaponSlots";

type Defs = Record<string, Record<string, unknown>>;
const UNITS = BA.units as unknown as Defs;
const SHARED = BA.weaponDefs as unknown as Defs;

const rowsOf = (group: { sections: { rows: FieldRow[] }[] } | undefined) =>
  group?.sections.flatMap((s) => s.rows) ?? [];

const armcomSlots = () => weaponSlots(UNITS.armcom, SHARED, ["armcom"]);

describe("weaponSlots", () => {
  /**
   * Balanced Annihilation V15.9.8 as the worker read it. Every slot names a
   * definition its unit carries, under the `<unit>_<name>` the base content's
   * `weapondefs_post.lua` gives it.
   */
  it("finds each slot's own definition in a real game's unit", () => {
    expect(
      armcomSlots().map((s) => [
        s.number,
        s.path,
        s.name,
        s.definition.kind === "own" ? s.definition.path : s.definition.kind,
      ]),
    ).toEqual([
      [1, "weapons.0", "armcom_armcomlaser", "weapondefs.armcomlaser"],
      [2, "weapons.1", "armcom_armcomsealaser", "weapondefs.armcomsealaser"],
      [
        3,
        "weapons.2",
        "armcom_arm_disintegrator",
        "weapondefs.arm_disintegrator",
      ],
    ]);
  });

  /** XTA's commander: Weapon1 and Weapon3 and no Weapon2 (issue #3041). */
  it("keeps a list with a gap numbered the way the file numbers it", () => {
    const slots = weaponSlots(
      {
        weapons: {
          "1": { name: "CSARMCOMLASER" },
          "3": { name: "CSARM_DISINTEGRATOR" },
        },
      },
      { csarmcomlaser: { range: 300 }, csarm_disintegrator: { range: 250 } },
      ["armcom"],
    );
    expect(slots.map((s) => [s.step, s.number, s.path])).toEqual([
      ["1", 1, "weapons.1"],
      ["3", 3, "weapons.3"],
    ]);
  });

  it("finds a definition the unit does not carry in the game's shared table", () => {
    const [slot] = weaponSlots(
      { weapons: [{ name: "ARM_LIGHTLASER" }] },
      { arm_lightlaser: { range: 280 } },
      ["armpw"],
    );
    expect(slot.definition).toEqual({
      kind: "shared",
      key: "arm_lightlaser",
      def: { range: 280 },
    });
  });

  it("says when nothing in the game defines a slot's weapon", () => {
    const [slot] = weaponSlots({ weapons: [{ name: "gone" }] }, {}, ["u"]);
    expect(slot.definition).toEqual({ kind: "missing" });
  });

  /**
   * A copy of a unit still names its weapons after the unit it was copied
   * from, so its own table has to be found through the source's prefix too.
   */
  it("finds a copy's own definition through the name of the unit it copied", () => {
    const copy = weaponSlots(UNITS.armcom, SHARED, ["supercom", "armcom"]);
    expect(copy.map((s) => s.definition.kind)).toEqual(["own", "own", "own"]);
    // Without the source's name the slot falls back to the game's table,
    // which is armcom's definition and not the copy's.
    const orphan = weaponSlots(UNITS.armcom, SHARED, ["supercom"]);
    expect(orphan.map((s) => s.definition.kind)).toEqual([
      "shared",
      "shared",
      "shared",
    ]);
  });

  it("skips an entry that names no weapon, as the engine does", () => {
    expect(weaponSlots({ weapons: [{}, { name: "" }] }, {}, ["u"]).length).toBe(
      0,
    );
    expect(weaponSlots({}, {}, ["u"])).toEqual([]);
    expect(weaponSlots(undefined, {}, ["u"])).toEqual([]);
  });

  it("counts the units that mount a shared definition", () => {
    const units = {
      a: { weapons: [{ name: "LASER" }] },
      b: { weapons: [{ name: "laser" }, { name: "laser" }] },
      c: { weapons: [{ name: "other" }] },
    };
    const shared = { laser: {}, other: {} };
    expect(unitsMounting(units, shared, "laser")).toBe(2);
  });
});

describe("weaponSlotView", () => {
  const [laser] = armcomSlots();

  it("puts the mount first and the definition second, each where it is written", () => {
    const view = weaponSlotView(laser, {}, "armcom", "relevant", "Commander");
    expect(view.groups.map((g) => g.id)).toEqual(["slot", "definition"]);
    const [mount, definition] = view.groups;
    expect(rowsOf(mount).map((r) => r.path)).toEqual([
      "weapons.0.onlytargetcategory",
    ]);
    expect(rowsOf(mount)[0]).toMatchObject({
      label: "Only shoots at",
      value: "NOTSUB",
      present: true,
    });
    const range = rowsOf(definition).find((r) => r.field.key === "range");
    expect(range).toMatchObject({
      path: "weapondefs.armcomlaser.range",
      label: "Range",
      value: 300,
    });
    expect(definition.readOnly).toBe(false);
    expect(definition.note).toContain("Commander carries its own copy");
  });

  /** The number a person usually came for is the first thing on the tab. */
  it("draws damage first, the default class before the named ones", () => {
    const view = weaponSlotView(laser, {}, "armcom", "relevant", "Commander");
    const sections = view.groups[1].sections;
    expect(sections[0].id).toBe("damage");
    expect(sections[0].rows.map((r) => [r.path, r.label])).toEqual([
      ["weapondefs.armcomlaser.damage.default", "Default damage"],
      ["weapondefs.armcomlaser.damage.bombers", "Damage against bombers"],
      ["weapondefs.armcomlaser.damage.fighters", "Damage against fighters"],
      ["weapondefs.armcomlaser.damage.subs", "Damage against subs"],
    ]);
    // An armour class is a key the engine reads, not one only the game does.
    expect(sections[0].rows.every((r) => r.field.known)).toBe(true);
  });

  it("marks an edit to the slot and to the definition as the user's", () => {
    let overrides = setOverride(
      {},
      "armcom",
      "weapons.0.onlytargetcategory",
      "SURFACE",
      "NOTSUB",
    );
    overrides = setOverride(
      overrides,
      "armcom",
      "weapondefs.armcomlaser.range",
      400,
      300,
    );
    const view = weaponSlotView(
      laser,
      overrides,
      "armcom",
      "relevant",
      "Commander",
    );
    const edited = view.groups
      .flatMap((g) => rowsOf(g))
      .filter((r) => r.state === "overridden")
      .map((r) => [r.path, r.value, r.inherited]);
    expect(edited).toEqual([
      ["weapons.0.onlytargetcategory", "SURFACE", "NOTSUB"],
      ["weapondefs.armcomlaser.range", 400, 300],
    ]);
    expect(slotEditCount(laser, overrides, "armcom")).toBe(2);
    // The second slot is untouched by either.
    expect(slotEditCount(armcomSlots()[1], overrides, "armcom")).toBe(0);
  });

  it("offers every engine field in the all view and counts them as hidden", () => {
    const relevant = weaponSlotView(laser, {}, "armcom", "relevant", "C");
    const all = weaponSlotView(laser, {}, "armcom", "all", "C");
    expect(relevant.hidden).toBeGreaterThan(0);
    expect(all.shown).toBe(relevant.shown + relevant.hidden);
    const paths = all.groups.flatMap((g) => rowsOf(g)).map((r) => r.path);
    expect(paths).toContain("weapons.0.maxAngleDif");
    expect(paths).toContain("weapondefs.armcomlaser.burst");
    // One row per field, whichever spelling the game used.
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(paths.length);
    // Changing which weapon a slot holds is not a field of the slot.
    expect(paths).not.toContain("weapons.0.name");
  });

  it("keeps a slot's name row only while the project has changed it", () => {
    const overrides = setOverride(
      {},
      "armcom",
      "weapons.0.name",
      "armcom_armcomsealaser",
      "armcom_armcomlaser",
    );
    const view = weaponSlotView(laser, overrides, "armcom", "relevant", "C");
    expect(rowsOf(view.groups[0]).map((r) => r.path)).toContain(
      "weapons.0.name",
    );
  });

  /**
   * A key the engine does not read is kept, and said to be the game's own,
   * which is how the row can mark it for the reader (issue #3050).
   */
  it("keeps a definition key only the game reads, marked unknown", () => {
    const [slot] = weaponSlots(
      {
        weapons: [{ name: "u_gun" }],
        weapondefs: { gun: { range: 100, mygamesflag: 1 } },
      },
      {},
      ["u"],
    );
    const rows = weaponSlotView(slot, {}, "u", "relevant", "U").groups[1]
      .sections;
    const game = rows.find((s) => s.id === "game");
    expect(game?.rows.map((r) => [r.path, r.field.known])).toEqual([
      ["weapondefs.gun.mygamesflag", false],
    ]);
  });

  /** Weapon textures are Lua keys 1 to 4, which the worker hands over as a
   *  list counted from zero. */
  it("names a texture by the key the file writes, not the list position", () => {
    const [slot] = weaponSlots(
      {
        weapons: [{ name: "u_gun" }],
        weapondefs: { gun: { textures: ["a.png", "b.png"] } },
      },
      {},
      ["u"],
    );
    const textures = weaponSlotView(
      slot,
      {},
      "u",
      "relevant",
      "U",
    ).groups[1].sections.find((s) => s.id === "textures");
    expect(textures?.rows.map((r) => r.path)).toEqual([
      "weapondefs.gun.textures.0",
      "weapondefs.gun.textures.1",
    ]);
    expect(textures?.rows.every((r) => r.field.known)).toBe(true);
  });

  it("shows a shared definition and offers none of it", () => {
    const [slot] = weaponSlots(
      { weapons: [{ name: "ARM_LIGHTLASER" }] },
      { arm_lightlaser: { range: 280 } },
      ["armpw"],
    );
    // An override the project somehow holds is not drawn over a table the
    // unit does not carry.
    const overrides = { armpw: { "WeaponDefs.arm_lightlaser.range": 1 } };
    const view = weaponSlotView(
      slot,
      overrides,
      "armpw",
      "relevant",
      "Peewee",
      7,
    );
    const definition = view.groups[1];
    expect(definition.readOnly).toBe(true);
    expect(definition.note).toContain(
      "ARM_LIGHTLASER is in the game's shared weapon table, and 7 units mount it",
    );
    expect(rowsOf(definition)).toEqual([
      expect.objectContaining({
        path: "WeaponDefs.arm_lightlaser.range",
        value: 280,
        state: "inherited",
      }),
    ]);
  });

  it("offers no mount fields for a slot written as a bare name", () => {
    const [slot] = weaponSlots({ weapons: ["gun"] }, { gun: { range: 1 } }, [
      "u",
    ]);
    const view = weaponSlotView(slot, {}, "u", "all", "U");
    expect(view.groups[0].sections).toEqual([]);
    expect(view.groups[0].note).toContain("no mount fields");
  });
});

describe("a slot firing a library weapon (issue #2640)", () => {
  const [laser] = armcomSlots();
  const weapon = {
    key: "heavylaser",
    source: "armcom_armcomlaser",
    def: { range: 300, damage: { default: 75 } },
    changes: { range: 450 },
  };

  it("draws the library weapon in place of the game's definition, apart from the unit's fields", () => {
    const view = weaponSlotView(
      laser,
      {},
      "armcom",
      "relevant",
      "Commander",
      0,
      { weapon, mounts: 3 },
    );
    expect(view.groups.map((g) => g.id)).toEqual(["slot"]);
    expect(view.library?.id).toBe("library");
    expect(view.library?.note).toContain(
      "it reaches the 2 other slots that fire it too",
    );
    const range = rowsOf(view.library).find((r) => r.field.key === "range");
    expect(range).toMatchObject({
      path: "range",
      value: 450,
      inherited: 300,
      state: "overridden",
    });
    const dmg = rowsOf(view.library).find((r) => r.path === "damage.default");
    expect(dmg).toMatchObject({ value: 75, state: "inherited" });
    expect(view.shown).toBe(rowsOf(view.groups[0]).length + 2);
  });

  it("keeps an edit on screen for a field the copy never declared", () => {
    const { group, relevant } = libraryWeaponGroup(
      { ...weapon, changes: { reloadtime: 2 } },
      "relevant",
      "",
    );
    expect(relevant).toBe(3);
    expect(rowsOf(group).find((r) => r.path === "reloadtime")).toMatchObject({
      present: false,
      value: 2,
      state: "overridden",
    });
  });
});

describe("slotOfPath", () => {
  const slots: WeaponSlot[] = armcomSlots();

  it("finds the slot a slot field or a definition field belongs to", () => {
    expect(slotOfPath(slots, "weapons.1.badtargetcategory")?.number).toBe(2);
    expect(
      slotOfPath(slots, "weapondefs.arm_disintegrator.range")?.number,
    ).toBe(3);
    expect(slotOfPath(slots, "health")).toBeUndefined();
  });
});
