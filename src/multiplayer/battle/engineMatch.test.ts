import { describe, expect, it } from "vitest";
import { engineMatch } from "./engineMatch";

const host = { engine: "Recoil", version: "2026.03.01" };

describe("engineMatch", () => {
  it("matches when the verified engine reports the host's version", () => {
    const m = engineMatch(host, { syncVersion: "2026.03.01" });
    expect(m.verdict).toBe("match");
    expect(m.hostLabel).toBe("Recoil 2026.03.01");
    expect(m.mineLabel).toBe("2026.03.01");
  });

  it("flags a verified engine that reports another version", () => {
    const m = engineMatch(host, { syncVersion: "2025.06.20" });
    expect(m.verdict).toBe("mismatch");
    expect(m.mineLabel).toBe("2025.06.20");
  });

  it("ignores whitespace around either version", () => {
    const m = engineMatch(
      { engine: "Recoil", version: " 2026.03.01 " },
      { syncVersion: "2026.03.01" },
    );
    expect(m.verdict).toBe("match");
  });

  it("never reads a folder name as a version, even one that looks right", () => {
    const m = engineMatch(host, {});
    expect(m.verdict).toBe("unverified");
    expect(m.mineLabel).toBeNull();
  });

  it("has no verdict without an engine", () => {
    const m = engineMatch(host, null);
    expect(m.verdict).toBe("none");
    expect(m.mineLabel).toBeNull();
  });

  it("has no verdict when the lobby never said the host's version", () => {
    const m = engineMatch(
      { engine: "", version: "" },
      { syncVersion: "2026.03.01" },
    );
    expect(m.verdict).toBe("unknown");
    expect(m.hostLabel).toBeNull();
  });
});
