import { describe, expect, it } from "vitest";
import type { RuntimeMarker } from "./bindings";
import { runtimeInstallState } from "./install";

const marker = (version: number): RuntimeMarker => ({
  version,
  schemaVersion: 1,
  conditions: [],
  actions: [],
});

describe("runtimeInstallState", () => {
  it("has nothing to offer when coilbox ships no runtime", () => {
    expect(runtimeInstallState(marker(1), null)).toBe("unavailable");
    expect(runtimeInstallState(null, null)).toBe("unavailable");
  });

  it("offers an install to a game that has not adopted the runtime", () => {
    expect(runtimeInstallState(null, marker(1))).toBe("missing");
  });

  it("offers an update to a game vendoring an older runtime", () => {
    expect(runtimeInstallState(marker(1), marker(2))).toBe("outdated");
  });

  it("calls a matching pair current", () => {
    expect(runtimeInstallState(marker(2), marker(2))).toBe("current");
  });

  it("flags a game whose runtime is newer than this coilbox", () => {
    expect(runtimeInstallState(marker(3), marker(2))).toBe("newer");
  });
});
