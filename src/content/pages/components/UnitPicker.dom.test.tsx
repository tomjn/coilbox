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
