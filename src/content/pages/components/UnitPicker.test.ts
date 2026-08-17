import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

// The picker pulls in picoframe and the unitsync bindings, whose published dists
// use extensionless relative imports Vitest's node resolver won't load from
// node_modules. Nothing here reads a game, so stubbing the leaves is enough
// (same approach as home/suggestedMap.test.ts).
vi.mock("@picoframe/frame", () => ({
  Button: (props: { children?: ReactNode; disabled?: boolean }) =>
    createElement(
      "button",
      { type: "button", disabled: props.disabled },
      props.children,
    ),
  Input: (props: { value?: string; placeholder?: string }) =>
    createElement("input", {
      readOnly: true,
      value: props.value,
      placeholder: props.placeholder,
    }),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));
vi.mock("../../config", () => ({
  useUnitsyncUnitBuildpics: () => null,
  useUnitsyncScan: () => ({ data: null, loading: false }),
  useUnitsyncGameInfo: () => ({ info: null, loading: false }),
  // No engine to read the whole game from, so the picker falls back to the list
  // it was handed, which is what a test without unitsync should get.
  useUnitsyncUnitDataset: () => ({ dataset: null, status: "idle" }),
}));

const { UnitPicker } = await import("./UnitPicker");

function unit(name: string, fullName: string, buildOptions: string[] = []) {
  return { name, fullName, buildOptions } as UnitDatasetEntry;
}

/** Two factions, and a builder whose units are alphabetically before it. */
const UNITS = [
  unit("armcom", "Armada Commander", ["armlab"]),
  unit("armlab", "Bot Lab", ["armpw"]),
  unit("armpw", "Peewee"),
  unit("corcom", "Cortex Commander", ["corsolar"]),
  unit("corsolar", "Solar Collector"),
  unit("rock", "Rock"),
];

const FACTIONS = [
  { startUnit: "armcom", name: "Armada" },
  { startUnit: "corcom", name: "Cortex" },
];

function render(selected: string[] = []): string {
  return renderToStaticMarkup(
    createElement(UnitPicker, {
      units: UNITS,
      factions: FACTIONS,
      selected,
      onChange: () => {},
    }),
  );
}

/** Order the unit names appear in, ignoring the rest of the markup. */
function order(html: string): string[] {
  return [...html.matchAll(/>([A-Z][A-Za-z ]+)</g)]
    .map((m) => m[1])
    .filter((t) => t !== "Search units");
}

describe("the unit picker's list", () => {
  it("heads a block per faction, in the order they were given", () => {
    const html = render();
    expect(html).toContain("Armada");
    expect(html).toContain("Cortex");
    expect(html.indexOf("Armada")).toBeLessThan(html.indexOf("Cortex"));
  });

  it("puts what a faction cannot build in its own block, last", () => {
    const html = render();
    expect(html).toContain("Other units");
    expect(html.indexOf("Cortex")).toBeLessThan(html.indexOf("Other units"));
  });

  it("sorts a faction's units by name, whatever builds them", () => {
    // The lab builds the Peewee, and the commander builds the lab, so a tree
    // put them on three indents. This is one alphabetical block (#1051).
    const names = order(render());
    expect(names.slice(0, 4)).toEqual([
      "Armada",
      "Armada Commander",
      "Bot Lab",
      "Peewee",
    ]);
  });

  it("has nothing to expand", () => {
    const html = render();
    expect(html).not.toContain("Expand");
    expect(html).not.toContain("Collapse");
    expect(html).not.toContain("subtree");
  });

  it("counts what is ticked against the total, in the caller's words", () => {
    // "1 selected" on its own reads as a complete answer. The total is what says
    // whether a fully-ticked list means everything or nearly everything.
    expect(render(["armpw"])).toContain("1 of 6 selected");
  });

  it("leaves a ticked row unhighlighted, since the checkbox is the state", () => {
    expect(render(["armpw"])).not.toContain("bg-primary/10");
  });
});
