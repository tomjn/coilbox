/**
 * The map's key table (issue #2269).
 *
 * The whole keyboard interface hangs off this one function, so what is pinned
 * here is the part that would break silently: an arrow that goes the wrong way
 * on the compass, a step size that stops answering its modifiers, and the rule
 * that a press carrying Ctrl or Command is somebody else's.
 */

import { describe, expect, it } from "vitest";
import { BUILD_SQUARE } from "@/blueprint/footprint";
import {
  COARSE_SQUARES,
  FINE_ELMOS,
  mapKeyAction,
  STEP_ELMOS,
  stepElmos,
} from "./mapKeys";

const holding = { selected: true };
const empty = { selected: false };

describe("which way the arrows go", () => {
  it("puts Up north and Down south, which is z running the other way", () => {
    expect(mapKeyAction({ key: "ArrowUp" }, holding)).toMatchObject({
      kind: "move",
      heading: "north",
      delta: { x: 0, z: -STEP_ELMOS },
    });
    expect(mapKeyAction({ key: "ArrowDown" }, holding)).toMatchObject({
      heading: "south",
      delta: { x: 0, z: STEP_ELMOS },
    });
  });

  it("puts Right east and Left west", () => {
    expect(mapKeyAction({ key: "ArrowRight" }, holding)).toMatchObject({
      heading: "east",
      delta: { x: STEP_ELMOS, z: 0 },
    });
    expect(mapKeyAction({ key: "ArrowLeft" }, holding)).toMatchObject({
      heading: "west",
      delta: { x: -STEP_ELMOS, z: 0 },
    });
  });

  it("moves the view's own cursor when nothing is selected", () => {
    expect(mapKeyAction({ key: "ArrowUp" }, empty)?.kind).toBe("pan");
  });
});

describe("how far one press goes", () => {
  it("takes one build square, which is the grid every building stands on", () => {
    expect(STEP_ELMOS).toBe(BUILD_SQUARE);
    expect(stepElmos({ key: "ArrowUp" })).toBe(BUILD_SQUARE);
  });

  it("takes ten squares with Shift and one elmo with Alt", () => {
    expect(stepElmos({ key: "ArrowUp", shiftKey: true })).toBe(
      BUILD_SQUARE * COARSE_SQUARES,
    );
    expect(stepElmos({ key: "ArrowUp", altKey: true })).toBe(FINE_ELMOS);
  });

  it("gives Alt the say when both are held, because the fine step is the one that was asked for", () => {
    expect(stepElmos({ key: "ArrowUp", altKey: true, shiftKey: true })).toBe(
      FINE_ELMOS,
    );
  });
});

describe("stepping through what is on the map", () => {
  it("reads full stop and comma either way round the Shift key", () => {
    expect(mapKeyAction({ key: "." }, empty)).toEqual({ kind: "cycle", by: 1 });
    expect(mapKeyAction({ key: ">" }, empty)).toEqual({ kind: "cycle", by: 1 });
    expect(mapKeyAction({ key: "," }, empty)).toEqual({
      kind: "cycle",
      by: -1,
    });
    expect(mapKeyAction({ key: "<" }, empty)).toEqual({
      kind: "cycle",
      by: -1,
    });
  });

  it("steps with nothing selected too, which is how the first thing is reached", () => {
    expect(mapKeyAction({ key: "." }, empty)).toBeTruthy();
  });
});

describe("acting on what is selected", () => {
  it("turns on R and back on Shift R", () => {
    expect(mapKeyAction({ key: "r" }, holding)).toEqual({
      kind: "turn",
      steps: 1,
    });
    expect(mapKeyAction({ key: "R", shiftKey: true }, holding)).toEqual({
      kind: "turn",
      steps: -1,
    });
  });

  it("deletes on either delete key", () => {
    expect(mapKeyAction({ key: "Delete" }, holding)?.kind).toBe("delete");
    expect(mapKeyAction({ key: "Backspace" }, holding)?.kind).toBe("delete");
  });

  it("has nothing to turn or delete when nothing is selected", () => {
    expect(mapKeyAction({ key: "r" }, empty)).toBeNull();
    expect(mapKeyAction({ key: "Delete" }, empty)).toBeNull();
  });
});

describe("Escape", () => {
  it("lets go of the selection when there is one", () => {
    expect(mapKeyAction({ key: "Escape" }, holding)).toEqual({ kind: "clear" });
  });

  // The Bases mode listens for Escape on the window to put down the building it
  // is carrying, and the expanded view listens for it to shrink back. Claiming
  // it with nothing selected would take it from both of them.
  it("is not ours when nothing is selected", () => {
    expect(mapKeyAction({ key: "Escape" }, empty)).toBeNull();
  });
});

describe("keys that are not ours", () => {
  it("leaves anything carrying Ctrl or Command alone, so undo still works", () => {
    expect(mapKeyAction({ key: "z", metaKey: true }, holding)).toBeNull();
    expect(mapKeyAction({ key: "ArrowUp", metaKey: true }, holding)).toBeNull();
    expect(mapKeyAction({ key: "ArrowUp", ctrlKey: true }, holding)).toBeNull();
  });

  it("leaves an ordinary letter alone", () => {
    expect(mapKeyAction({ key: "a" }, holding)).toBeNull();
    expect(mapKeyAction({ key: "n" }, holding)).toBeNull();
  });
});

describe("the rest of the table", () => {
  it("acts at the cursor on Enter, whether or not anything is selected", () => {
    expect(mapKeyAction({ key: "Enter" }, empty)).toEqual({ kind: "act" });
    expect(mapKeyAction({ key: "Enter" }, holding)).toEqual({ kind: "act" });
  });

  it("reads the keys out on a question mark", () => {
    expect(mapKeyAction({ key: "?" }, empty)).toEqual({ kind: "help" });
  });
});
