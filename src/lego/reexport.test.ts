import { describe, expect, it } from "vitest";

import type { LegoExport } from "./model";
import { derivedFields, receiptDef, writtenDigest } from "./reexport";
import { DERIVED_FIELDS } from "./unitDef";

const DIR = "/games/sf.sdd";

function receipt(
  def: Record<string, unknown>,
  files = [{ path: `${DIR}/units/tank.lua`, sha256: "abc" }],
): LegoExport {
  return { dir: DIR, at: "", unitName: "tank", def, files };
}

describe("writtenDigest", () => {
  it("finds the file the receipt says was written, however the path is spelled", () => {
    const exported = receipt({}, [
      { path: "C:\\Games\\SF.sdd\\scripts\\tank.lua", sha256: "s1" },
    ]);
    expect(
      writtenDigest(exported, "c:/games/sf.sdd/", "scripts/tank.lua"),
    ).toBe("s1");
    expect(writtenDigest(exported, "c:/games/sf.sdd", "units/tank.lua")).toBe(
      null,
    );
    expect(writtenDigest(undefined, DIR, "scripts/tank.lua")).toBe(null);
  });
});

describe("derivedFields", () => {
  it("sends nothing for a first export", () => {
    expect(derivedFields({ footprintx: 2 }, undefined, DIR, "tank")).toBe(null);
  });

  it("sends nothing when the receipt has no record of writing the file", () => {
    const exported = receipt({ footprintx: 2 }, []);
    expect(derivedFields({ footprintx: 3 }, exported, DIR, "tank")).toBe(null);
  });

  it("sends nothing for another folder or another name", () => {
    const exported = receipt({ footprintx: 2 });
    expect(derivedFields({}, exported, "/games/other.sdd", "tank")).toBe(null);
    expect(derivedFields({}, exported, DIR, "rover")).toBe(null);
  });

  it("pairs each derived field's new value with the last export's", () => {
    const exported = receipt({
      footprintx: 2,
      customparams: { unitdefbuildtime: 100 },
      builder: true,
    });
    const fields = derivedFields(
      { footprintx: 3, customparams: { unitdefbuildtime: 250 } },
      exported,
      DIR,
      "tank",
    );
    expect(fields?.map((field) => field.path)).toEqual(DERIVED_FIELDS);
    const byPath = Object.fromEntries(
      (fields ?? []).map((field) => [field.path, field]),
    );
    expect(byPath.footprintx).toEqual({ path: "footprintx", now: 3, last: 2 });
    expect(byPath["customparams.unitdefbuildtime"]).toMatchObject({
      now: 250,
      last: 100,
    });
    expect(byPath.builder).toMatchObject({ now: null, last: true });
    expect(byPath.speed).toMatchObject({ now: null, last: null });
  });
});

describe("receiptDef", () => {
  const before = receipt({
    footprintx: 2,
    speed: 2,
    sightdistance: 0,
    customparams: { unitdefbuildtime: 100 },
  });
  const now = {
    footprintx: 3,
    speed: 2.5,
    sightdistance: 0,
    customparams: { unitdefbuildtime: 250 },
  };

  it("records this build's values for the fields the export wrote", () => {
    const def = receiptDef(now, before, DIR, "tank", {
      unitDefKept: null,
      unitDefFields: [
        { path: "footprintx", change: "updated", was: 2, message: null },
      ],
    });
    expect(def).toEqual(now);
  });

  it("keeps the last value for a field kept because it was edited", () => {
    const def = receiptDef(now, before, DIR, "tank", {
      unitDefKept: null,
      unitDefFields: [
        { path: "speed", change: "kept", was: 4, message: null },
        {
          path: "customparams.unitdefbuildtime",
          change: "refused",
          was: 100,
          message: "no",
        },
      ],
    });
    expect(def).toEqual({
      ...now,
      speed: 2,
      customparams: { unitdefbuildtime: 100 },
    });
  });

  it("keeps every last value when the whole file was left alone", () => {
    const def = receiptDef({ ...now, builder: true }, before, DIR, "tank", {
      unitDefKept: { reason: "workshopBackup" },
      unitDefFields: [],
    });
    expect(def).toEqual({
      footprintx: 2,
      speed: 2,
      sightdistance: 0,
      customparams: { unitdefbuildtime: 100 },
    });
  });

  it("records the build's definition when there is no earlier receipt", () => {
    const def = receiptDef(now, undefined, DIR, "tank", {
      unitDefKept: { reason: "notOurs" },
      unitDefFields: [],
    });
    expect(def).toEqual(now);
  });
});
