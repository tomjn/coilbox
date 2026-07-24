import { describe, expect, it, vi } from "vitest";
import type { SuggestedMap } from "./branding";

// branding.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load from
// node_modules (see imageCacheKey.test.ts). filterUninstalledMaps invokes no
// command, so stubbing the leaf is enough to let the module load.
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

const { filterUninstalledMaps } = await import("./branding");

const map = (p: Partial<SuggestedMap> & { id: string }): SuggestedMap => ({
  title: p.id,
  download: { kind: "map", springName: p.id },
  ...p,
});

describe("filterUninstalledMaps (issue #526)", () => {
  it("keeps every suggestion when nothing is installed", () => {
    const suggestions = [map({ id: "a" }), map({ id: "b" }), map({ id: "c" })];
    expect(filterUninstalledMaps(suggestions, new Set(), [])).toHaveLength(3);
  });

  it("drops only the installed map, keeping the rest selectable", () => {
    const suggestions = [
      map({ id: "a", filename: "a.sd7" }),
      map({ id: "b", filename: "b.sd7" }),
      map({ id: "c", filename: "c.sd7" }),
    ];
    const result = filterUninstalledMaps(suggestions, new Set(["a.sd7"]), []);
    expect(result.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("drops the last remaining map once it's installed too", () => {
    const suggestions = [map({ id: "a", filename: "a.sd7" })];
    const result = filterUninstalledMaps(suggestions, new Set(["a.sd7"]), []);
    expect(result).toHaveLength(0);
  });
});
