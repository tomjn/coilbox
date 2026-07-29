import { describe, expect, it } from "vitest";

import { buildModInfo, isScratchArchive, SCRATCH_FOLDER } from "./scratchGame";

describe("buildModInfo", () => {
  it("declares itself a launchable game", () => {
    expect(buildModInfo("Balanced Annihilation V7.11")).toContain(
      "modtype = 1",
    );
  });

  it("depends on the base game by the exact name unitsync reports", () => {
    const lua = buildModInfo("Balanced Annihilation V7.11");

    expect(lua).toContain('"Balanced Annihilation V7.11",');
    expect(lua).toContain("depend = {");
  });

  it("escapes a quote in the base game name so the file still parses", () => {
    expect(buildModInfo('Some "Game"')).toContain('"Some \\"Game\\"",');
  });

  it("gives the same output for the same base game, every time", () => {
    expect(buildModInfo("BAR")).toBe(buildModInfo("BAR"));
  });

  it("ends with exactly one newline", () => {
    const lua = buildModInfo("BAR");

    expect(lua.endsWith("\n")).toBe(true);
    expect(lua.endsWith("\n\n")).toBe(false);
  });
});

describe("isScratchArchive", () => {
  it("matches the scratch folder whatever its case on disk", () => {
    expect(isScratchArchive(SCRATCH_FOLDER)).toBe(true);
    expect(isScratchArchive(SCRATCH_FOLDER.toUpperCase())).toBe(true);
  });

  it("does not match a real game archive", () => {
    expect(isScratchArchive("ba1211.sdz")).toBe(false);
    expect(isScratchArchive("mygame.sdd")).toBe(false);
  });
});
