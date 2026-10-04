import { describe, expect, it } from "vitest";
import { pickLocation } from "./picking";

// Node 0 and node 1 are provinces. Node 2 and node 3 are cities.
const provinces = (under: number) => ({
  isProvince: (i: number) => i < 2,
  pick: () => under,
});
const none = () => false;
const hidden =
  (...nodes: number[]) =>
  (i: number) =>
    nodes.includes(i);

describe("pickLocation", () => {
  it("picks a city by its hit target", () => {
    expect(pickLocation(2, provinces(0), none)).toBe(2);
    expect(pickLocation(2, undefined, none)).toBe(2);
  });

  it("picks a province by the ground under the pointer", () => {
    expect(pickLocation(-1, provinces(1), none)).toBe(1);
    // Over province 0's anchor target, but the ground there is province 1's.
    expect(pickLocation(0, provinces(1), none)).toBe(1);
    expect(pickLocation(-1, provinces(-1), none)).toBe(-1);
  });

  it("picks nothing over empty space on a map with no provinces", () => {
    expect(pickLocation(-1, undefined, none)).toBe(-1);
  });

  it("never picks a hidden city", () => {
    expect(pickLocation(2, undefined, hidden(2))).toBe(-1);
    expect(pickLocation(3, undefined, hidden(2))).toBe(3);
  });

  it("never picks a hidden province", () => {
    expect(pickLocation(-1, provinces(1), hidden(1))).toBe(-1);
    expect(pickLocation(0, provinces(1), hidden(1))).toBe(-1);
    expect(pickLocation(-1, provinces(0), hidden(1))).toBe(0);
  });

  it("does not fall through a hidden city to the province it stands in", () => {
    expect(pickLocation(2, provinces(0), hidden(2))).toBe(-1);
  });

  it("picks a visible city standing in a hidden province", () => {
    expect(pickLocation(2, provinces(0), hidden(0))).toBe(2);
  });
});
