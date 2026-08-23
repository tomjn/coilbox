import { describe, expect, it } from "vitest";
import { engineLabel, isRealEngineVersion } from "./engineVersion";

describe("engineLabel", () => {
  it("names an engine by its version", () => {
    expect(
      engineLabel({ version: "105.1.1", path: "/data/engine/105.1.1" }),
    ).toBe("105.1.1");
  });

  it("prefers the version unitsync reported over the folder name", () => {
    expect(
      engineLabel({
        version: "105.1.1",
        syncVersion: "105.1.1-2554-gabcdef BAR105",
        path: "/data/engine/105.1.1",
      }),
    ).toBe("105.1.1-2554-gabcdef BAR105");
  });

  // A hand-assembled install sitting directly in a data root has no version to
  // read, and every engine in the picker still has to be tellable apart.
  it("falls back to the folder for an engine with no version", () => {
    expect(engineLabel({ version: "", path: "/Users/tomjn/.spring" })).toBe(
      "/Users/tomjn/.spring",
    );
  });

  it("falls back to the folder for a leaked path fragment", () => {
    expect(
      engineLabel({ version: ".spring", path: "/Users/tomjn/.spring" }),
    ).toBe("/Users/tomjn/.spring");
  });
});

describe("isRealEngineVersion", () => {
  it("accepts a real version string", () => {
    expect(isRealEngineVersion("105.1.1-2554-gabcdef")).toBe(true);
  });

  it("rejects undefined", () => {
    expect(isRealEngineVersion(undefined)).toBe(false);
  });

  it("rejects an empty or blank string", () => {
    expect(isRealEngineVersion("")).toBe(false);
    expect(isRealEngineVersion("   ")).toBe(false);
  });

  it("rejects a dot-prefixed path fragment such as the legacy .spring", () => {
    expect(isRealEngineVersion(".spring")).toBe(false);
  });
});
