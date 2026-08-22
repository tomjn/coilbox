import { describe, expect, it } from "vitest";

import type { LegoTexture } from "./model";
import { maskLoss, maskLossNote } from "./textureMask";

const png = (source?: string): LegoTexture => ({
  key: "aa11.png",
  name: "Beacon_1.tga",
  ...(source ? { source } : {}),
});

describe("maskLoss", () => {
  it("offers a refresh for a stripped texture with a file behind it", () => {
    expect(maskLoss(png("/game/unittextures/Beacon_1.tga"), false)).toBe(
      "refresh",
    );
  });

  it("asks for a re-import when there is no file to re-read", () => {
    // A unit out of a packed archive. Its texture was unpacked into a temp
    // folder to be read and the archive holds no path to hand back (#1903).
    expect(maskLoss(png(), false)).toBe("reimport");
  });

  it("says nothing about a texture that kept its alpha", () => {
    expect(maskLoss(png("/game/unittextures/Beacon_1.tga"), true)).toBeNull();
  });

  it("says nothing when the header could not be read", () => {
    // Not a format textureAlpha reads is a reason to trust the file: the engine
    // paints from that alpha whatever the file is.
    expect(maskLoss(png("/x.tga"), undefined)).toBeNull();
  });

  it("leaves a .dds with no alpha alone", () => {
    // Stored as it arrived, so its missing alpha is the game's own file telling
    // the truth about itself rather than a hole coilbox punched.
    const dds: LegoTexture = {
      key: "bb22.dds",
      name: "Beacon_1.dds",
      source: "/game/unittextures/Beacon_1.dds",
    };

    expect(maskLoss(dds, false)).toBeNull();
  });

  it("says nothing about a unit with no texture at all", () => {
    expect(maskLoss(undefined, false)).toBeNull();
  });
});

describe("maskLossNote", () => {
  it("names the fix that is one click away", () => {
    expect(maskLossNote("refresh")).toContain("Refresh");
  });

  it("says a packed unit has to be imported again", () => {
    const note = maskLossNote("reimport");

    expect(note).toContain("importing the unit again");
    expect(note).not.toContain("Refresh");
  });

  it("has nothing to say about a healthy texture", () => {
    expect(maskLossNote(null)).toBeNull();
  });
});
