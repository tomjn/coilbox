import { describe, expect, it } from "vitest";
import { mapNameFromDir } from "./mapName";

describe("mapNameFromDir", () => {
  it("uses the folder name for a bare .smf's folder", () => {
    expect(mapNameFromDir("/home/me/maps-work/Lava")).toBe("Lava");
  });

  it("strips a -decompiled suffix", () => {
    expect(mapNameFromDir("/home/me/Lava-decompiled")).toBe("Lava");
  });

  it("uses the archive name for the inner maps folder of an extracted archive", () => {
    expect(mapNameFromDir("/home/me/Lava_v2.sdd/maps")).toBe("Lava_v2");
  });

  it("handles Windows separators and a trailing separator", () => {
    expect(mapNameFromDir("C:\\Maps\\Lava_v2.sdd\\maps\\")).toBe("Lava_v2");
  });

  it("matches the sdd extension and maps folder case-insensitively", () => {
    expect(mapNameFromDir("/home/me/Lava.SDD/Maps")).toBe("Lava");
  });

  it("keeps a maps folder that is not inside a .sdd folder", () => {
    expect(mapNameFromDir("/home/me/maps")).toBe("maps");
  });
});
