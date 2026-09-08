// @vitest-environment happy-dom
/**
 * What this proves about issue #2709: no unit is out of reach any more, and
 * the list does not pay for that by mounting a row per unit.
 *
 * The list used to draw 500 rows and stop, which hid 64 of Beyond All Reason's
 * 564 from anyone who could not already name one. So the two facts worth
 * holding are that the count line is the honest total with no cap message, and
 * that a measured container has far fewer rows in the DOM than the game has
 * units. A selection off screen and the arrow keys are here too, because both
 * are the things windowing usually breaks.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitList } from "./UnitList";

/** happy-dom's ResizeObserver is a stub that never calls back, so a test that
 *  needs a measured container brings its own, firing once with a fixed height.
 *  Copied from `MissionLuaCode.test.tsx`, which windows the same way. */
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

function measured<T>(body: () => T): T {
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver =
    FixedSizeResizeObserver as unknown as typeof ResizeObserver;
  try {
    return body();
  } finally {
    globalThis.ResizeObserver = original;
  }
}

/** `n` units named so their sort order is their index: `unit000`, `unit001`. */
function units(n: number): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `unit${String(i).padStart(3, "0")}`,
      {},
    ]),
  );
}

function draw(
  over: Partial<Parameters<typeof UnitList>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <UnitList
      units={units(600)}
      selected=""
      overrides={{}}
      text={{}}
      clones={{}}
      menus={{}}
      disabled={[]}
      nameOf={(key) => key}
      picOf={() => undefined}
      picsPending={false}
      factionOf={() => undefined}
      onSelect={() => {}}
      {...over}
    />,
  );
}

const rowButtons = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("[data-row]"));

afterEach(cleanup);

describe("the count line", () => {
  it("gives the game's total and never asks for a search term", () => {
    draw();
    expect(screen.getByText("600 units")).toBeTruthy();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("gives both numbers while a search is narrowing the list", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "unit01" },
    });
    // unit010 to unit019: ten of the six hundred.
    expect(screen.getByText("10 of 600 units")).toBeTruthy();
  });
});

describe("windowing", () => {
  it("mounts a row per unit while the container has no measured height", () => {
    draw();
    expect(rowButtons()).toHaveLength(600);
  });

  it("mounts far fewer rows than units once the container is measured", () => {
    measured(() => {
      draw();
      const rows = rowButtons();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);
    });
  });

  it("mounts no more rows for a game of thousands than for one of hundreds", () => {
    // No installed game is this big - Beyond All Reason, the largest, has 564 -
    // so this is the only place the claim can be made. The window is the height
    // of the column divided by the height of a row, so the number of mounted
    // rows does not follow the size of the game at all.
    measured(() => {
      const { unmount } = draw();
      const hundreds = rowButtons().length;
      unmount();
      draw({ units: units(5000) });
      expect(rowButtons()).toHaveLength(hundreds);
    });
  });

  it("gives every row its true place in the whole list, not in the window", () => {
    measured(() => {
      draw();
      const first = rowButtons()[0].closest("li");
      expect(first?.getAttribute("aria-setsize")).toBe("600");
      expect(first?.getAttribute("aria-posinset")).toBe("1");
    });
  });
});

describe("searching from part way down the list", () => {
  it("still has rows in it, rather than a window past the end of the results", () => {
    measured(() => {
      draw();
      const list = rowButtons()[0].closest("ul")?.parentElement
        ?.parentElement as HTMLElement;
      fireEvent.scroll(list, { target: { scrollTop: 25000 } });
      expect(rowButtons()[0].getAttribute("data-row")).not.toBe("0");

      fireEvent.change(screen.getByLabelText("Search units"), {
        target: { value: "unit00" },
      });
      const shown = rowButtons().map((b) => b.getAttribute("data-row"));
      expect(shown.length).toBeGreaterThan(0);
      expect(shown[0]).toBe("0");
    });
  });
});

describe("a list that gets shorter under a scrolled window", () => {
  it("keeps rows on screen rather than windowing past the new end", () => {
    measured(() => {
      const view = draw();
      const list = rowButtons()[0].closest("ul")?.parentElement
        ?.parentElement as HTMLElement;
      fireEvent.scroll(list, { target: { scrollTop: 25000 } });
      expect(rowButtons().length).toBeGreaterThan(0);

      // The game's own units reloaded shorter, which is what an undo of an
      // added unit does. Nothing resets the offset for that, so the window
      // has to cope with an offset past the end on its own.
      view.rerender(
        <UnitList
          units={units(20)}
          selected=""
          overrides={{}}
          text={{}}
          clones={{}}
          menus={{}}
          disabled={[]}
          nameOf={(key) => key}
          picOf={() => undefined}
          picsPending={false}
          factionOf={() => undefined}
          onSelect={() => {}}
        />,
      );
      expect(rowButtons().length).toBeGreaterThan(0);
    });
  });
});

describe("the selected unit", () => {
  it("is on screen even when it sorts past the end of the first window", () => {
    measured(() => {
      draw({ selected: "unit540" });
      const mounted = rowButtons().map((b) => b.getAttribute("data-row"));
      expect(mounted).toContain("540");
    });
  });

  it("is the list's one tab stop", () => {
    measured(() => {
      draw({ selected: "unit540" });
      const stops = rowButtons().filter((b) => b.tabIndex === 0);
      expect(stops).toHaveLength(1);
      expect(stops[0].textContent).toContain("unit540");
    });
  });
});

describe("the arrow keys", () => {
  it("move focus down the list, past the end of the window", () => {
    measured(() => {
      draw({ selected: "unit000" });
      rowButtons()[0].focus();
      for (let i = 0; i < 40; i++) {
        fireEvent.keyDown(document.activeElement as Element, {
          key: "ArrowDown",
        });
      }
      expect(document.activeElement?.textContent).toContain("unit040");
    });
  });

  it("stop at the last unit rather than running off the end", () => {
    measured(() => {
      draw();
      rowButtons()[0].focus();
      fireEvent.keyDown(document.activeElement as Element, { key: "End" });
      expect(document.activeElement?.textContent).toContain("unit599");
      fireEvent.keyDown(document.activeElement as Element, {
        key: "ArrowDown",
      });
      expect(document.activeElement?.textContent).toContain("unit599");
    });
  });
});

describe("picking a unit", () => {
  it("reports the unit whose row was clicked", () => {
    const onSelect = vi.fn();
    measured(() => {
      draw({ onSelect });
      fireEvent.click(rowButtons()[3]);
    });
    expect(onSelect).toHaveBeenCalledWith("unit003");
  });
});
