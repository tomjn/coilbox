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

// The real `OptionSelect` is a Radix `Select`, whose trigger is a button
// rather than a form control: `fireEvent.change` has nothing to act on. A
// plain native select stands in, the same swap `UnitPage.dom.test.tsx` makes
// for the same reason (issue #3109's faction and changed filters).
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

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

function unitListProps(
  over: Partial<Parameters<typeof UnitList>[0]> = {},
): Parameters<typeof UnitList>[0] {
  return {
    units: units(600),
    selected: "",
    overrides: {},
    text: {},
    clones: {},
    menus: {},
    disabled: [],
    nameOf: (key) => key,
    picOf: () => undefined,
    picsPending: false,
    factionOf: () => undefined,
    weaponDefs: {},
    library: {},
    equipped: {},
    onSelect: () => {},
    ...over,
  };
}

function draw(
  over: Partial<Parameters<typeof UnitList>[0]> = {},
): ReturnType<typeof render> {
  return render(<UnitList {...unitListProps(over)} />);
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

describe("restrictTo", () => {
  it("scopes the list to the given units, on top of the search box", () => {
    draw({ restrictTo: new Set(["unit001", "unit002"]) });
    expect(screen.getByText("2 units")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "unit002" },
    });
    expect(screen.getByText("1 of 2 units")).toBeTruthy();
  });

  it("says a collection is empty rather than that nothing matches a search", () => {
    draw({ restrictTo: new Set() });
    expect(
      screen.getByText("This collection has no units in it yet."),
    ).toBeTruthy();
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
    //
    // The huge game arrives by rerender rather than by a fresh mount, and that
    // is the whole of issue #2722. A container has no measured height until the
    // ResizeObserver has fired, which is after the first render, and
    // `visibleRowWindow` renders every row until then rather than none. So a
    // cold mount of 5000 rows built 5000 of them once before windowing them
    // down to 16: measured at 1213ms against 142ms for 600 and 4ms to build the
    // fixture itself, and 7.6s on a loaded worker pool, which is what blew the
    // 5 second budget. Coming in by rerender the same claim costs 6ms, because
    // the height is already known by then. Nothing is given up: the steady
    // state is what the claim is about, and a windowing regression still mounts
    // 5000 rows here.
    measured(() => {
      const view = draw();
      const hundreds = rowButtons().length;
      view.rerender(<UnitList {...unitListProps({ units: units(5000) })} />);
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
      view.rerender(<UnitList {...unitListProps({ units: units(20) })} />);
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

describe("searching by stat (issue #2656)", () => {
  function unitsWithHealth(): Record<string, Record<string, unknown>> {
    return {
      unit000: { health: 1000 },
      unit001: { health: 5000 },
      unit002: { health: 9000 },
    };
  }

  it("filters by a comparison against the unit's own fields", () => {
    draw({ units: unitsWithHealth() });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "hp > 4000" },
    });
    expect(screen.getByText("2 of 3 units")).toBeTruthy();
  });

  it("reads an override before the game's own field", () => {
    draw({
      units: unitsWithHealth(),
      overrides: { unit000: { health: 9999 } },
    });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "hp > 9000" },
    });
    expect(screen.getByText("1 of 3 units")).toBeTruthy();
  });

  it("shows a bad query's own error rather than matching nothing quietly", () => {
    draw({ units: unitsWithHealth() });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "hp > vtol" },
    });
    expect(screen.getByText(/needs a number/)).toBeTruthy();
  });

  it("still does a plain name search when the query has no comparison", () => {
    draw({ units: unitsWithHealth() });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "unit001" },
    });
    expect(screen.getByText("1 of 3 units")).toBeTruthy();
  });
});

describe("the faction and changed filters (issue #3109)", () => {
  function twoFactions(): Record<string, Record<string, unknown>> {
    return {
      unit000: {},
      unit001: {},
      unit002: {},
    };
  }

  /** Arm for even-numbered units, Core for odd, so a two-faction game is one
   *  fixture rather than a build graph. */
  const factionOf = (key: string) =>
    Number(key.slice(-3)) % 2 === 0 ? "Arm" : "Core";

  it("offers no faction picker when factionOf answers nothing for any unit", () => {
    draw();
    expect(screen.queryByLabelText("Filter units by faction")).toBeNull();
  });

  it("narrows the list to the picked faction", () => {
    draw({ units: twoFactions(), factionOf });
    expect(screen.getByText("3 units")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter units by faction"), {
      target: { value: "Core" },
    });
    expect(screen.getByText("1 unit")).toBeTruthy();
    expect(rowButtons()).toHaveLength(1);
    expect(rowButtons()[0].textContent).toContain("unit001");
  });

  it("narrows to units with edits, including an added unit", () => {
    draw({
      units: twoFactions(),
      overrides: { unit000: { health: 5000 } },
      clones: {
        unit002: {
          key: "unit002",
          replacesGameUnit: false,
          def: {},
        },
      },
    });
    expect(screen.getByText("3 units")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter units by changes"), {
      target: { value: "changed" },
    });
    expect(screen.getByText("2 units")).toBeTruthy();
    const shown = rowButtons().map((b) => b.textContent);
    expect(shown.some((t) => t?.includes("unit000"))).toBe(true);
    expect(shown.some((t) => t?.includes("unit002"))).toBe(true);
    expect(shown.some((t) => t?.includes("unit001"))).toBe(false);
  });

  it("combines the faction and changed filters", () => {
    draw({
      units: twoFactions(),
      // Even-numbered units are Arm, odd are Core: unit000 and unit002 are
      // both Arm, so only a changed Core unit tells the two filters apart.
      factionOf,
      overrides: { unit000: { health: 5000 } },
      clones: {
        unit001: {
          key: "unit001",
          replacesGameUnit: false,
          def: {},
        },
      },
    });
    fireEvent.change(screen.getByLabelText("Filter units by faction"), {
      target: { value: "Arm" },
    });
    fireEvent.change(screen.getByLabelText("Filter units by changes"), {
      target: { value: "changed" },
    });
    // unit000 and unit001 both have edits, but only unit000 is Arm.
    expect(screen.getByText("1 unit")).toBeTruthy();
    expect(rowButtons()).toHaveLength(1);
    expect(rowButtons()[0].textContent).toContain("unit000");
  });

  it("combines with the search box and the collection restriction too", () => {
    draw({
      units: { ...twoFactions(), unit003: {} },
      factionOf,
      restrictTo: new Set(["unit000", "unit001", "unit002"]),
      overrides: { unit000: { health: 5000 }, unit002: { health: 6000 } },
    });
    fireEvent.change(screen.getByLabelText("Filter units by faction"), {
      target: { value: "Arm" },
    });
    fireEvent.change(screen.getByLabelText("Filter units by changes"), {
      target: { value: "changed" },
    });
    // Arm plus changed leaves unit000 and unit002. unit003 is excluded by
    // the collection, and unit001 is neither Arm nor changed.
    expect(screen.getByText("2 units")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "unit002" },
    });
    expect(screen.getByText("1 of 2 units")).toBeTruthy();
  });

  it("counts a disabled unit and a build-menu edit as changed too", () => {
    draw({
      units: twoFactions(),
      menus: { unit000: [{ op: "add", unit: "unit001" }] },
      disabled: ["unit002"],
    });
    fireEvent.change(screen.getByLabelText("Filter units by changes"), {
      target: { value: "changed" },
    });
    expect(screen.getByText("2 units")).toBeTruthy();
    const shown = rowButtons().map((b) => b.textContent);
    expect(shown.some((t) => t?.includes("unit001"))).toBe(false);
  });
});

describe("searching by a derived stat (issue #3074)", () => {
  const gameLaser = {
    weaponType: "Cannon",
    range: 300,
    reloadTime: 2,
    damage: { default: 50 },
  };
  /** 50 damage every 2 seconds: a DPS of 25. */
  const gunned = {
    weapons: [{ name: "unit000_laser" }],
    weapondefs: { laser: gameLaser },
  };
  const unarmed = {};

  function unitsWithWeapons(): Record<string, Record<string, unknown>> {
    return { unit000: gunned, unit001: unarmed };
  }

  it("filters by dps, resolved off the unit's own weapon", () => {
    draw({ units: unitsWithWeapons() });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "dps > 20" },
    });
    expect(screen.getByText("1 of 2 units")).toBeTruthy();
  });

  it("stands an equipped library weapon in for the unit's own (issue #3081)", () => {
    draw({
      units: unitsWithWeapons(),
      library: {
        bigcannon: {
          key: "bigcannon",
          source: "bigcannon",
          def: {
            weaponType: "Cannon",
            range: 500,
            reloadTime: 1,
            damage: { default: 5 },
          },
        },
      },
      equipped: { unit000: { "0": "bigcannon" } },
    });
    // The equipped weapon's DPS is 5, not the game laser's 25, so a query
    // for dps > 20 no longer matches unit000.
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "dps > 20" },
    });
    expect(screen.getByText("0 of 2 units")).toBeTruthy();
  });

  it("never matches a unit derivedStats.ts cannot state a number for, rather than as zero", () => {
    draw({ units: unitsWithWeapons() });
    fireEvent.change(screen.getByLabelText("Search units"), {
      target: { value: "dps < 999999" },
    });
    // unit001 has no weapon at all, so its dps is null, not zero: it must
    // not match an upper-bound comparison either.
    expect(screen.getByText("1 of 2 units")).toBeTruthy();
  });
});
