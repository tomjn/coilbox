// @vitest-environment happy-dom
/**
 * What this proves: line numbers are on screen but out of a screen reader's
 * way (issue #2282's accessibility ask), a find match is highlighted without
 * losing the surrounding text, and - the issue's main performance worry -
 * that a document thousands of lines long does not become thousands of DOM
 * rows once the container has a real, measured height.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MissionLuaCode, type MissionLuaCodeHandle } from "./MissionLuaCode";
import type { LuaMatch } from "./missionLuaSearch";

/** happy-dom's ResizeObserver never calls back (it is a stub), so tests that
 *  need a measured container height provide their own that fires once,
 *  synchronously, with a fixed size - the same technique real virtualized
 *  lists are tested with. */
class FixedSizeResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback(
      [{ contentRect: { height: 360 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup();
});

function lines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `local line${i} = ${i}`);
}

describe("line numbers", () => {
  it("shows a number for every line, hidden from assistive tech", () => {
    render(
      <MissionLuaCode
        lines={["first", "second"]}
        tokens={null}
        matches={[]}
        activeMatch={null}
      />,
    );
    const one = screen.getByText("1");
    const two = screen.getByText("2");
    expect(one.getAttribute("aria-hidden")).toBe("true");
    expect(two.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the line number out of the line's own text", () => {
    render(
      <MissionLuaCode
        lines={["local x = 1"]}
        tokens={null}
        matches={[]}
        activeMatch={null}
      />,
    );
    expect(screen.getByTestId("mission-lua-line-text")).toHaveProperty(
      "textContent",
      "local x = 1",
    );
  });
});

describe("find highlighting", () => {
  it("marks a match without altering the line's text", () => {
    const match: LuaMatch = { line: 0, start: 6, end: 13 };
    render(
      <MissionLuaCode
        lines={["local Trigger = 1"]}
        tokens={null}
        matches={[match]}
        activeMatch={match}
      />,
    );
    expect(screen.getByTestId("mission-lua-line-text")).toHaveProperty(
      "textContent",
      "local Trigger = 1",
    );
    expect(screen.getByText("Trigger").className).toContain("bg-amber");
  });

  it("styles the active match apart from the rest", () => {
    const first: LuaMatch = { line: 0, start: 0, end: 3 };
    const second: LuaMatch = { line: 1, start: 0, end: 3 };
    render(
      <MissionLuaCode
        lines={["foo bar", "foo baz"]}
        tokens={null}
        matches={[first, second]}
        activeMatch={second}
      />,
    );
    const matches = screen.getAllByText("foo");
    expect(matches[0].className).not.toContain("amber-400");
    expect(matches[1].className).toContain("amber-400");
  });
});

describe("virtualization", () => {
  it("renders every line when the container has not been measured", () => {
    render(
      <MissionLuaCode
        lines={lines(500)}
        tokens={null}
        matches={[]}
        activeMatch={null}
      />,
    );
    expect(screen.getAllByTestId("mission-lua-line-text")).toHaveLength(500);
  });

  it("renders far fewer rows than lines once the container is measured", () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      FixedSizeResizeObserver as unknown as typeof ResizeObserver;
    try {
      render(
        <MissionLuaCode
          lines={lines(5000)}
          tokens={null}
          matches={[]}
          activeMatch={null}
        />,
      );
      const rows = screen.getAllByTestId("mission-lua-line-text");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("scrolls a match not currently on screen into the middle of the view", () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      FixedSizeResizeObserver as unknown as typeof ResizeObserver;
    try {
      const ref = createRef<MissionLuaCodeHandle>();
      render(
        <MissionLuaCode
          ref={ref}
          lines={lines(5000)}
          tokens={null}
          matches={[]}
          activeMatch={null}
        />,
      );
      expect(screen.queryByText("local line3000 = 3000")).toBeNull();

      act(() => {
        ref.current?.scrollToLine(3000);
      });

      expect(screen.getByText("local line3000 = 3000")).toBeTruthy();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});
