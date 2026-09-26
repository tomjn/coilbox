import { describe, expect, it } from "vitest";
import {
  deathExplosions,
  deathExplosionView,
  explosionEditCount,
  unitsExplodingAs,
} from "./deathExplosions";
import type { FieldRow } from "./unitSections";
import type { LibraryWeapon } from "./weaponLibrary";

/** The game's shared weapon table, keyed lowercase as the worker hands it
 *  over, with explosions out of `weapons/` the way BA and BAR load them. */
const SHARED: Record<string, Record<string, unknown>> = {
  big_unitex: {
    areaofeffect: 64,
    impulsefactor: 0.123,
    damage: { default: 25, fighters: 10 },
  },
  big_unit: { areaofeffect: 96, damage: { default: 50 } },
  shocker: { areaofeffect: 30, damage: { default: 5 } },
};

const rows = (view: { groups: { sections: { rows: FieldRow[] }[] }[] }) =>
  view.groups.flatMap((g) => g.sections.flatMap((s) => s.rows));

describe("deathExplosions", () => {
  it("resolves both names in the shared table, lowercased the way the engine looks them up", () => {
    const unit = { explodeas: "BIG_UNITEX", selfdestructas: "big_unit" };
    const [dies, selfd] = deathExplosions(unit, unit, SHARED, ["armpw"]);
    expect(dies).toMatchObject({
      mount: "explodeas",
      field: "explodeas",
      name: "BIG_UNITEX",
      follows: false,
      definition: { kind: "shared", key: "big_unitex" },
    });
    expect(selfd).toMatchObject({
      mount: "selfdestructas",
      follows: false,
      definition: { kind: "shared", key: "big_unit" },
    });
  });

  it("takes a self-destruct the unit does not set from its death explosion, as the engine does", () => {
    const unit = { explodeAs: "big_unitex" };
    const [dies, selfd] = deathExplosions(unit, unit, SHARED, ["armpw"]);
    expect(dies.field).toBe("explodeAs");
    expect(selfd).toMatchObject({
      field: "selfDestructAs",
      name: "big_unitex",
      follows: true,
      definition: { kind: "shared", key: "big_unitex" },
    });
  });

  it("follows a name the project typed on the fields tab", () => {
    const unit = { explodeas: "big_unitex" };
    const edited = { explodeas: "big_unit" };
    const [dies] = deathExplosions(unit, edited, SHARED, ["armpw"]);
    expect(dies.definition).toMatchObject({ kind: "shared", key: "big_unit" });
  });

  it("finds a definition the unit carries by the full name the post files give it", () => {
    const unit = {
      explodeas: "armshock_shocker",
      weapondefs: { shocker: { areaofeffect: 300 } },
    };
    const [dies] = deathExplosions(unit, unit, SHARED, ["armshock"]);
    expect(dies.definition).toMatchObject({
      kind: "own",
      key: "shocker",
      path: "weapondefs.shocker",
    });
    // A copy's field still names the unit it was copied from.
    const [copy] = deathExplosions(unit, unit, SHARED, ["myshock", "armshock"]);
    expect(copy.definition.kind).toBe("own");
  });

  /**
   * Balanced Annihilation's `armshock` carries `shocker` and writes
   * `explodeas = "SHOCKER"`. Its post file only matches the short name as
   * written, so the capitals miss and it explodes as the shared one.
   */
  it("takes a short name in other capitals for the shared one, as the post files do", () => {
    const unit = {
      explodeas: "SHOCKER",
      weapondefs: { shocker: { areaofeffect: 300 } },
    };
    const [dies] = deathExplosions(unit, unit, SHARED, ["armshock"]);
    expect(dies.definition).toMatchObject({ kind: "shared", key: "shocker" });
    const lower = { ...unit, explodeas: "shocker" };
    const [own] = deathExplosions(lower, lower, SHARED, ["armshock"]);
    expect(own.definition.kind).toBe("own");
  });

  it("says a name nothing defines is missing, and lists nothing for a unit that names neither", () => {
    const unit = { explodeas: "gone" };
    expect(deathExplosions(unit, unit, SHARED, ["x"])[0].definition.kind).toBe(
      "missing",
    );
    expect(
      deathExplosions({ health: 1 }, { health: 1 }, SHARED, ["x"]),
    ).toEqual([]);
  });
});

describe("deathExplosionView", () => {
  const unit = { explodeas: "big_unitex", selfdestructas: "big_unit" };
  const [dies] = deathExplosions(unit, unit, SHARED, ["armpw"]);

  it("shows damage, area of effect, impulse and camera shake, set or not", () => {
    const view = deathExplosionView(dies, {}, "armpw", "relevant", "Peewee", {
      usedBy: 3,
      copyKey: "big_unitex_copy",
    });
    const shown = rows(view);
    expect(shown.map((r) => r.path).sort()).toEqual(
      [
        "areaofeffect",
        "cameraShake",
        "damage.default",
        "damage.fighters",
        "impulseBoost",
        "impulsefactor",
      ].sort(),
    );
    // Camera shake is unset, so the engine reads the default damage.
    expect(shown.find((r) => r.path === "cameraShake")?.inherited).toBe(25);
    expect(view.groups[0].readOnly).toBeFalsy();
    expect(view.groups[0].label).toBe("Death explosion:");
    expect(view.groups[0].identifier).toBe("big_unitex");
    // Shortened to one line (issue #3105), with the detail behind a help
    // icon rather than shown on every visit.
    expect(view.groups[0].note).toBe(
      "Shared with 2 other units. Editing makes a copy for Peewee.",
    );
    expect(view.groups[0].noteDetail).toMatch(
      /2 other units use it\. Changing a field here copies it into the project's weapon library as big_unitex_copy/,
    );
    expect(view.hidden).toBeGreaterThan(0);
  });

  it("draws the library weapon it is, with the project's changes, once equipped", () => {
    const weapon: LibraryWeapon = {
      key: "big_unitex_copy",
      source: "big_unitex",
      def: SHARED.big_unitex,
      changes: { areaofeffect: 200 },
    };
    const view = deathExplosionView(dies, {}, "armpw", "relevant", "Peewee", {
      fires: { weapon, mounts: 1 },
      usedBy: 3,
      copyKey: "unused",
    });
    const aoe = rows(view).find((r) => r.path === "areaofeffect");
    expect(aoe).toMatchObject({
      state: "overridden",
      value: 200,
      inherited: 64,
    });
    expect(view.groups[0].label).toBe("Death explosion: library weapon");
    expect(view.groups[0].identifier).toBe("big_unitex_copy");
  });

  it("reads a definition the unit carries through the unit's own overrides", () => {
    const own = {
      explodeas: "armshock_shocker",
      weapondefs: { shocker: { areaofeffect: 300, damage: { default: 9 } } },
    };
    const [e] = deathExplosions(own, own, SHARED, ["armshock"]);
    const overrides = { armshock: { "weapondefs.shocker.areaofeffect": 400 } };
    const view = deathExplosionView(
      e,
      overrides,
      "armshock",
      "relevant",
      "Shock",
      {
        usedBy: 0,
        copyKey: "shocker_copy",
      },
    );
    expect(
      rows(view).find((r) => r.path === "weapondefs.shocker.areaofeffect"),
    ).toMatchObject({ state: "overridden", value: 400 });
    expect(explosionEditCount(e, overrides, "armshock", undefined)).toBe(1);
  });

  it("draws nothing for a self-destruct that follows the death explosion", () => {
    const only = { explodeas: "big_unitex" };
    const [, selfd] = deathExplosions(only, only, SHARED, ["armpw"]);
    expect(
      deathExplosionView(selfd, {}, "armpw", "relevant", "Peewee", {
        usedBy: 1,
        copyKey: "x",
      }).groups,
    ).toEqual([]);
  });
});

describe("unitsExplodingAs", () => {
  it("counts the units that die or self-destruct as a shared explosion", () => {
    const units = {
      a: { explodeas: "BIG_UNITEX" },
      b: { explodeas: "big_unit", selfdestructas: "big_unitex" },
      c: { explodeas: "big_unit" },
    };
    expect(unitsExplodingAs(units, SHARED, "big_unitex")).toBe(2);
  });
});
