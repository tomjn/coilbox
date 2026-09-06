// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapLoadIndicator } from "./MapLoadIndicator";
import { IDLE_MAP_LOAD, type MapLoad } from "./mapLoad";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const reading: MapLoad = {
  ...IDLE_MAP_LOAD,
  minimap: "done",
  heightPicture: "loading",
  unitDefs: "done",
  models: { state: "loading", done: 3, total: 11 },
};

const finished: MapLoad = {
  ...reading,
  heightPicture: "done",
  models: { state: "done", done: 11, total: 11 },
};

describe("MapLoadIndicator", () => {
  it("lists what is being read, with the model count", () => {
    render(<MapLoadIndicator load={reading} />);
    expect(screen.getByText("Relief")).toBeTruthy();
    expect(screen.getByText("3 / 11")).toBeTruthy();
    expect(screen.queryByText("Sky")).toBeNull();
  });

  it("goes a moment after everything has landed", () => {
    vi.useFakeTimers();
    const view = render(<MapLoadIndicator load={reading} />);
    view.rerender(<MapLoadIndicator load={finished} />);
    expect(screen.getByText("Unit models")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Unit models")).toBeNull();
  });

  it("stays while anything has failed", () => {
    vi.useFakeTimers();
    render(<MapLoadIndicator load={{ ...finished, exactHeights: "failed" }} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Exact heights")).toBeTruthy();
  });
});
