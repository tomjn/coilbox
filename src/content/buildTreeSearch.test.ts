import { describe, expect, it } from "vitest";
import { SEARCH_LIMIT, searchUnits } from "./buildTreeSearch";

const candidates = [
  { id: "armlab", label: "Bot Lab" },
  { id: "armvp", label: "Vehicle Plant" },
  { id: "armpw", label: "Peewee" },
  { id: "armlabbot", label: "Laboratory Bot" },
  { id: "corlab", label: "Kbot Lab" },
];

const ids = (query: string, list = candidates) =>
  searchUnits(query, list).map((c) => c.id);

describe("searchUnits", () => {
  it("returns nothing for an empty or blank query", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });

  it("matches the label, ignoring case", () => {
    expect(ids("peewee")).toEqual(["armpw"]);
    expect(ids("VEHICLE")).toEqual(["armvp"]);
  });

  it("matches the unit's internal name", () => {
    expect(ids("armvp")).toEqual(["armvp"]);
  });

  it("puts matches that start with the query before the rest", () => {
    // Only "Laboratory Bot" starts with it, the others contain it.
    expect(ids("lab")).toEqual(["armlabbot", "armlab", "corlab"]);
    expect(ids("bot")).toEqual(["armlab", "corlab", "armlabbot"]);
  });

  it("orders matches of the same rank by label, then id", () => {
    const list = [
      { id: "b", label: "Same" },
      { id: "a", label: "Same" },
      { id: "c", label: "Same Again" },
    ];
    expect(ids("same", list)).toEqual(["a", "b", "c"]);
  });

  it("caps the list at the limit", () => {
    const many = Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) => ({
      id: `unit${i}`,
      label: `Unit ${i}`,
    }));
    expect(searchUnits("unit", many)).toHaveLength(SEARCH_LIMIT);
  });

  it("returns nothing when no unit matches", () => {
    expect(ids("zzz")).toEqual([]);
  });
});
