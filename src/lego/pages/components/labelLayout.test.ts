import { describe, expect, it } from "vitest";
import { type LabelBox, shownLabels } from "./labelLayout";

function box(
  id: string,
  left: number,
  top: number,
  depth: number,
  always = false,
): LabelBox {
  return { id, left, top, width: 100, height: 19, depth, always };
}

describe("shownLabels", () => {
  it("shows every label when none overlap", () => {
    const shown = shownLabels([box("a", 0, 0, 5), box("b", 0, 40, 1)]);

    expect([...shown].sort()).toEqual(["a", "b"]);
  });

  it("hides the farther of two overlapping labels", () => {
    const shown = shownLabels([box("far", 0, 0, 9), box("near", 50, 10, 2)]);

    expect([...shown]).toEqual(["near"]);
  });

  it("treats labels that only touch as clear of each other", () => {
    const shown = shownLabels([box("a", 0, 0, 1), box("b", 100, 0, 2)]);

    expect(shown.size).toBe(2);
  });

  it("always shows a selected or hovered label, hiding the nearer one it covers", () => {
    const shown = shownLabels([
      box("near", 0, 0, 1),
      box("selected", 10, 5, 9, true),
    ]);

    expect([...shown]).toEqual(["selected"]);
  });

  it("shows two always labels even when they overlap each other", () => {
    const shown = shownLabels([
      box("selected", 0, 0, 3, true),
      box("hovered", 5, 5, 4, true),
    ]);

    expect(shown.size).toBe(2);
  });

  it("checks against shown labels only, so a hidden label hides nothing", () => {
    // b is hidden by a, so c, which only b overlaps, is still shown.
    const shown = shownLabels([
      box("a", 0, 0, 1),
      box("b", 60, 0, 2),
      box("c", 120, 0, 3),
    ]);

    expect([...shown].sort()).toEqual(["a", "c"]);
  });
});
