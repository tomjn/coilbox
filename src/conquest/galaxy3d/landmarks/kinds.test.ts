import { describe, expect, it } from "vitest";
import { NEUTRAL } from "../../model";
import { landmarkKinds } from "./kinds";

const nodes = [
  { id: "home", kind: "capital" as const, owner: "me" },
  { id: "their", kind: "capital" as const, owner: "foe" },
  { id: "free", kind: "capital" as const, owner: NEUTRAL },
  { id: "town", kind: undefined, owner: "foe" },
  { id: "odd", kind: undefined, owner: "foe" },
];

describe("landmarkKinds", () => {
  it("puts a stronghold on every capital a faction holds, whoever plays", () => {
    expect([...landmarkKinds(nodes)]).toEqual([
      [0, "stronghold"],
      [1, "stronghold"],
    ]);
  });

  it("puts a ruin where the identity asks for one", () => {
    const ids = new Map([["odd", { landmark: "ruin" as const }]]);
    expect(landmarkKinds(nodes, ids).get(4)).toBe("ruin");
  });

  it("puts a depot where the identity asks for one, as often as it asks", () => {
    const ids = new Map([
      ["town", { landmark: "depot" as const }],
      ["odd", { landmark: "depot" as const }],
    ]);
    const kinds = landmarkKinds(nodes, ids);
    expect([kinds.get(3), kinds.get(4)]).toEqual(["depot", "depot"]);
  });

  it("never puts a stronghold on a run's start, whoever owns it", () => {
    const ids = new Map([["their", { end: "start" as const }]]);
    expect(landmarkKinds(nodes, ids).has(1)).toBe(false);
  });

  it("puts the landing pad on a run's start when the identity asks for it", () => {
    const ids = new Map([
      ["their", { end: "start" as const, landmark: "landing" as const }],
    ]);
    expect(landmarkKinds(nodes, ids).get(1)).toBe("landing");
  });

  it("puts a landing pad in the stronghold's place when a map asks for one", () => {
    const ids = new Map([["home", { landmark: "landing" as const }]]);
    expect(landmarkKinds(nodes, ids).get(0)).toBe("landing");
  });

  it("prefers the stronghold when a capital is also asked for a ruin", () => {
    const ids = new Map([["their", { landmark: "ruin" as const }]]);
    expect(landmarkKinds(nodes, ids).get(1)).toBe("stronghold");
  });

  it("puts a spire in the stronghold's place when a run asks for one", () => {
    const ids = new Map([["their", { landmark: "spire" as const }]]);
    expect(landmarkKinds(nodes, ids).get(1)).toBe("spire");
  });

  it("puts a spire nowhere a stronghold would not stand", () => {
    const ids = new Map([
      ["odd", { landmark: "spire" as const }],
      ["free", { landmark: "spire" as const }],
    ]);
    expect([...landmarkKinds(nodes, ids).keys()]).toEqual([0, 1]);
  });
});
