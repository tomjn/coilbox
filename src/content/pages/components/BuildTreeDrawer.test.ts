import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

// React Flow needs real DOM measurement/canvas machinery this test doesn't
// have, so it's stubbed down to one div per node: enough to see which nodes
// and labels the drawer builds, without any of React Flow's own rendering.
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { nodes: { id: string; data: { label: string } }[] }) =>
    createElement(
      "div",
      {},
      props.nodes.map((n) =>
        createElement("div", { key: n.id, "data-node-id": n.id }, n.data.label),
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
vi.mock("../../config", () => ({
  useUnitsyncUnitBuildpics: () => null,
}));
// Neither renders in these tests (no gameName, no focused unit). Mocked so
// their own heavy dependency trees (tauri dialog, hub asset rendering) never
// have to load.
vi.mock("./BuildTreeExportButton", () => ({
  BuildTreeExportButton: () => null,
}));
vi.mock("./UnitModelPanel", () => ({
  UnitModelPanel: () => null,
}));

const { BuildTreeDrawer } = await import("./BuildTreeDrawer");

function unit(
  name: string,
  buildOptions: string[] = [],
  morphTargets?: string[],
): UnitDatasetEntry {
  return {
    name,
    buildOptions,
    morphTargets: morphTargets?.map((into) => ({ into })),
  } as UnitDatasetEntry;
}

describe("BuildTreeDrawer's morph fold", () => {
  it("draws a commander's upgrade stage as part of the commander's node", () => {
    const units = [
      unit("armcom", ["armsolar"], ["armcom1"]),
      unit("armcom1", ["armsolar", "armlab"]),
      unit("armsolar"),
      unit("armlab"),
    ];
    const html = renderToStaticMarkup(
      createElement(BuildTreeDrawer, {
        enginePath: "",
        dataDir: "",
        gameArchive: "",
        sides: [{ name: "Arm", startUnit: "armcom" }],
        units,
        initialSide: "Arm",
      }),
    );
    // armcom1 is not a node of its own, what it builds shows under armcom.
    expect(html).not.toContain("armcom1");
    expect(html).toContain('data-node-id="armlab"');
    expect(html).toContain('data-node-id="armsolar"');
    // The folded node is labelled with its stage count.
    expect(html).toContain("armcom (2 stages)");
  });
});
