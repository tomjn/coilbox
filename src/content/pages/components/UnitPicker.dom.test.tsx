// @vitest-environment happy-dom
/**
 * Regression: typing a morph stage's own def key into the picker's search box
 * used to return "No units match." (issue #2063's own follow-up review).
 *
 * `UnitPicker.test.ts` covers the fold and the toggle with `renderToStaticMarkup`,
 * which never attaches real listeners, so it cannot drive the search box. This
 * file opens a real DOM instead, because proving the fix means actually typing
 * into the input and reading what comes back, not just inspecting the initial
 * markup.
 *
 * The windowing (issue #2715) is here for the same reason: the list used to stop
 * at 500 rows and ask for a search term, and proving that every unit is reachable
 * now means scrolling a real container and reading what mounted.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ChangeEvent, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

vi.mock("@picoframe/frame", () => ({
  Button: (props: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) =>
    createElement(
      "button",
      { type: "button", disabled: props.disabled, onClick: props.onClick },
      props.children,
    ),
  // Unlike `UnitPicker.test.ts`'s read-only stand-in, this one carries a real
  // `onChange` through: proving the search fix means actually typing into it.
  Input: (props: {
    value?: string;
    placeholder?: string;
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  }) =>
    createElement("input", {
      value: props.value,
      placeholder: props.placeholder,
      onChange: props.onChange,
    }),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));
vi.mock("../../config", () => ({
  useUnitsyncUnitBuildpics: () => null,
  useUnitsyncScan: () => ({ data: null, loading: false }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
  useUnitsyncUnitDataset: () => ({ dataset: null, status: "idle" }),
}));

const { UnitPicker } = await import("./UnitPicker");

function unit(
  name: string,
  fullName: string,
  buildOptions: string[] = [],
  morphTargets?: string[],
) {
  return {
    name,
    fullName,
    buildOptions,
    morphTargets: morphTargets?.map((into) => ({ into })),
  } as UnitDatasetEntry;
}

/** A commander with two upgrade stages, folded into one row (issue #2063). */
const MORPH_UNITS = [
  unit("armcom", "Commander", [], ["armcom1"]),
  unit("armcom1", "Commander", [], ["armcom2"]),
  unit("armcom2", "Commander"),
];
const MORPH_FACTIONS = [{ startUnit: "armcom", name: "Armada" }];

afterEach(cleanup);

describe("the unit picker's search", () => {
  it("finds a folded stage's row by the stage's own def key", () => {
    render(
      createElement(UnitPicker, {
        units: MORPH_UNITS,
        factions: MORPH_FACTIONS,
        selected: [],
        onChange: () => {},
      }),
    );

    fireEvent.change(screen.getByPlaceholderText("Search units…"), {
      target: { value: "armcom1" },
    });

    // armcom1 is not a row of its own (it's folded into armcom's), so finding
    // it means finding the base's row, not "No units match.".
    expect(screen.getByText("Commander, 2 upgrades")).not.toBeNull();
    expect(screen.queryByText("No units match.")).toBeNull();
  });
});

/** happy-dom's ResizeObserver is a stub that never calls back, so a test that
 *  needs a measured container brings its own, firing once with a fixed height.
 *  Copied from `UnitList.dom.test.tsx`, which windows the same way. */
class FixedSizeResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback(
      [{ contentRect: { height: 320 } } as ResizeObserverEntry],
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

/**
 * Two sides of `perSide` units each, plus the commander that roots each side, so
 * the list has faction headings between its blocks the way a real game's does.
 * Named so a unit's sort order is its index within its side.
 */
function twoSides(perSide: number): UnitDatasetEntry[] {
  const units: UnitDatasetEntry[] = [];
  for (const side of ["arm", "cor"]) {
    const kids = Array.from(
      { length: perSide },
      (_, i) => `${side}unit${String(i).padStart(3, "0")}`,
    );
    units.push(unit(`${side}com`, `${side}com`, kids));
    for (const kid of kids) units.push(unit(kid, kid));
  }
  return units;
}

const TWO_SIDES = [
  { startUnit: "armcom", name: "Armada" },
  { startUnit: "corcom", name: "Cortex" },
];

function drawBig(perSide = 300) {
  return render(
    createElement(UnitPicker, {
      units: twoSides(perSide),
      factions: TWO_SIDES,
      selected: [],
      onChange: () => {},
    }),
  );
}

const rowEls = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-row]"));
const scroller = () =>
  rowEls()[0].closest("ul")?.parentElement?.parentElement as HTMLElement;

describe("a game bigger than the cap that used to be here", () => {
  it("counts every unit and never asks for a search term", () => {
    drawBig();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
    // The caller's own count already carries the total, so the list does not
    // print a second one beside it saying the same thing.
    expect(screen.getByText("0 of 602 selected")).not.toBeNull();
  });

  it("gives both numbers while a search narrows the list", () => {
    drawBig();
    fireEvent.change(screen.getByPlaceholderText("Search units…"), {
      target: { value: "corunit1" },
    });
    // corunit100 to corunit199: a hundred of the six hundred and two.
    expect(screen.getByText("100 of 602 units")).not.toBeNull();
  });

  it("mounts far fewer rows than units once the container is measured", () => {
    measured(() => {
      drawBig();
      expect(rowEls().length).toBeGreaterThan(0);
      expect(rowEls().length).toBeLessThan(100);
    });
  });

  it("reaches the last unit of the last faction by scrolling", () => {
    measured(() => {
      drawBig();
      // Past the end on purpose: the window clamps to the bottom of the list,
      // which is where the units the cap used to hide are.
      fireEvent.scroll(scroller(), { target: { scrollTop: 100000 } });
      // By its checkbox's label, since a row prints the unit's name and its def
      // key and this fixture's units are named after their keys.
      expect(screen.getByLabelText("corunit299")).not.toBeNull();
    });
  });

  it("tells a screen reader each unit's place in the whole list", () => {
    measured(() => {
      drawBig();
      const first = rowEls()[0].closest("li");
      expect(first?.getAttribute("aria-setsize")).toBe("602");
      expect(first?.getAttribute("aria-posinset")).toBe("1");
    });
  });

  it("is one tab stop, whose arrow keys walk past the end of the window", () => {
    measured(() => {
      drawBig();
      expect(rowEls().filter((el) => el.tabIndex === 0)).toHaveLength(1);
      rowEls()[0].focus();
      for (let i = 0; i < 40; i++) {
        fireEvent.keyDown(document.activeElement as Element, {
          key: "ArrowDown",
        });
      }
      // 40 rows down from the first unit, over a faction heading that is a row
      // of the list but not a stop on the way through it.
      expect(document.activeElement?.closest("li")?.textContent).toContain(
        "armunit039",
      );
    });
  });
});
