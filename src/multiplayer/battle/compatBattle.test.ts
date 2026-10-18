import { describe, expect, it } from "vitest";
import {
  classifyCompatBattle,
  compatBuildable,
  compatLaunchBlock,
  isCompatContentName,
  parseCompatGameName,
  requiredGameName,
} from "./compatBattle";

const game = (name: string, archive = `${name}.sd7`) => ({
  name,
  primaryArchive: { name: archive },
});

describe("parseCompatGameName", () => {
  it("reads the base game and version out of a mutator's name", () => {
    expect(parseCompatGameName("XTA 9.65 (compat 4)")).toEqual({
      baseName: "XTA 9.65",
      version: 4,
    });
  });

  it("keeps a base name that has brackets of its own", () => {
    expect(
      parseCompatGameName("Total Annihilation (Kernel) (compat 12)"),
    ).toEqual({ baseName: "Total Annihilation (Kernel)", version: 12 });
  });

  it("leaves any other name alone", () => {
    for (const name of [
      "XTA 9.65",
      "XTA 9.65 (compat)",
      "XTA 9.65 (compat 04)",
      "XTA 9.65 (compat x)",
      "(compat 4)",
      "XTA 9.65 (compat 4) extra",
      "",
    ]) {
      expect(parseCompatGameName(name), name).toBeNull();
    }
  });
});

describe("classifyCompatBattle", () => {
  const xta = game("XTA 9.65", "xta-9.65.sd7");

  it("builds the mutator when the base game is installed and the mutator is not", () => {
    expect(classifyCompatBattle("XTA 9.65 (compat 4)", [xta])).toEqual({
      kind: "needs-mutator",
      baseName: "XTA 9.65",
      archiveName: "xta-9.65.sd7",
      version: 4,
    });
  });

  it("asks for the base game when that is missing too", () => {
    expect(
      classifyCompatBattle("XTA 9.65 (compat 4)", [game("Other")]),
    ).toEqual({ kind: "base-missing", baseName: "XTA 9.65" });
  });

  it("does nothing once the mutator is installed", () => {
    const games = [
      xta,
      game("XTA 9.65 (compat 4)", "coilbox-compat-xta-9.65-4.sdd"),
    ];
    expect(classifyCompatBattle("XTA 9.65 (compat 4)", games)).toEqual({
      kind: "none",
    });
  });

  it("leaves a name that is not a mutator's untouched", () => {
    expect(classifyCompatBattle("XTA 9.65", [])).toEqual({ kind: "none" });
    expect(classifyCompatBattle("Zero-K v1.12", [xta])).toEqual({
      kind: "none",
    });
  });
});

describe("requiredGameName", () => {
  const xta = game("XTA 9.65");

  it("is the base game while the mutator is not built", () => {
    expect(requiredGameName("XTA 9.65 (compat 4)", [])).toBe("XTA 9.65");
    expect(requiredGameName("XTA 9.65 (compat 4)", [xta])).toBe("XTA 9.65");
  });

  it("is the battle's own name once the mutator is built, and for any other game", () => {
    const built = game("XTA 9.65 (compat 4)");
    expect(requiredGameName("XTA 9.65 (compat 4)", [xta, built])).toBe(
      "XTA 9.65 (compat 4)",
    );
    expect(requiredGameName("XTA 9.65", [xta])).toBe("XTA 9.65");
  });
});

describe("compatBuildable", () => {
  it("builds a version up to the latest this coilbox carries", () => {
    expect(compatBuildable(4, 5)).toBe("build");
    expect(compatBuildable(5, 5)).toBe("build");
    expect(compatBuildable(1, 5)).toBe("build");
  });

  it("asks for an update when the host's version is newer", () => {
    expect(compatBuildable(6, 5)).toBe("update");
  });
});

describe("isCompatContentName", () => {
  it("recognises a mutator by game name and by archive name", () => {
    expect(isCompatContentName("XTA 9.65 (compat 4)")).toBe(true);
    expect(isCompatContentName("coilbox-compat-xta-9.65-4.sdd")).toBe(true);
  });

  it("does not claim an ordinary game", () => {
    expect(isCompatContentName("XTA 9.65")).toBe(false);
    expect(isCompatContentName("xta-9.65.sd7")).toBe(false);
  });
});

describe("compatLaunchBlock", () => {
  it("says nothing when idle", () => {
    expect(compatLaunchBlock({ status: "idle" })).toBeNull();
  });

  it("says nothing about the older manifest a newer coilbox builds", () => {
    // A host on version 4 and this coilbox on 5 is the "build" decision, which
    // reaches the player only as the Building state.
    const block = compatLaunchBlock({
      status: "building",
      baseName: "XTA 9.65",
      version: 4,
    });
    expect(block?.reason).not.toMatch(/newer|older|update/i);
  });

  it("names the failure", () => {
    const block = compatLaunchBlock({
      status: "failed",
      baseName: "XTA 9.65",
      version: 4,
      error: "disk full",
    });
    expect(block?.reason).toContain("disk full");
  });
});
