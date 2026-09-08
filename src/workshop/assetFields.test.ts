import { describe, expect, it } from "vitest";
import { assetIndex } from "@/content/assetKinds";
import { assetFieldOf, assetState, deriveAssetFields } from "./assetFields";
import { type FieldRow, unitFieldView } from "./unitSections";

const listing = (...paths: string[]) =>
  assetIndex(paths.map((path) => ({ path, size: 1 })));

/** A cut of Beyond All Reason's archive, with the folders each field lands in. */
const index = listing(
  "objects3d/Units/ARMAAK.s3o",
  "objects3d/armcom_dead.3do",
  "scripts/Units/ARMAAK.cob",
  "unitpics/ARMAAK.DDS",
  "unittextures/arm_normal.dds",
  "unittextures/decals/armaak_aoplane.dds",
);

/**
 * The row the page would draw for one key of a definition.
 *
 * Taken through `unitFieldView` rather than assembled here, because the join
 * this has to survive is the one the page makes: a definition's keys arrive from
 * `gamedata/defs.lua` lowercased, so the key is `objectname` while the note that
 * describes it is filed under the engine's `objectName`.
 */
function row(key: string, value: unknown): FieldRow {
  const view = unitFieldView({ [key]: value }, {}, "armaak", "relevant");
  for (const group of view.groups)
    for (const section of group.sections)
      for (const found of section.rows) if (found.path === key) return found;
  throw new Error(`no row drawn for ${key}`);
}

describe("which fields hold a path", () => {
  it("takes the described fields from the notes, not from the data", () => {
    // Nothing in this archive is named "nothing.s3o", and the field is still a
    // model field: a game with a broken path has not stopped having a model.
    const found = assetFieldOf(row("objectname", "nothing.s3o"), new Map());
    expect(found?.kind.id).toBe("model");
    expect(found?.root).toBe("objects3d");
    expect(found?.declared).toBe(true);
  });

  it("describes script and build picture too, each under its own folder", () => {
    expect(assetFieldOf(row("script", "x"), new Map())?.root).toBe("scripts");
    expect(assetFieldOf(row("buildpic", "x"), new Map())?.root).toBe(
      "unitpics",
    );
  });

  it("leaves the map icon alone, because it names a table entry not a file", () => {
    expect(assetFieldOf(row("icontype", "armaak"), new Map())).toBeUndefined();
  });

  it("reads a key only the game declares out of the game's own values", () => {
    const derived = deriveAssetFields(
      {
        armaak: { customparams: { normaltex: "unittextures/arm_normal.dds" } },
        armaap: { customparams: { normaltex: "unittextures/arm_normal.dds" } },
      },
      index,
    );
    const found = assetFieldOf(
      row("customparams.normaltex", "unittextures/arm_normal.dds"),
      derived,
    );
    expect(found?.kind.id).toBe("picture");
    expect(found?.root).toBe("");
    expect(found?.declared).toBe(false);
  });

  it("works out the folder a game writes its values relative to", () => {
    const derived = deriveAssetFields(
      {
        armaak: {
          customparams: {
            buildinggrounddecaltype: "decals/armaak_aoplane.dds",
          },
        },
      },
      index,
    );
    expect(derived.get("customparams.buildinggrounddecaltype")?.root).toBe(
      "unittextures",
    );
  });

  it("does not read a definition name as a path", () => {
    // `corpse` names a feature definition. objects3d/armcom_dead.3do exists and
    // must not turn this into a model field.
    const derived = deriveAssetFields(
      { armcom: { corpse: "ARMCOM_DEAD", explodeas: "COMMANDER_BLAST" } },
      index,
    );
    expect(derived.size).toBe(0);
  });

  it("does not read a number as a path", () => {
    const derived = deriveAssetFields(
      { armcom: { customparams: { kickback: "-6.25" } } },
      index,
    );
    expect(derived.size).toBe(0);
  });

  it("folds a weapon mount's index, so three mounts are one field", () => {
    const derived = deriveAssetFields(
      {
        armaak: {
          weapons: [
            { customtex: "unittextures/arm_normal.dds" },
            { customtex: "unittextures/arm_normal.dds" },
          ],
        },
      },
      index,
    );
    expect([...derived.keys()]).toEqual(["weapons.*.customtex"]);
  });

  it("says nothing at all before the archive listing lands", () => {
    expect(deriveAssetFields({ armaak: {} }, listing()).size).toBe(0);
  });
});

describe("whether a value points at anything", () => {
  const model = assetFieldOf(row("objectname", "x"), new Map());

  it("reports the member a good value names", () => {
    if (!model) throw new Error("objectname should be a model field");
    expect(assetState(index, model, "Units/ARMAAK.s3o")?.member).toBe(
      "objects3d/Units/ARMAAK.s3o",
    );
  });

  it("reports a value with nothing behind it, which is the typo to catch", () => {
    if (!model) throw new Error("objectname should be a model field");
    const state = assetState(index, model, "Units/ARMAAQ.s3o");
    expect(state?.written).toBe("Units/ARMAAQ.s3o");
    expect(state?.member).toBeUndefined();
  });

  it("says nothing about a field with nothing written in it", () => {
    if (!model) throw new Error("objectname should be a model field");
    expect(assetState(index, model, undefined)).toBeUndefined();
    expect(assetState(index, model, "")).toBeUndefined();
  });
});
