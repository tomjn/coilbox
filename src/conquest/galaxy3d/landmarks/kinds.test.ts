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
  it("puts a stronghold on an enemy capital only", () => {
    expect([...landmarkKinds(nodes, "me")]).toEqual([[1, "stronghold"]]);
  });

  it("puts a ruin where the identity asks for one", () => {
    const ids = new Map([["odd", { landmark: "ruin" as const }]]);
    expect(landmarkKinds(nodes, "me", ids).get(4)).toBe("ruin");
  });

  it("never puts a stronghold on a run's start, whoever owns it", () => {
    const ids = new Map([["their", { end: "start" as const }]]);
    expect(landmarkKinds(nodes, "me", ids).has(1)).toBe(false);
  });

  it("prefers the stronghold when a capital is also asked for a ruin", () => {
    const ids = new Map([["their", { landmark: "ruin" as const }]]);
    expect(landmarkKinds(nodes, "me", ids).get(1)).toBe("stronghold");
  });
});
