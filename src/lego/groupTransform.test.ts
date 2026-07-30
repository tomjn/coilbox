import { describe, expect, it } from "vitest";

import {
  applyGroupTransform,
  type GroupDelta,
  groupPivot,
  groupTransform,
  NO_GROUP_DELTA,
  transformRoots,
} from "./groupTransform";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { worldMatrix } from "./reparent";

function piece(
  id: string,
  parentId: string,
  position: [number, number, number],
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...extra,
  };
}

/** A hull with a leg either side of it, which is the case the issue is about. */
function walker(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-30T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      piece("hull", "root", [0, 4, 0]),
      piece("left", "hull", [-2, -1, 0]),
      piece("right", "hull", [2, -1, 0]),
      piece("foot", "left", [0, -2, 0]),
    ],
  };
}

/** Where a piece sits in the unit, which is what a group gesture moves. */
function worldPosition(
  project: LegoProject,
  pieceId: string,
): [number, number, number] {
  const m = worldMatrix(project, pieceId).elements;
  return [m[12], m[13], m[14]];
}

function moved(
  project: LegoProject,
  ids: string[],
  delta: Partial<GroupDelta>,
  pivot = groupPivot(project, ids),
): LegoProject {
  return applyGroupTransform(
    project,
    groupTransform(project, ids, pivot, { ...NO_GROUP_DELTA, ...delta }),
  );
}

function near(
  actual: [number, number, number],
  expected: [number, number, number],
) {
  actual.forEach((value, axis) => {
    expect(value).toBeCloseTo(expected[axis], 5);
  });
}

describe("transformRoots", () => {
  it("keeps pieces that are only carried by something outside the set", () => {
    expect(transformRoots(walker(), ["left", "right"])).toEqual([
      "left",
      "right",
    ]);
  });

  it("drops a piece whose own parent is in the set, so it is not moved twice", () => {
    expect(transformRoots(walker(), ["left", "foot"])).toEqual(["left"]);
  });

  it("drops a piece carried by the set further up than its own parent", () => {
    // "foot" hangs off "left", which hangs off "hull". Selecting the hull and
    // the foot moves the foot through the hull already.
    expect(transformRoots(walker(), ["hull", "foot"])).toEqual(["hull"]);
  });

  it("leaves the root out, because the root is the unit", () => {
    expect(transformRoots(walker(), ["root", "left"])).toEqual(["left"]);
    expect(transformRoots(walker(), ["root"])).toEqual([]);
  });

  it("ignores a piece that is not in the document", () => {
    expect(transformRoots(walker(), ["left", "gone"])).toEqual(["left"]);
  });
});

describe("groupPivot", () => {
  it("sits exactly between two pieces, in world space", () => {
    // Both legs are 1 below the hull, which is 4 up.
    near(groupPivot(walker(), ["left", "right"]), [0, 3, 0]);
  });

  it("is one piece's own origin when only one is selected", () => {
    near(groupPivot(walker(), ["left"]), [-2, 3, 0]);
  });
});

describe("groupTransform", () => {
  it("moves every piece in the set by the same world-space amount", () => {
    const after = moved(walker(), ["left", "right"], { position: [0, 0, 5] });

    near(worldPosition(after, "left"), [-2, 3, 5]);
    near(worldPosition(after, "right"), [2, 3, 5]);
    // Nothing else in the unit moved.
    near(worldPosition(after, "hull"), [0, 4, 0]);
  });

  it("turns the set about its midpoint, so it does not fly apart", () => {
    // Half a turn about y swaps the two legs over. Turning each about its own
    // origin instead would leave both exactly where they are.
    const after = moved(walker(), ["left", "right"], {
      rotation: [0, Math.PI, 0],
    });

    near(worldPosition(after, "left"), [2, 3, 0]);
    near(worldPosition(after, "right"), [-2, 3, 0]);
  });

  it("keeps the distance between the pieces when it turns them", () => {
    const before = walker();
    const after = moved(before, ["left", "right"], {
      rotation: [0.3, 0.7, -0.2],
    });

    const gap = (project: LegoProject) => {
      const a = worldPosition(project, "left");
      const b = worldPosition(project, "right");
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(gap(after)).toBeCloseTo(gap(before), 5);
  });

  it("turns a piece's own axes too, not only where it sits", () => {
    const after = moved(walker(), ["left", "right"], {
      rotation: [0, Math.PI / 2, 0],
    });

    const left = after.pieces.find((p) => p.id === "left");
    expect(left?.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
  });

  it("scales the set about its midpoint, pushing the pieces apart", () => {
    const after = moved(walker(), ["left", "right"], { scale: 2 });

    near(worldPosition(after, "left"), [-4, 3, 0]);
    near(worldPosition(after, "right"), [4, 3, 0]);
    expect(after.pieces.find((p) => p.id === "left")?.scale).toEqual([2, 2, 2]);
  });

  it("carries the children of a moved piece along without touching them", () => {
    const before = walker();
    const after = moved(before, ["left", "right"], { position: [0, 0, 5] });

    // The foot's own transform is untouched: it hangs off the leg and the leg
    // took it with it.
    expect(after.pieces.find((p) => p.id === "foot")).toEqual(
      before.pieces.find((p) => p.id === "foot"),
    );
    near(worldPosition(after, "foot"), [-2, 1, 5]);
  });

  it("moves a piece once when its own parent is in the set as well", () => {
    const before = walker();
    const roots = transformRoots(before, ["left", "foot"]);
    const after = moved(before, roots, { position: [0, 0, 5] });

    near(worldPosition(after, "foot"), [-2, 1, 5]);
  });

  it("writes a moved piece against a parent that is turned and scaled", () => {
    const before: LegoProject = {
      ...walker(),
      pieces: walker().pieces.map((p) =>
        p.id === "hull"
          ? { ...p, rotation: [0, Math.PI / 2, 0], scale: [2, 2, 2] }
          : p,
      ),
    };

    const after = moved(before, ["left", "right"], { position: [1, 2, 3] });

    const was = worldPosition(before, "left");
    near(worldPosition(after, "left"), [was[0] + 1, was[1] + 2, was[2] + 3]);
  });

  it("leaves the document alone when the gesture is nothing", () => {
    const before = walker();
    const after = moved(before, ["left", "right"], {});

    for (const id of ["left", "right"]) {
      near(worldPosition(after, id), worldPosition(before, id));
    }
  });

  it("does not collapse a piece when a scale drag passes through zero", () => {
    const after = moved(walker(), ["left", "right"], { scale: 0 });
    const left = after.pieces.find((p) => p.id === "left");
    expect(left?.scale.every((value) => value > 0)).toBe(true);
  });
});

describe("applyGroupTransform", () => {
  it("hands back the same document when there is nothing to write", () => {
    const before = walker();
    expect(applyGroupTransform(before, new Map())).toBe(before);
  });
});
