import { describe, expect, it } from "vitest";
import { endMarkersToDraw, type RunEnd } from "./endMarkers";

const nodes = [
  { id: "gate", pos: [100, 200] as [number, number] },
  { id: "mid", pos: [300, 200] as [number, number] },
  { id: "keep", pos: [500, 200] as [number, number] },
];
const ends = new Map<string, { end?: RunEnd }>([
  ["gate", { end: "start" }],
  ["mid", {}],
  ["keep", { end: "goal" }],
]);
const REACH = 10;
const model = (x: number, y: number) => ({ pos: [x, y] as [number, number] });
const drawn = (models?: { pos: [number, number] }[]) =>
  endMarkersToDraw(nodes, ends, models, REACH).map((m) => `${m.end} ${m.id}`);

describe("endMarkersToDraw", () => {
  it("draws a marker for the start and one for the goal, and no other", () => {
    expect(endMarkersToDraw(nodes, ends, undefined, REACH)).toEqual([
      { nodeIndex: 0, id: "gate", end: "start", pos: [100, 200] },
      { nodeIndex: 2, id: "keep", end: "goal", pos: [500, 200] },
    ]);
    expect(drawn([])).toEqual(["start gate", "goal keep"]);
  });

  it("draws nothing when no location is an end", () => {
    expect(endMarkersToDraw(nodes, new Map(), undefined, REACH)).toEqual([]);
  });

  it("leaves out the marker under a model placed on the anchor", () => {
    expect(drawn([model(100, 200)])).toEqual(["goal keep"]);
    expect(drawn([model(500, 200)])).toEqual(["start gate"]);
    expect(drawn([model(100, 200), model(500, 200)])).toEqual([]);
  });

  it("counts a model just inside the reach as on the location", () => {
    expect(drawn([model(100 + REACH - 0.001, 200)])).toEqual(["goal keep"]);
    // Measured in a straight line, not along each axis.
    expect(drawn([model(106, 208)])).toEqual(["goal keep"]);
  });

  it("counts a model exactly at the reach as on the location", () => {
    expect(drawn([model(100, 200 - REACH)])).toEqual(["goal keep"]);
  });

  it("keeps the marker when the model is just outside the reach", () => {
    expect(drawn([model(100 + REACH + 0.001, 200)])).toEqual([
      "start gate",
      "goal keep",
    ]);
    // Inside the reach on each axis, outside it in a straight line.
    expect(drawn([model(108, 208)])).toEqual(["start gate", "goal keep"]);
  });

  it("draws the marker when the model on it failed to load", () => {
    const placed = [
      { model: { file: "gate.glb" }, pos: [100, 200] as [number, number] },
      { model: { file: "tower.glb" }, pos: [500, 200] as [number, number] },
    ];
    const failed = new Set(["gate.glb"]);
    expect(
      endMarkersToDraw(nodes, ends, placed, REACH, failed).map((m) => m.id),
    ).toEqual(["gate"]);
    // One model that failed and one that did not: the one that loaded stands.
    const two = [
      ...placed,
      { model: { file: "banner.glb" }, pos: [102, 200] as [number, number] },
    ];
    expect(
      endMarkersToDraw(nodes, ends, two, REACH, failed).map((m) => m.id),
    ).toEqual([]);
  });

  it("is not moved by a model on a location that is not an end", () => {
    expect(drawn([model(300, 200)])).toEqual(["start gate", "goal keep"]);
  });
});
