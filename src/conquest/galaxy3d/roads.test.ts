import { describe, expect, it } from "vitest";
import { pairKey, roadLinks } from "./roads";

describe("roadLinks", () => {
  const nodes = [
    { id: "city-a" },
    { id: "city-b" },
    { id: "prov-a", outline: [[[0, 0] as [number, number]]] },
    { id: "prov-b", outline: [[[1, 1] as [number, number]]] },
  ];
  const draws = (
    link: [string, string],
    linkKinds?: [string, string, "border" | "crossing" | "road"][],
  ) => roadLinks({ nodes, links: [link], linkKinds }).length === 1;

  it("draws a link with no stated kind between two point locations", () => {
    expect(draws(["city-a", "city-b"])).toBe(true);
  });

  it("draws a link between a point location and a province", () => {
    expect(draws(["city-a", "prov-a"])).toBe(true);
    expect(draws(["prov-a", "city-a"], [["city-a", "prov-a", "border"]])).toBe(
      true,
    );
  });

  it("draws a road between two provinces", () => {
    expect(draws(["prov-a", "prov-b"], [["prov-b", "prov-a", "road"]])).toBe(
      true,
    );
  });

  it("draws no line for two provinces that only touch", () => {
    expect(draws(["prov-a", "prov-b"])).toBe(false);
    expect(draws(["prov-a", "prov-b"], [["prov-a", "prov-b", "border"]])).toBe(
      false,
    );
  });

  it("leaves a crossing out, whatever its ends are", () => {
    expect(
      draws(["city-a", "city-b"], [["city-b", "city-a", "crossing"]]),
    ).toBe(false);
    expect(
      draws(["prov-a", "prov-b"], [["prov-a", "prov-b", "crossing"]]),
    ).toBe(false);
  });

  it("leaves out a link to a node the document does not have", () => {
    expect(draws(["city-a", "nowhere"])).toBe(false);
  });

  it("keeps the ends in the order the link has them", () => {
    expect(roadLinks({ nodes, links: [["city-b", "city-a"]] })).toEqual([
      { a: "city-b", b: "city-a" },
    ]);
  });
});

describe("pairKey", () => {
  it("matches a pair either way round", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    expect(pairKey("a", "b")).not.toBe(pairKey("a", "c"));
  });
});
