import { describe, expect, it } from "vitest";

import type { Point } from "../scenario/model";
import {
  type DraftInput,
  type DraftState,
  draftDefaults,
  draftReduce,
  NO_DRAFT,
} from "./terrainDraft";

/** Run inputs in order, keeping every step made and the last refusal. */
function run(inputs: DraftInput[], from: DraftState = NO_DRAFT) {
  let state = from;
  const steps = [];
  let refused = null;
  for (const input of inputs) {
    const result = draftReduce(state, input);
    state = result.state;
    if (result.step) steps.push(result.step);
    refused = result.refused;
  }
  return { state, steps, refused };
}

const click = (x: number, z: number): DraftInput => ({
  type: "click",
  at: { x, z },
});
const pick = (tool: DraftState["tool"]): DraftInput => ({ type: "pick", tool });

const square: Point[] = [
  { x: 0, z: 0 },
  { x: 64, z: 0 },
  { x: 64, z: 64 },
];

describe("drawing a step with a tool", () => {
  it("starts with no tool", () => {
    expect(NO_DRAFT.tool).toBeNull();
  });

  it("starts a wall as Raise and an area as Level", () => {
    expect(draftDefaults("wall").kind).toBe("raise");
    expect(draftDefaults("wall").height).toBeGreaterThan(0);
    expect(draftDefaults("area")).toMatchObject({ kind: "level", height: 0 });
  });

  it("adds a point per click, and ignores the second click of a double click", () => {
    const { state } = run([
      pick("wall"),
      click(0, 0),
      click(0, 0),
      click(64, 0),
    ]);
    expect(state.points).toHaveLength(2);
  });

  it("makes a ramp on its second click and puts the tool down", () => {
    const { state, steps } = run([pick("ramp"), click(0, 0), click(0, 128)]);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("ramp");
    expect(state.tool).toBeNull();
  });

  it("closes an area on a click on its first corner", () => {
    const { steps } = run([
      pick("area"),
      ...square.map((p) => click(p.x, p.z)),
      click(0, 0),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].points).toHaveLength(3);
  });

  it("makes a rectangle dragged out with the area tool", () => {
    const corners = [...square, { x: 0, z: 64 }];
    const { steps, state } = run([
      pick("smooth"),
      { type: "rectangle", corners },
    ]);
    expect(steps[0]).toMatchObject({ kind: "smooth", shape: "area" });
    expect(state.tool).toBeNull();
  });

  it("makes the step with the height and kind set on the tool", () => {
    const { steps } = run([
      pick("area"),
      { type: "settings", settings: { kind: "raise", height: 80 } },
      ...square.map((p) => click(p.x, p.z)),
      { type: "settings", settings: { height: -40 } },
      { type: "finish" },
    ]);
    expect(steps[0]).toMatchObject({ kind: "raise", height: -40 });
  });

  it("stops a click that would make a wall longer than the game allows", () => {
    const { state, refused } = run([
      pick("wall"),
      click(0, 0),
      click(12000, 0),
    ]);
    expect(refused).toBe("wall");
    expect(state.points).toHaveLength(1);
  });
});

describe("finishing and cancelling", () => {
  it("finishes with enough points: Enter, a double click, a right click or Done", () => {
    const { steps, state } = run([
      pick("wall"),
      click(0, 0),
      click(64, 0),
      { type: "finish" },
    ]);
    expect(steps).toHaveLength(1);
    expect(state).toMatchObject({ tool: null, points: [] });
  });

  it("throws the points away when finishing with too few", () => {
    const { steps, state } = run([
      pick("area"),
      click(0, 0),
      click(64, 0),
      { type: "finish" },
    ]);
    expect(steps).toHaveLength(0);
    expect(state).toMatchObject({ tool: "area", points: [] });
  });

  it("puts the tool down when finishing with nothing drawn", () => {
    expect(run([pick("wall"), { type: "finish" }]).state.tool).toBeNull();
  });

  it("cancels the shape on Escape, and puts the tool down on a second", () => {
    const once = run([
      pick("wall"),
      click(0, 0),
      click(64, 0),
      { type: "escape" },
    ]);
    expect(once.state).toMatchObject({ tool: "wall", points: [] });
    expect(once.steps).toHaveLength(0);
    const twice = run([{ type: "escape" }], once.state);
    expect(twice.state.tool).toBeNull();
  });

  it("throws the shape away and puts the tool down on Cancel", () => {
    const { steps, state } = run([
      pick("wall"),
      click(0, 0),
      click(64, 0),
      { type: "cancel" },
    ]);
    expect(steps).toHaveLength(0);
    expect(state).toMatchObject({ tool: null, points: [] });
  });
});
