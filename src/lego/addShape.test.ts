import { describe, expect, it } from "vitest";

import { addShape } from "./addShape";
import { newProject } from "./model";
import type { ShapeKind } from "./shapes";

const cylinder: ShapeKind = {
  kind: "cylinder",
  label: "Cylinder",
  size: [2, 2, 2],
  tags: ["round"],
};

const base = newProject({
  id: "p",
  rootPieceId: "root",
  name: "unit",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-17T00:00:00Z",
});

describe("addShape", () => {
  it("adds a piece with the kind and its default size under the parent", () => {
    const next = addShape(base, cylinder, "root", "new1");
    const piece = next.pieces.find((p) => p.id === "new1");
    expect(piece).toMatchObject({
      parentId: "root",
      partId: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      shape: { kind: "cylinder", size: [2, 2, 2] },
    });
  });

  it("copies the size, so editing the piece cannot change the default", () => {
    const next = addShape(base, cylinder, "root", "new1");
    const piece = next.pieces.find((p) => p.id === "new1");
    expect(piece?.shape?.size).not.toBe(cylinder.size);
  });

  it("carries the kind's default options", () => {
    const next = addShape(
      base,
      { ...cylinder, options: { sides: 8 } },
      "root",
      "new1",
    );
    expect(next.pieces.at(-1)?.shape?.options).toEqual({ sides: 8 });
  });

  it("names pieces after the kind and keeps the names unique", () => {
    const once = addShape(base, cylinder, "root", "a");
    const twice = addShape(once, cylinder, "a", "b");
    expect(twice.pieces.filter((p) => p.shape).map((p) => p.name)).toEqual([
      "cylinder",
      "cylinder2",
    ]);
  });
});
