// @vitest-environment happy-dom
/**
 * `useStartBoxAllies` used to take a colour-per-ally map and read its keys as
 * "which allies are in play". Issue #2797 moved colour to a fixed palette
 * with no roster dependency, so this now takes the ally set directly - these
 * cover that it still offers the right allies and picks the right active one.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStartBoxAllies } from "./StartBoxControls";

describe("useStartBoxAllies", () => {
  it("falls back to [0, 1] when nobody is seated and no box exists", () => {
    const { result } = renderHook(() => useStartBoxAllies([], {}));
    expect(result.current.allyList).toEqual([0, 1]);
  });

  it("offers every ally in play, sorted, even with no box yet", () => {
    const { result } = renderHook(() => useStartBoxAllies([2, 0, 1], {}));
    expect(result.current.allyList).toEqual([0, 1, 2]);
  });

  it("still offers an ally that only has a box and no player", () => {
    const { result } = renderHook(() =>
      useStartBoxAllies([0], {
        "3": { left: 0, top: 0, right: 10, bottom: 10 },
      }),
    );
    expect(result.current.allyList).toEqual([0, 3]);
  });

  it("defaults the active ally to the lowest one without a box yet", () => {
    const { result } = renderHook(() =>
      useStartBoxAllies([0, 1, 2], {
        "0": { left: 0, top: 0, right: 10, bottom: 10 },
      }),
    );
    expect(result.current.activeAlly).toBe(1);
  });
});
