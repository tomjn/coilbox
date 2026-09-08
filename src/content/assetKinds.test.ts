/**
 * The cases here are real. Balanced Annihilation writes `objectname = "ARMCOM"`
 * and ships `objects3d/armcom.3do`. Beyond All Reason writes
 * `objectname = "Units/ARMAAK.s3o"` and ships `objects3d/Units/ARMAAK.s3o`. Both
 * spellings are the same field, so both have to resolve.
 */
import { describe, expect, it } from "vitest";
import {
  ASSET_KINDS,
  assetChoices,
  assetIndex,
  assetKindOfPath,
  assetValue,
  locateAsset,
  resolveAsset,
} from "./assetKinds";

const listing = (...paths: string[]) =>
  assetIndex(paths.map((path) => ({ path, size: 1 })));

const bar = listing(
  "objects3d/Units/ARMAAK.s3o",
  "objects3d/Units/ARMAAP.s3o",
  "objects3d/hats/arm_leftshoulder.s3o",
  "scripts/Units/ARMAAP.cob",
  "scripts/blank.cob",
  "unitpics/ARMAAK.DDS",
  "unittextures/arm_normal.dds",
  "unittextures/decals/armaap_aoplane.dds",
  "gamedata/icontypes.lua",
);

const ba = listing(
  "objects3d/armcom.3do",
  "objects3d/armcom_dead.3do",
  "scripts/armcom.bos",
  "scripts/armcom.cob",
  "unitpics/armcom.dds",
  "units/armcom.lua",
);

describe("resolving a written value", () => {
  it("finds a model named with a folder and an extension", () => {
    expect(
      resolveAsset(bar, ASSET_KINDS.model, "objects3d", "Units/ARMAAK.s3o"),
    ).toBe("objects3d/Units/ARMAAK.s3o");
  });

  it("finds a model named with neither, by appending what the engine would", () => {
    expect(resolveAsset(ba, ASSET_KINDS.model, "objects3d", "ARMCOM")).toBe(
      "objects3d/armcom.3do",
    );
  });

  it("matches without regard to case, which is how the games are written", () => {
    expect(
      resolveAsset(bar, ASSET_KINDS.picture, "unitpics", "armaak.dds"),
    ).toBe("unitpics/ARMAAK.DDS");
  });

  it("finds a script under scripts/", () => {
    expect(
      resolveAsset(bar, ASSET_KINDS.script, "scripts", "Units/ARMAAP.cob"),
    ).toBe("scripts/Units/ARMAAP.cob");
  });

  it("takes a whole member path as well, which the model loader accepts", () => {
    expect(
      resolveAsset(
        bar,
        ASSET_KINDS.model,
        "objects3d",
        "objects3d/Units/ARMAAK.s3o",
      ),
    ).toBe("objects3d/Units/ARMAAK.s3o");
  });

  it("reports nothing for a path the archive does not hold", () => {
    expect(
      resolveAsset(bar, ASSET_KINDS.model, "objects3d", "Units/ARMAAQ.s3o"),
    ).toBeUndefined();
  });

  it("reports nothing for an empty value, which is not a broken path", () => {
    expect(
      resolveAsset(bar, ASSET_KINDS.model, "objects3d", "  "),
    ).toBeUndefined();
  });

  it("leaves an extension the kind does not read alone, as the engine does", () => {
    // The engine only appends an extension when there is none at all, so this
    // is looked for verbatim under objects3d/ and is not there.
    expect(
      resolveAsset(bar, ASSET_KINDS.model, "objects3d", "arm_normal.dds"),
    ).toBeUndefined();
  });
});

describe("what a picker offers and writes", () => {
  it("offers the files of the right kind under the field's folder", () => {
    expect(
      assetChoices(bar, ASSET_KINDS.model, "objects3d").map((f) => f.path),
    ).toEqual([
      "objects3d/Units/ARMAAK.s3o",
      "objects3d/Units/ARMAAP.s3o",
      "objects3d/hats/arm_leftshoulder.s3o",
    ]);
  });

  it("leaves out a .bos, which is a script's source rather than a script", () => {
    expect(
      assetChoices(ba, ASSET_KINDS.script, "scripts").map((f) => f.path),
    ).toEqual(["scripts/armcom.cob"]);
  });

  it("writes the path with the field's own folder taken off", () => {
    expect(assetValue("objects3d", "objects3d/Units/ARMAAK.s3o")).toBe(
      "Units/ARMAAK.s3o",
    );
    expect(assetValue("", "unittextures/arm_normal.dds")).toBe(
      "unittextures/arm_normal.dds",
    );
  });

  it("round-trips: what it writes is what it resolves", () => {
    const member = "objects3d/Units/ARMAAK.s3o";
    const written = assetValue("objects3d", member);
    expect(resolveAsset(bar, ASSET_KINDS.model, "objects3d", written)).toBe(
      member,
    );
  });
});

describe("recognising a path by its extension alone", () => {
  it("knows which kind an extension belongs to", () => {
    expect(assetKindOfPath("a/b.s3o")).toBe("model");
    expect(assetKindOfPath("a/b.cob")).toBe("script");
    expect(assetKindOfPath("a/b.DDS")).toBe("picture");
    expect(assetKindOfPath("armcom")).toBeUndefined();
    expect(assetKindOfPath("a/b.bos")).toBeUndefined();
  });

  it("locates a value written from the archive root", () => {
    expect(locateAsset(bar, "unittextures/arm_normal.dds")).toEqual({
      kind: "picture",
      root: "",
    });
  });

  it("locates a value written relative to a folder, and says which folder", () => {
    expect(locateAsset(bar, "decals/armaap_aoplane.dds")).toEqual({
      kind: "picture",
      root: "unittextures",
    });
  });

  it("ignores a value with no extension, however well its name matches", () => {
    // Balanced Annihilation's corpse field names a feature definition, and
    // objects3d/armcom_dead.3do is a real file it would otherwise be read as.
    expect(locateAsset(ba, "ARMCOM_DEAD")).toBeUndefined();
  });

  it("ignores a number that ends in something extension-shaped", () => {
    expect(locateAsset(bar, "-6.25")).toBeUndefined();
  });
});
