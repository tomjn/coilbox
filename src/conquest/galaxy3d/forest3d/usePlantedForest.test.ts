import { describe, expect, it } from "vitest";
import { sendable } from "./usePlantedForest";

describe("sendable", () => {
  it("keeps an array hidden from enumeration through a worker message", () => {
    const grid = { width: 2, height: 1 } as {
      width: number;
      height: number;
      data: Float32Array;
    };
    Object.defineProperty(grid, "data", {
      value: new Float32Array([0.25, 0.5]),
      enumerable: false,
    });
    expect(structuredClone(grid).data).toBeUndefined();
    const sent = structuredClone(sendable(grid));
    expect(sent).toEqual({
      width: 2,
      height: 1,
      data: new Float32Array([0.25, 0.5]),
    });
  });
});
