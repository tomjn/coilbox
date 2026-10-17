import { describe, expect, it } from "vitest";

import type { GuideLine, GuidePlane } from "./guides";
import {
  axesText,
  figure,
  formatNumber,
  measureBetween,
  pieceSize,
  snapMeasurePoint,
} from "./measure";
import { type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";

describe("measureBetween", () => {
  it("gives the signed offset on each axis and the straight length", () => {
    const { delta, length } = measureBetween([1, 2, 3], [4, 6, 3]);
    expect(delta).toEqual([3, 4, 0]);
    expect(length).toBe(5);
  });

  it("is zero for two equal points", () => {
    expect(measureBetween([1, 1, 1], [1, 1, 1]).length).toBe(0);
  });
});

describe("formatNumber", () => {
  it("keeps up to three decimals and drops trailing zeros", () => {
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(1 / 3)).toBe("0.333");
  });

  it("never prints a negative zero", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.0001)).toBe("0");
  });
});

describe("figure", () => {
  it("counts elmos and steps, a step being the pack's unit", () => {
    expect(figure(2, 0.25)).toBe("2 elmos, 8 steps");
  });

  it("says elmo in the singular for exactly one", () => {
    expect(figure(1, 0.25)).toBe("1 elmo, 4 steps");
  });

  it("says step in the singular for exactly one", () => {
    expect(figure(0.25, 0.25)).toBe("0.25 elmos, 1 step");
  });

  it("gives elmos only when the pack has no step", () => {
    expect(figure(2, null)).toBe("2 elmos");
  });
});

describe("axesText", () => {
  it("names each axis, in elmos and then in steps", () => {
    expect(axesText([1, -0.5, 0], 0.25)).toEqual({
      elmos: "X 1, Y -0.5, Z 0",
      steps: "X 4, Y -2, Z 0",
    });
  });

  it("leaves the steps out when the pack has none", () => {
    expect(axesText([1, 2, 3], null).steps).toBeNull();
  });
});

describe("snapMeasurePoint", () => {
  const plane: GuidePlane = {
    id: "p",
    name: "Y 4",
    axis: "y",
    point: [0, 4, 0],
    normal: [0, 1, 0],
  } as GuidePlane;
  const line: GuideLine = {
    id: "l",
    name: "Y line",
    axis: "y",
    point: [10, 0, 10],
    direction: [0, 1, 0],
  } as GuideLine;

  it("takes the nearest anchor in reach", () => {
    const snapped = snapMeasurePoint(
      [1.1, 1, 1],
      [
        [1, 1, 1],
        [5, 5, 5],
      ],
      [],
      [],
      0.5,
    );
    expect(snapped.point).toEqual([1, 1, 1]);
    expect(snapped.to).toBe("anchor");
  });

  it("prefers an anchor over a guide that is also in reach", () => {
    const snapped = snapMeasurePoint(
      [1, 3.9, 1],
      [[1, 4, 1]],
      [plane],
      [],
      0.5,
    );
    expect(snapped.point).toEqual([1, 4, 1]);
    expect(snapped.to).toBe("anchor");
  });

  it("falls back to a guide plane when no anchor is in reach", () => {
    const snapped = snapMeasurePoint(
      [1, 3.9, 1],
      [[9, 9, 9]],
      [plane],
      [],
      0.5,
    );
    expect(snapped.point[1]).toBeCloseTo(4);
    expect(snapped.point[0]).toBe(1);
    expect(snapped.to).toBe("guide");
  });

  it("falls back to a guide line, which settles the two coordinates across it", () => {
    const snapped = snapMeasurePoint([10.2, 3, 9.9], [], [], [line], 0.5);
    expect(snapped.point[0]).toBeCloseTo(10);
    expect(snapped.point[1]).toBeCloseTo(3);
    expect(snapped.point[2]).toBeCloseTo(10);
    expect(snapped.to).toBe("guide");
  });

  it("leaves a point alone when nothing is in reach", () => {
    const snapped = snapMeasurePoint(
      [1, 2, 3],
      [[9, 9, 9]],
      [plane],
      [line],
      0.5,
    );
    expect(snapped.point).toEqual([1, 2, 3]);
    expect(snapped.to).toBeNull();
  });
});

/** One triangle: a unit along x, two up y, a unit along z. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 2, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices: new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

function project(scale: [number, number, number]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "a",
        name: "a",
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale,
      },
      {
        id: "empty",
        name: "empty",
        parentId: "root",
        partId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

describe("pieceSize", () => {
  it("reads how far a piece reaches along each axis", () => {
    expect(pieceSize(project([1, 1, 1]), pack(), null, "a")).toEqual([1, 2, 1]);
  });

  it("follows the piece's scale", () => {
    expect(pieceSize(project([3, 1, 2]), pack(), null, "a")).toEqual([3, 2, 2]);
  });

  it("is null for a piece with no geometry", () => {
    expect(pieceSize(project([1, 1, 1]), pack(), null, "empty")).toBeNull();
  });
});
