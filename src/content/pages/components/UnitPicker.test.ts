import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
// Static markup attaches no real DOM listeners, so a toggle test cannot click a
// checkbox. It can still capture the exact closure React built for a row during
// the render call, and invoke it directly, which is what this records.
const { checkboxes } = vi.hoisted(() => ({
  checkboxes: [] as {
    label?: string;
    onCheckedChange?: (v: boolean) => void;
  }[],
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: (props: {
    onCheckedChange?: (v: boolean) => void;
    "aria-label"?: string;
  }) => {
    checkboxes.push({
      label: props["aria-label"],
      onCheckedChange: props.onCheckedChange,
    });
    return createElement("input", { type: "checkbox", readOnly: true });
  },
}));
// Radix mounts a popover's content through a Presence-gated portal, so it
// renders nothing while closed, and these tests never open one interactively.
// Rendering the content unconditionally is what lets a static render see it.
vi.mock("@/components/ui/popover", () => ({
  Popover: (props: { children?: ReactNode }) =>
    createElement("div", {}, props.children),
  PopoverTrigger: (props: { children?: ReactNode }) => props.children,
  PopoverContent: (props: { children?: ReactNode }) =>
    createElement("div", {}, props.children),
}));

const { UnitPicker, UnitPickerButton } = await import("./UnitPicker");

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

/** A commander with two upgrade stages, which used to be three separate rows
 * (issue #2063). */
const MORPH_UNITS = [
  unit("armcom", "Commander", [], ["armcom1"]),
  unit("armcom1", "Commander", [], ["armcom2"]),
  unit("armcom2", "Commander"),
];
const MORPH_FACTIONS = [{ startUnit: "armcom", name: "Armada" }];

function renderMorph(selected: string[] = []) {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(
    createElement(UnitPicker, {
      units: MORPH_UNITS,
      factions: MORPH_FACTIONS,
      selected,
      onChange,
    }),
  );
  return { html, onChange };
}

function renderMorphButton(): string {
  return renderToStaticMarkup(
    createElement(UnitPickerButton, {
      units: MORPH_UNITS,
      factions: MORPH_FACTIONS,
      value: "",
      onValueChange: () => {},
    }),
  );
}

describe("the unit picker's morph groups", () => {
  beforeEach(() => {
    checkboxes.length = 0;
  });

  it("offers one row for a commander's upgrades, not one per stage", () => {
    const { html } = renderMorph();
    expect(html).not.toContain("armcom1");
    expect(html).not.toContain("armcom2");
    expect(html).toContain("Commander, 2 upgrades");
  });

  it("selects every stage when the group's row is turned on", () => {
    const { onChange } = renderMorph([]);
    const row = checkboxes.find((c) => c.label?.includes("upgrades"));
    expect(row).toBeDefined();
    row?.onCheckedChange?.(true);
    expect(onChange).toHaveBeenCalledWith(["armcom", "armcom1", "armcom2"]);
  });

  it("clears every stage when the group's row is turned off, even half selected", () => {
    // Only the one stage stored is the hole a group toggle exists to close: the
    // commander would read as disabled in some places and buildable in others.
    const { onChange } = renderMorph(["armcom1"]);
    const row = checkboxes.find((c) => c.label?.includes("upgrades"));
    expect(row).toBeDefined();
    row?.onCheckedChange?.(false);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("still lists every stage on its own row for a single-select picker", () => {
    // Placing an exact stage (e.g. a scenario's starting unit) needs the stage
    // itself, so the fold that serves restrictions and unlocks does not apply
    // here.
    const html = renderMorphButton();
    expect(html).toContain("armcom1");
    expect(html).toContain("armcom2");
    expect(html).not.toContain("upgrades");
  });
});
