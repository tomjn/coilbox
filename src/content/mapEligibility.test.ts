import { describe, expect, it, vi } from "vitest";

// mapEligibility.ts pulls in @picoframe/frame and (via the profile) plugin-sdk,
// whose published dists use extensionless relative imports Vitest's node resolver
// won't load from node_modules. These pure-helper tests never call the hook or a
// command, so stubbing both leaves is enough to let the module load (same pattern
// as branding.test.ts and notes.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [[], () => {}],
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import type { MapExclusion } from "./branding";

const { compileExclusions, findExclusion, verdictFor } = await import(
  "./mapEligibility"
);

const hexFarm: MapExclusion = {
  id: "zwzsg-hexfarm",
  match: { regex: "^hex ?farm" },
  reason: "Kernel Panic map",
};
const duck: MapExclusion = { id: "duck", match: { names: ["Duck"] } };

describe("findExclusion", () => {
  it("matches a versioned map family by regex", () => {
    const rules = compileExclusions([hexFarm]);
    expect(findExclusion("Hex Farm 8", rules)?.id).toBe("zwzsg-hexfarm");
    expect(findExclusion("HexFarm 9", rules)?.id).toBe("zwzsg-hexfarm");
  });

  it("matches exact names case-insensitively", () => {
    const rules = compileExclusions([duck]);
    expect(findExclusion("duck", rules)?.id).toBe("duck");
  });

  it("leaves unrelated maps alone", () => {
    const rules = compileExclusions([hexFarm, duck]);
    expect(findExclusion("Comet Catcher Redux", rules)).toBeUndefined();
    // Substring, not a prefix: the regex is anchored.
    expect(findExclusion("Duckpond Valley", rules)).toBeUndefined();
  });

  it("keeps a rule whose regex is invalid, so its names still apply", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rules = compileExclusions([
      { id: "bad", match: { regex: "([unclosed", names: ["Duck"] } },
    ]);
    expect(findExclusion("Duck", rules)?.id).toBe("bad");
    expect(findExclusion("anything", rules)).toBeUndefined();
    warn.mockRestore();
  });
});

describe("verdictFor", () => {
  const catalog = compileExclusions([hexFarm]);
  const profile = compileExclusions([duck]);

  it("reports the catalog rule and its reason", () => {
    expect(verdictFor("Hex Farm 8", catalog, profile, [])).toEqual({
      source: "catalog",
      ruleId: "zwzsg-hexfarm",
      reason: "Kernel Panic map",
    });
  });

  it("reports a profile rule", () => {
    expect(verdictFor("Duck", catalog, profile, [])?.source).toBe("profile");
  });

  it("reports a player opt-out", () => {
    expect(
      verdictFor("Comet Catcher Redux", catalog, profile, [
        "comet catcher redux",
      ]),
    ).toEqual({ source: "player" });
  });

  it("returns null for an eligible map", () => {
    expect(verdictFor("Comet Catcher Redux", catalog, profile, [])).toBeNull();
  });

  it("prefers the catalog reason when more than one layer matches", () => {
    expect(
      verdictFor("Hex Farm 8", catalog, profile, ["Hex Farm 8"])?.source,
    ).toBe("catalog");
  });
});
