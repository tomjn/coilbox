// @vitest-environment happy-dom
/**
 * Where start position names are kept: one setting, one list a map, under the
 * map's exact name. A name for one map, or for one version of it, is not seen
 * on another.
 */
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let STORE: Record<string, unknown> = {};

vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, fallback: unknown) => {
    const [value, set] = useState<unknown>(STORE[key] ?? fallback);
    return [
      value,
      (next: unknown) => {
        STORE[key] = next;
        set(next);
      },
    ];
  },
}));

const { useStartNames } = await import("./useStartNames");
const { START_NAMES_KEY } = await import("./startNames");

const entry = (key: string, name: string) => ({ key, name, x: 1, z: 2 });

beforeEach(() => {
  STORE = {};
});

describe("names kept per map", () => {
  it("starts with none and keeps what is saved", () => {
    const { result } = renderHook(() => useStartNames("Talus v1.0"));
    expect(result.current.stored).toEqual([]);
    act(() => result.current.save([entry("d1", "Hill")]));
    expect(result.current.stored).toEqual([entry("d1", "Hill")]);
    expect(STORE[START_NAMES_KEY]).toEqual({
      "Talus v1.0": [entry("d1", "Hill")],
    });
  });

  it("does not show one map's names on another map, or on another version of it", () => {
    STORE[START_NAMES_KEY] = { "Talus v1.0": [entry("d1", "Hill")] };
    expect(
      renderHook(() => useStartNames("Talus v1.0")).result.current.stored,
    ).toHaveLength(1);
    expect(
      renderHook(() => useStartNames("Talus v1.1")).result.current.stored,
    ).toEqual([]);
    expect(
      renderHook(() => useStartNames("Other")).result.current.stored,
    ).toEqual([]);
  });

  it("saves one map without touching the others, and drops a map left with none", () => {
    STORE[START_NAMES_KEY] = {
      A: [entry("d1", "One")],
      B: [entry("d2", "Two")],
    };
    const { result } = renderHook(() => useStartNames("A"));
    act(() => result.current.save([]));
    expect(STORE[START_NAMES_KEY]).toEqual({ B: [entry("d2", "Two")] });
  });
});
