import { describe, expect, it } from "vitest";
import { isDeletableArchive, isEditInPlaceEligible } from "./format";

describe("isDeletableArchive", () => {
  it("accepts downloaded games, maps and rapid packages", () => {
    expect(isDeletableArchive("/data/spring/games/bar.sd7")).toBe(true);
    expect(isDeletableArchive("/data/spring/maps/Comet Catcher.sdz")).toBe(
      true,
    );
    expect(isDeletableArchive("/data/spring/games/dev.sdd")).toBe(true);
    expect(isDeletableArchive("C:\\spring\\packages\\abc123.sdp")).toBe(true);
  });

  it("is case-insensitive on both the folder and the extension", () => {
    expect(isDeletableArchive("/data/spring/Maps/Comet.SD7")).toBe(true);
  });

  it("rejects the engine's base archives", () => {
    expect(
      isDeletableArchive(
        "C:\\Users\\me\\engine\\104.0\\base\\springcontent.sdz",
      ),
    ).toBe(false);
    expect(isDeletableArchive("/opt/engine/105/base/maphelper.sdz")).toBe(
      false,
    );
  });

  it("rejects anything that is not an archive", () => {
    expect(isDeletableArchive("/data/spring/games/readme.txt")).toBe(false);
    expect(isDeletableArchive("/data/spring/games/noext")).toBe(false);
    expect(isDeletableArchive("bar.sd7")).toBe(false);
    expect(isDeletableArchive(null)).toBe(false);
    expect(isDeletableArchive(undefined)).toBe(false);
  });
});

describe("isEditInPlaceEligible", () => {
  it("accepts a loose .sdd directly under a content root's games folder", () => {
    expect(isEditInPlaceEligible("/data/spring/games/dev.sdd")).toBe(true);
    expect(isEditInPlaceEligible("C:\\spring\\games\\dev.sdd")).toBe(true);
  });

  it("is case-insensitive on both the folder and the extension", () => {
    expect(isEditInPlaceEligible("/data/spring/Games/dev.SDD")).toBe(true);
  });

  it("rejects a packed archive, even one under games", () => {
    expect(isEditInPlaceEligible("/data/spring/games/bar.sd7")).toBe(false);
    expect(isEditInPlaceEligible("/data/spring/games/bar.sdz")).toBe(false);
  });

  it("rejects a .sdd that is not directly under a games folder", () => {
    expect(isEditInPlaceEligible("/data/spring/maps/dev.sdd")).toBe(false);
    expect(isEditInPlaceEligible("/data/spring/games/nested/dev.sdd")).toBe(
      false,
    );
  });

  it("rejects a missing or unresolved path", () => {
    expect(isEditInPlaceEligible(null)).toBe(false);
    expect(isEditInPlaceEligible(undefined)).toBe(false);
    expect(isEditInPlaceEligible("")).toBe(false);
  });
});
