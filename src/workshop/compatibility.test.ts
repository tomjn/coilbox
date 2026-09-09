import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CustomParamsResult } from "@/content/bindings";
import {
  type CompatInput,
  type CompatReport,
  checkCompatibility,
} from "./compatibility";
import type { GameEdits } from "./project";
import { EMPTY_EDITS } from "./project";

/**
 * The comparison in `compatibility.ts`, rule by rule and then against a real
 * game.
 *
 * The second half is the point. A test built entirely out of invented
 * definitions proves the rules apply to the definitions the test wrote, and
 * says nothing about whether a Spring game's unit table is shaped the way the
 * rules assume: whether mounts name their weapondef under `name` or `def`,
 * whether the shared table is prefixed, whether keys arrive lowercased. Every
 * one of those was checked against a game on disk rather than guessed at, and
 * `fixtures/ba-units-slice.json` is what came back.
 */

const check = (edits: GameEdits, over: Partial<CompatInput> = {}) =>
  checkCompatibility({
    edits,
    units: {},
    weaponDefs: {},
    gameName: "Test Game",
    ...over,
  });

const ids = (report: CompatReport) => report.findings.map((f) => f.id);

/** The one finding a report was expected to have. */
function only(report: CompatReport) {
  expect(ids(report)).toHaveLength(1);
  return report.findings[0];
}

describe("units that have gone", () => {
  it("says a mark on a missing unit does nothing, and costs nothing to drop", () => {
    const edits = { ...EMPTY_EDITS, disabled: ["corak", "armpw"] };
    const found = only(check(edits, { units: { armpw: {} } }));
    expect(found).toMatchObject({
      id: "disabled:corak",
      store: "disabled",
      severity: "broken",
      subject: "corak",
    });
    expect(found.fix?.cost).toBe("nothing, a mark is not an edit");
    expect(found.fix?.apply(edits).disabled).toEqual(["armpw"]);
  });

  it("counts a project's own copy as a unit the game has", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      disabled: ["supercom"],
      clones: {
        supercom: { key: "supercom", replacesGameUnit: false, def: {} },
      },
    };
    expect(check(edits).findings).toEqual([]);
  });

  it("drops a missing unit's overrides together, naming what goes", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { corak: { maxdamage: 500, buildtime: 900 }, armpw: { x: 1 } },
    };
    const found = only(check(edits, { units: { armpw: { x: 0 } } }));
    expect(found).toMatchObject({ id: "overrides:corak", severity: "broken" });
    expect(found.detail).toContain("2 changes");
    expect(found.fix?.cost).toBe("2 fields you set on corak");
    expect(found.fix?.apply(edits).overrides).toEqual({ armpw: { x: 1 } });
  });

  it("drops words written for a unit that has gone, counting them", () => {
    const edits = {
      ...EMPTY_EDITS,
      text: {
        corak: { en: { name: "Gator", description: "Fast bot" } },
        armpw: { en: { name: "Peewee" } },
      },
    };
    const found = only(check(edits, { units: { armpw: {} } }));
    expect(found).toMatchObject({ id: "text:corak", severity: "broken" });
    expect(found.fix?.cost).toBe(
      "2 names and descriptions you wrote for corak",
    );
    expect(Object.keys(found.fix?.apply(edits).text ?? {})).toEqual(["armpw"]);
  });

  it("says nothing about a unit whose text entry has been emptied", () => {
    expect(check({ ...EMPTY_EDITS, text: { corak: {} } }).findings).toEqual([]);
  });
});

describe("fields that have moved inside a unit that is still there", () => {
  const units = { armcom: { weapondefs: { armcomlaser: { range: 300 } } } };

  it("reports a path whose parent table has gone, and drops only that path", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: {
        armcom: {
          "weapondefs.armcomlaser.range": 400,
          "weapondefs.disintegrator.range": 900,
        },
      },
    };
    const found = only(check(edits, { units }));
    expect(found).toMatchObject({
      id: "overrides:armcom:weapondefs.disintegrator.range",
      severity: "review",
    });
    expect(found.detail).toContain("no longer has weapondefs.disintegrator");
    expect(found.fix?.apply(edits).overrides).toEqual({
      armcom: { "weapondefs.armcomlaser.range": 400 },
    });
  });

  it("never reports a single-step path, which the engine may read by default", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { maxdamage: 5000 } },
    };
    expect(check(edits, { units }).findings).toEqual([]);
  });

  it("reads a copy's paths against the copy's own definition", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      clones: {
        supercom: {
          key: "supercom",
          replacesGameUnit: false,
          def: { weapondefs: { bigger: {} } },
        },
      },
      overrides: { supercom: { "weapondefs.bigger.range": 900 } },
    };
    expect(check(edits, { units }).findings).toEqual([]);
  });
});

describe("field keys nothing reads any more (issue #2758)", () => {
  const scan = (
    params: CustomParamsResult["params"] = {},
    rest: Partial<CustomParamsResult> = {},
  ): CustomParamsResult => ({
    params,
    wholeTableFiles: 0,
    filesScanned: 100,
    truncated: false,
    errors: [],
    ...rest,
  });

  it("reports a key the engine has never read and the unit no longer carries", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { somekey: 1 } },
    };
    const found = only(check(edits, { units: { armcom: {} } }));
    expect(found).toMatchObject({
      id: "overrides:armcom:somekey:key",
      severity: "review",
    });
    expect(found.detail).toContain("engine has never read somekey");
    expect(found.fix?.cost).toBe("the value you set for somekey");
    expect(found.fix?.apply(edits).overrides).toEqual({ armcom: {} });
  });

  it("says nothing about a key the unit's own current definition still carries", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { somekey: 10 } },
    };
    expect(
      check(edits, { units: { armcom: { somekey: 5 } } }).findings,
    ).toEqual([]);
  });

  it("never judges a key inside a table the engine reads whole, even absent", () => {
    const edits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { "buildoptions.5": "corak" } },
    };
    expect(
      check(edits, { units: { armcom: { buildoptions: ["armlab"] } } })
        .findings,
    ).toEqual([]);
  });

  describe("a unit's own inline weapon definitions", () => {
    const units = { armcom: { weapondefs: { armcomlaser: {} } } };

    it("reads a weapondef's own leaf against the weapon registry, not the unit's", () => {
      // `range` is a real weapon field the engine reads. Absent from this
      // unit's current `armcomlaser` or not, checking it against the unit
      // registry instead of the weapon one would have called it unknown and
      // reported a live field as dead weight.
      const edits = {
        ...EMPTY_EDITS,
        overrides: { armcom: { "weapondefs.armcomlaser.range": 320 } },
      };
      expect(check(edits, { units }).findings).toEqual([]);
    });

    it("still reports a key neither registry has ever heard of", () => {
      const edits = {
        ...EMPTY_EDITS,
        overrides: { armcom: { "weapondefs.armcomlaser.notarealfield": 1 } },
      };
      const found = only(check(edits, { units }));
      expect(found).toMatchObject({
        id: "overrides:armcom:weapondefs.armcomlaser.notarealfield:key",
        severity: "review",
      });
    });
  });

  describe("a custom parameter", () => {
    const units = {
      armcom: { customparams: { otherparam: 1 } },
    };
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      overrides: { armcom: { "customparams.deadparam": 5 } },
    };

    it("says nothing while there is no scan to say it from", () => {
      expect(check(edits, { units }).findings).toEqual([]);
    });

    it("says nothing while the scan is still incomplete", () => {
      expect(
        check(edits, { units, customParams: scan({}, { truncated: true }) })
          .findings,
      ).toEqual([]);
    });

    it("says nothing when a gadget may still read it without naming it", () => {
      expect(
        check(edits, { units, customParams: scan({}, { wholeTableFiles: 3 }) })
          .findings,
      ).toEqual([]);
    });

    it("says nothing about a parameter a file still names", () => {
      const named = scan({
        deadparam: {
          sites: [{ file: "a.lua", reads: 1, writes: 0 }],
          files: 1,
        },
      });
      expect(check(edits, { units, customParams: named }).findings).toEqual([]);
    });

    it("reports a parameter a completed scan finds no file naming", () => {
      const found = only(check(edits, { units, customParams: scan() }));
      expect(found).toMatchObject({
        id: "overrides:armcom:customparams.deadparam:key",
        severity: "review",
      });
      expect(found.detail).toContain("No Lua file in Test Game names");
      expect(found.detail).toContain("deadparam");
      expect(found.fix?.apply(edits).overrides).toEqual({ armcom: {} });
    });
  });
});

describe("copies, where there is no safe automatic answer", () => {
  const clone = (over: Partial<CompatInput["edits"]["clones"][string]> = {}) =>
    ({
      ...EMPTY_EDITS,
      clones: {
        supercom: {
          key: "supercom",
          source: "armcom",
          replacesGameUnit: false,
          def: {},
          ...over,
        },
      },
    }) as GameEdits;

  it("reports a copy whose parent unit has gone, and offers nothing", () => {
    const found = only(check(clone()));
    expect(found).toMatchObject({
      id: "clones:supercom:source",
      severity: "review",
    });
    expect(found.fix).toBeUndefined();
  });

  it("reports a copy the game has since grown a unit of its own name for", () => {
    const report = check(clone(), { units: { armcom: {}, supercom: {} } });
    const found = report.findings.find(
      (f) => f.id === "clones:supercom:collides",
    );
    expect(found).toMatchObject({ severity: "broken" });
    expect(found?.fix).toBeUndefined();
    expect(found?.detail).toContain("Rename the copy");
  });

  it("reports a stand-in whose unit the game has dropped", () => {
    const edits = clone({ replacesGameUnit: true });
    const report = check(edits, { units: { armcom: {} } });
    expect(ids(report)).toEqual(["clones:supercom:orphaned"]);
    expect(report.findings[0].fix).toBeUndefined();
  });

  it("reports a mount naming a weapondef nothing defines any more", () => {
    const edits = clone({
      source: undefined,
      def: { weapons: [{ name: "armcom_armcomlaser" }] },
    });
    const found = only(check(edits));
    expect(found).toMatchObject({
      id: "clones:supercom:weapons",
      severity: "broken",
    });
    expect(found.detail).toContain("armcom_armcomlaser");
    expect(found.fix).toBeUndefined();
  });

  it("accepts a mount the copy carries itself behind the game's prefix", () => {
    const edits = clone({
      source: undefined,
      def: {
        weapons: [{ name: "armcom_armcomlaser" }],
        weapondefs: { armcomlaser: { range: 300 } },
      },
    });
    expect(check(edits).findings).toEqual([]);
  });

  it("accepts a mount the game's shared table still has", () => {
    const edits = clone({
      source: undefined,
      def: { weapons: [{ name: "armcom_armcomlaser" }] },
    });
    const input = { weaponDefs: { armcom_armcomlaser: { range: 300 } } };
    expect(check(edits, input).findings).toEqual([]);
  });
});

describe("build menus", () => {
  it("drops a whole menu whose builder has gone", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      menus: {
        armlab: [{ op: "add", unit: "armpw" }],
        corlab: [{ op: "remove", unit: "corak" }],
      },
    };
    const found = only(
      check(edits, { units: { armlab: {}, armpw: {}, corak: {} } }),
    );
    expect(found).toMatchObject({ id: "menus:corlab", severity: "broken" });
    expect(found.fix?.cost).toBe("1 build menu change");
    expect(Object.keys(found.fix?.apply(edits).menus ?? {})).toEqual([
      "armlab",
    ]);
  });

  it("drops only the operations naming units that have gone", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      menus: {
        armlab: [
          { op: "add", unit: "armpw" },
          { op: "remove", unit: "corak" },
        ],
      },
    };
    const found = only(check(edits, { units: { armlab: {}, armpw: {} } }));
    expect(found).toMatchObject({
      id: "menus:armlab:units",
      severity: "broken",
    });
    expect(found.detail).toContain("corak");
    expect(found.fix?.apply(edits).menus).toEqual({
      armlab: [{ op: "add", unit: "armpw" }],
    });
  });

  it("takes the builder away when nothing survives the drop", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      menus: { armlab: [{ op: "add", unit: "corak" }] },
    };
    const found = only(check(edits, { units: { armlab: {} } }));
    expect(found.fix?.apply(edits).menus).toEqual({});
  });

  it("reports a move whose landmark has gone, and offers nothing", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      menus: { armlab: [{ op: "move", unit: "armpw", before: "corak" }] },
    };
    const report = check(edits, { units: { armlab: {}, armpw: {} } });
    expect(ids(report)).toEqual(["menus:armlab:landmarks"]);
    expect(report.findings[0].detail).toContain("on the end of the menu");
    expect(report.findings[0].fix).toBeUndefined();
  });

  it("says nothing about a move to the end of the menu", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      menus: { armlab: [{ op: "move", unit: "armpw", before: null }] },
    };
    expect(check(edits, { units: { armlab: {}, armpw: {} } }).findings).toEqual(
      [],
    );
  });
});

describe("the report as a whole", () => {
  it("leads with what is broken and counts the two severities apart", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      disabled: ["corak"],
      clones: {
        supercom: {
          key: "supercom",
          source: "armcom",
          replacesGameUnit: false,
          def: {},
        },
      },
    };
    const report = check(edits);
    expect(ids(report)).toEqual(["disabled:corak", "clones:supercom:source"]);
    expect(report.findings.map((f) => f.severity)).toEqual([
      "broken",
      "review",
    ]);
    expect(report.broken).toBe(1);
    expect(report.review).toBe(1);
  });

  it("does not offer a fix that reaches into another store", () => {
    const edits: GameEdits = {
      ...EMPTY_EDITS,
      disabled: ["corak"],
      overrides: { armpw: { maxdamage: 1 } },
      text: { armpw: { en: { name: "Peewee" } } },
    };
    const fixed = only(check(edits, { units: { armpw: {} } })).fix?.apply(
      edits,
    );
    expect(fixed?.overrides).toBe(edits.overrides);
    expect(fixed?.text).toBe(edits.text);
    expect(fixed?.clones).toBe(edits.clones);
    expect(fixed?.menus).toBe(edits.menus);
  });

  it("shares one object when a project still holds together", () => {
    expect(check(EMPTY_EDITS)).toBe(check(EMPTY_EDITS));
  });
});

/**
 * Real Balanced Annihilation V15.9.8 definitions, three units out of its 379,
 * exactly as `coilbox-unitsync-worker --unit-defs` returned them on 8 September
 * 2026. Kept verbatim rather than tidied: the whole value of this half of the
 * file is that nobody here chose the key names, the casing or the nesting.
 *
 * Regenerate by running the worker against the game and taking the same three
 * units and the weapondefs they mount:
 *
 *   coilbox-unitsync-worker --lib <engine>/libunitsync.dylib \
 *     --datadir ~/.spring --unit-defs --game "Balanced Annihilation V15.9.8"
 */
const BA = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "ba-units-slice.json"), "utf8"),
) as { units: CompatInput["units"]; weaponDefs: CompatInput["weaponDefs"] };

describe("against real Balanced Annihilation definitions", () => {
  const game = { units: BA.units, weaponDefs: BA.weaponDefs, gameName: "BA" };

  it("has the shape the rules assume", () => {
    // Not a check of this module so much as of the belief it rests on. If a
    // future worker change lowercases differently, hoists weapondefs, or names
    // a mount under `def` rather than `name`, this fails here rather than by
    // quietly reporting a healthy project as broken.
    expect(Object.keys(BA.units).sort()).toEqual(["armcom", "armlab", "corak"]);
    expect(BA.units.armcom.weapondefs).toHaveProperty("armcomlaser");
    expect(BA.units.armcom.weapons).toEqual([
      { name: "armcom_armcomlaser", onlytargetcategory: "NOTSUB" },
      { badtargetcategory: "VTOL", name: "armcom_armcomsealaser" },
      { name: "armcom_arm_disintegrator", onlytargetcategory: "NOTSUB" },
    ]);
    expect(BA.weaponDefs).toHaveProperty("armcom_armcomlaser");
  });

  /** What Tom's own saved project holds, plus edits against real field paths. */
  const project: GameEdits = {
    overrides: {
      armcom: {
        maxdamage: 5000,
        "weapondefs.armcomlaser.range": 320,
        "customparams.paralyzemultiplier": 0.05,
        "sounds.build": "nanlath2",
      },
    },
    clones: {
      supercom: {
        key: "supercom",
        source: "armcom",
        replacesGameUnit: false,
        def: {
          ...BA.units.armcom,
          weapons: [{ name: "armcom_armcomlaser" }],
        },
      },
    },
    menus: { armlab: [{ op: "add", unit: "corak" }] },
    text: { corak: { en: { name: "Gator" } } },
    disabled: ["corak"],
  };

  it("reports nothing against the game the project was written for", () => {
    expect(checkCompatibility({ edits: project, ...game }).findings).toEqual(
      [],
    );
  });

  it("says nothing about a real custom parameter a scan still finds a reader for", () => {
    const customParams = {
      params: {
        paralyzemultiplier: {
          sites: [
            { file: "luarules/gadgets/unit_paralyze.lua", reads: 2, writes: 0 },
          ],
          files: 1,
        },
      },
      wholeTableFiles: 0,
      filesScanned: 900,
      truncated: false,
      errors: [],
    };
    expect(
      checkCompatibility({ edits: project, ...game, customParams }).findings,
    ).toEqual([]);
  });

  it("reports a real custom parameter once a completed scan finds nothing naming it", () => {
    const customParams = {
      params: {},
      wholeTableFiles: 0,
      filesScanned: 900,
      truncated: false,
      errors: [],
    };
    const report = checkCompatibility({
      edits: project,
      ...game,
      customParams,
    });
    expect(ids(report)).toEqual([
      "overrides:armcom:customparams.paralyzemultiplier:key",
    ]);
    expect(report.findings[0].detail).toContain("paralyzemultiplier");
  });

  it("finds every reference to a unit the game has dropped", () => {
    const without = { ...BA.units } as CompatInput["units"];
    delete without.corak;
    const report = checkCompatibility({
      edits: project,
      ...game,
      units: without,
    });
    expect(ids(report)).toEqual([
      "menus:armlab:units",
      "text:corak",
      "disabled:corak",
    ]);
    expect(report.broken).toBe(3);
    expect(report.review).toBe(0);
  });

  it("finds a real weapondef path the game has stopped declaring", () => {
    const armcom = { ...BA.units.armcom };
    armcom.weapondefs = { armcomsealaser: {}, arm_disintegrator: {} };
    const report = checkCompatibility({
      edits: project,
      ...game,
      units: { ...BA.units, armcom },
    });
    expect(ids(report)).toEqual([
      "overrides:armcom:weapondefs.armcomlaser.range",
    ]);
  });

  it("finds a copy whose mounted weapon the game has stopped defining", () => {
    const weaponDefs = { ...BA.weaponDefs };
    delete weaponDefs.armcom_armcomlaser;
    const bare = {
      ...project,
      clones: {
        supercom: {
          ...project.clones.supercom,
          def: { weapons: [{ name: "armcom_armcomlaser" }] },
        },
      },
    };
    const report = checkCompatibility({ edits: bare, ...game, weaponDefs });
    expect(ids(report)).toEqual(["clones:supercom:weapons"]);
    expect(report.findings[0].detail).toContain("armcom_armcomlaser");
  });
});
