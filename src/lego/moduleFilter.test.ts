import { describe, expect, it } from "vitest";

import { newProject, parseLegoProjectJson } from "./model";
import {
  canonicalCategory,
  categoriesInUse,
  categorySuggestions,
  filterModules,
  parseTags,
  STARTER_CATEGORIES,
  swapCandidates,
  UNCATEGORISED,
  withLabels,
} from "./moduleFilter";

function module(name: string, extra: { category?: string; tags?: string[] }) {
  return {
    ...newProject({
      id: name,
      rootPieceId: "root",
      name,
      packId: "lego",
      packVersion: "1",
      now: "2026-10-17T00:00:00Z",
    }),
    ...extra,
  };
}

const LIST = [
  module("Big wheel", { category: "Wheel", tags: ["rubber", "heavy"] }),
  module("Twin turret", { category: "Turret", tags: ["gun"] }),
  module("Mystery", {}),
];

describe("filterModules", () => {
  it("keeps everything for an empty query and no category", () => {
    expect(filterModules(LIST, "", null)).toHaveLength(3);
  });

  it("matches the name, the category and the tags", () => {
    expect(filterModules(LIST, "big", null).map((m) => m.name)).toEqual([
      "Big wheel",
    ]);
    expect(filterModules(LIST, "turret", null).map((m) => m.name)).toEqual([
      "Twin turret",
    ]);
    expect(filterModules(LIST, "rubber", null).map((m) => m.name)).toEqual([
      "Big wheel",
    ]);
  });

  it("requires every term", () => {
    expect(filterModules(LIST, "wheel rubber", null)).toHaveLength(1);
    expect(filterModules(LIST, "wheel gun", null)).toHaveLength(0);
  });

  it("narrows by category without regard to case", () => {
    expect(filterModules(LIST, "", "wheel").map((m) => m.name)).toEqual([
      "Big wheel",
    ]);
  });

  it("lists modules with no category under uncategorised", () => {
    expect(filterModules(LIST, "", UNCATEGORISED).map((m) => m.name)).toEqual([
      "Mystery",
    ]);
  });

  it("stacks the search with the category", () => {
    expect(filterModules(LIST, "gun", "Wheel")).toHaveLength(0);
  });
});

describe("categories", () => {
  it("lists those in use once each, whatever the case", () => {
    const more = [...LIST, module("Small wheel", { category: "wheel" })];
    expect(categoriesInUse(more)).toEqual(["Turret", "Wheel"]);
  });

  it("offers the starter categories and any others in use", () => {
    const more = [...LIST, module("Radar", { category: "Sensor" })];
    const offered = categorySuggestions(more);
    for (const name of STARTER_CATEGORIES) expect(offered).toContain(name);
    expect(offered).toContain("Sensor");
    expect(offered.filter((c) => c.toLowerCase() === "wheel")).toHaveLength(1);
  });

  it("takes the spelling already in use for a category typed again", () => {
    expect(canonicalCategory("  turret ", LIST)).toBe("Turret");
    expect(canonicalCategory("Sensor", LIST)).toBe("Sensor");
    expect(canonicalCategory("   ", LIST)).toBeUndefined();
  });
});

describe("tags", () => {
  it("splits on commas, trims and drops repeats and blanks", () => {
    expect(parseTags(" gun, Heavy ,, gun,heavy ")).toEqual(["gun", "Heavy"]);
  });
});

describe("withLabels", () => {
  it("sets a category and tags", () => {
    const out = withLabels(LIST[2], { category: "Leg", tags: ["a"] });
    expect(out.category).toBe("Leg");
    expect(out.tags).toEqual(["a"]);
  });

  it("removes the fields when they are emptied", () => {
    const out = withLabels(LIST[0], { category: undefined, tags: [] });
    expect("category" in out).toBe(false);
    expect("tags" in out).toBe(false);
  });
});

describe("a module document", () => {
  it("keeps its category and tags through a save and load", () => {
    const json = JSON.stringify({ ...LIST[0], schemaVersion: 1 });
    const back = parseLegoProjectJson(json);
    expect(back?.category).toBe("Wheel");
    expect(back?.tags).toEqual(["rubber", "heavy"]);
  });

  it("loads unchanged when saved before categories existed", () => {
    const json = JSON.stringify({ ...LIST[2], schemaVersion: 1 });
    const back = parseLegoProjectJson(json);
    expect(back).not.toBeNull();
    expect(back?.category).toBeUndefined();
    expect(back?.tags).toBeUndefined();
  });

  it("drops a category or tags of the wrong type, and blank entries", () => {
    const json = JSON.stringify({
      ...LIST[2],
      schemaVersion: 1,
      category: 7,
      tags: ["ok", "", 3, " spaced "],
    });
    const back = parseLegoProjectJson(json);
    expect(back?.category).toBeUndefined();
    expect(back?.tags).toEqual(["ok", "spaced"]);
  });
});

describe("swapCandidates", () => {
  const list = [
    module("Big wheel", { category: "Wheel" }),
    module("Small turret", { category: "Turret" }),
    module("Big turret", { category: "turret" }),
    module("Plain", {}),
  ];

  it("lists the same category first, ignoring case, and leaves out the module itself", () => {
    const out = swapCandidates(list, "Small turret", "Turret");
    expect(out.map((m) => m.name)).toEqual([
      "Big turret",
      "Big wheel",
      "Plain",
    ]);
  });

  it("keeps the list order when the module has no category", () => {
    const out = swapCandidates(list, "Plain", undefined);
    expect(out.map((m) => m.name)).toEqual([
      "Big wheel",
      "Small turret",
      "Big turret",
    ]);
  });
});
