// @vitest-environment happy-dom
/**
 * The drawer's focus panel and search box (issue #384), driven with a real DOM.
 * React Flow is stood in for by one button per node that fires `onNodeClick`
 * and `onPaneClick`, and the panel's model viewport by nothing, so what is under
 * test is the drawer's own state: click or search focuses a unit, and the panel
 * then shows that unit's stats.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    nodes: { id: string; data: { label: string } }[];
    onNodeClick?: (e: unknown, node: { id: string }) => void;
    onPaneClick?: () => void;
  }) =>
    createElement(
      "div",
      { "data-testid": "flow" },
      createElement("button", {
        type: "button",
        "data-testid": "pane",
        onClick: () => props.onPaneClick?.(),
      }),
      props.nodes.map((n) =>
        createElement(
          "button",
          {
            key: n.id,
            type: "button",
            "data-node-id": n.id,
            onClick: () => props.onNodeClick?.({}, n),
          },
          n.data.label,
        ),
      ),
    ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({ fitView: () => {} }),
}));
vi.mock("@xyflow/react/dist/style.css", () => ({}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));
vi.mock("../../config", () => ({
  useUnitsyncUnitBuildpics: () => null,
  useUnitsyncUnitModel: () => ({
    model: null,
    loading: false,
    failed: false,
    error: null,
    retry: () => {},
  }),
}));
vi.mock("./BuildTreeExportButton", () => ({
  BuildTreeExportButton: () => null,
}));
vi.mock("./ModelViewport", () => ({
  ModelViewport: () => null,
  ModelNotes: () => null,
  Note: ({ children }: { children?: unknown }) =>
    createElement("p", {}, children as never),
}));
vi.mock("@/hub/assets/renderTop", () => ({
  RENDER_VERSION: 1,
  renderUnit: async () => ({}),
}));

const { BuildTreeDrawer } = await import("./BuildTreeDrawer");

function unit(
  name: string,
  fullName: string,
  buildOptions: string[] = [],
  stats?: Record<string, unknown>,
): UnitDatasetEntry {
  return { name, fullName, buildOptions, stats } as UnitDatasetEntry;
}

const units = [
  unit("armcom", "Arm Commander", ["armlab", "armsolar"]),
  unit("armlab", "Bot Lab", ["armpw"], {
    health: 1500,
    metalCost: 650,
    weapons: [{ damage: 12, reload: 0.5, range: 180, projectile: "laser" }],
  }),
  unit("armsolar", "Solar Collector"),
  unit("armpw", "Peewee", [], { health: 250, energyCost: 900 }),
];

function renderDrawer() {
  return render(
    createElement(BuildTreeDrawer, {
      enginePath: "",
      dataDir: "",
      gameArchive: "",
      sides: [{ name: "Arm", startUnit: "armcom" }] as never,
      units,
      initialSide: "Arm",
    }),
  );
}

const nodeButton = (id: string) =>
  document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const panel = () => document.querySelector("aside");
const search = () => screen.getByRole("combobox");

afterEach(cleanup);

describe("the focus panel", () => {
  it("is closed until a unit is clicked", () => {
    renderDrawer();
    expect(panel()).toBeNull();
  });

  it("shows the clicked unit's stats and weapons beside the tree", () => {
    renderDrawer();
    fireEvent.click(nodeButton("armlab"));
    const text = panel()?.textContent ?? "";
    expect(text).toContain("Bot Lab");
    expect(text).toContain("Health");
    expect(text).toContain("1500");
    expect(text).toContain("Metal cost");
    expect(text).toContain("650");
    expect(text).toContain("laser");
    expect(text).not.toContain("Energy cost");
  });

  it("swaps to another unit's stats when that unit is clicked", () => {
    renderDrawer();
    fireEvent.click(nodeButton("armlab"));
    fireEvent.click(nodeButton("armpw"));
    const text = panel()?.textContent ?? "";
    expect(text).toContain("Peewee");
    expect(text).toContain("250");
    expect(text).toContain("Energy cost");
    expect(text).not.toContain("650");
  });

  it("still opens for a unit with no stats, without a stats block", () => {
    renderDrawer();
    fireEvent.click(nodeButton("armsolar"));
    expect(panel()?.textContent).toContain("Solar Collector");
    expect(panel()?.querySelector("dl")).toBeNull();
  });

  it("closes when the empty pane is clicked", () => {
    renderDrawer();
    fireEvent.click(nodeButton("armlab"));
    fireEvent.click(screen.getByTestId("pane"));
    expect(panel()).toBeNull();
  });
});

describe("the search box", () => {
  it("lists matching units by name or def key", () => {
    renderDrawer();
    fireEvent.change(search(), { target: { value: "lab" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Bot Lab");
    expect(options[0].textContent).toContain("armlab");
    fireEvent.change(search(), { target: { value: "armp" } });
    expect(screen.getByRole("option").textContent).toContain("Peewee");
  });

  it("says so when nothing matches", () => {
    renderDrawer();
    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText("No units match.")).toBeTruthy();
  });

  it("focuses the picked unit, showing its stats, and clears the box", () => {
    renderDrawer();
    fireEvent.change(search(), { target: { value: "peewee" } });
    fireEvent.mouseDown(screen.getByRole("option"));
    expect(panel()?.textContent).toContain("Peewee");
    expect(panel()?.textContent).toContain("250");
    expect((search() as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("picks the highlighted result on Enter and moves it with the arrows", () => {
    renderDrawer();
    // Every def key starts with "ar", so all four match, in label order.
    fireEvent.change(search(), { target: { value: "ar" } });
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toHaveLength(4);
    expect(labels[1]).toContain("Bot Lab");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(panel()?.textContent).toContain("Bot Lab");
  });

  it("clears the box on the first Escape and leaves focus on the second", () => {
    renderDrawer();
    fireEvent.click(nodeButton("armlab"));
    fireEvent.change(search(), { target: { value: "bot" } });
    fireEvent.keyDown(search(), { key: "Escape" });
    expect((search() as HTMLInputElement).value).toBe("");
    expect(panel()).not.toBeNull();
    // The drawer's own Escape handler is on the window.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel()).toBeNull();
  });
});
