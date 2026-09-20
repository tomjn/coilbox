import { describe, expect, it } from "vitest";
import { engineMatch } from "./engineMatch";

const host = { engine: "Recoil", version: "2026.03.01" };

describe("engineMatch", () => {
  it("matches when the verified engine reports the host's version", () => {
    const m = engineMatch(host, {
      engineVersion: "recoil_2026.03.01",
      syncVersion: "2026.03.01",
    });
    expect(m.verdict).toBe("match");
    expect(m.hostLabel).toBe("Recoil 2026.03.01");
    expect(m.mineLabel).toBe("2026.03.01");
  });

  it("flags a verified engine that reports another version", () => {
    const m = engineMatch(host, {
      engineVersion: "2025.06.20",
      syncVersion: "2025.06.20",
    });
    expect(m.verdict).toBe("mismatch");
    expect(m.mineLabel).toBe("2025.06.20");
  });

  it("ignores whitespace around either version", () => {
    const m = engineMatch(
      { engine: "Recoil", version: " 2026.03.01 " },
      { engineVersion: "x", syncVersion: "2026.03.01" },
    );
    expect(m.verdict).toBe("match");
  });

  it("trusts a folder name that equals the host's version", () => {
    const m = engineMatch(host, { engineVersion: "2026.03.01" });
    expect(m.verdict).toBe("match");
  });

  it("will not call an unverified engine wrong from its folder name", () => {
    const m = engineMatch(host, {
      engineVersion: "recoil_2026.03.01_amd64-linux",
    });
    expect(m.verdict).toBe("unverified");
    expect(m.mineLabel).toBe("recoil_2026.03.01_amd64-linux");
  });

  it("has no verdict without an engine", () => {
    const m = engineMatch(host, null);
    expect(m.verdict).toBe("none");
    expect(m.mineLabel).toBeNull();
  });

  it("has no verdict when the lobby never said the host's version", () => {
    const m = engineMatch(
      { engine: "", version: "" },
      { engineVersion: "2026.03.01", syncVersion: "2026.03.01" },
    );
    expect(m.verdict).toBe("unknown");
    expect(m.hostLabel).toBeNull();
  });
});
