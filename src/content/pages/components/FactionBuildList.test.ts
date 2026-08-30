import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

vi.mock("@picoframe/frame", () => ({
  Button: (props: { children?: ReactNode; disabled?: boolean }) =>
    createElement(
      "button",
      { type: "button", disabled: props.disabled },
      props.children,
    ),
  useDrawer: () => ({ open: () => {} }),
}));
// The drawer never opens in this test (the button is never clicked), so its
// own React Flow dependency tree never has to load.
vi.mock("./BuildTreeDrawer", () => ({
  BuildTreeDrawer: () => null,
}));

const { FactionBuildList } = await import("./FactionBuildList");

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

describe("FactionBuildList's Sides card count", () => {
  it("counts what an upgrade stage builds under the commander's reachable count", () => {
    // armcom itself builds nothing directly. Everything it can reach comes
    // through its upgrade stage, armcom1.
    const units = [
      unit("armcom", [], ["armcom1"]),
      unit("armcom1", ["armsolar"]),
      unit("armsolar"),
    ];
    const html = renderToStaticMarkup(
      createElement(FactionBuildList, {
        enginePath: "",
        dataDir: "",
        gameArchive: "",
        gameName: "Test Game",
        sides: [{ name: "Arm", startUnit: "armcom" }],
        units,
        buildpics: null,
      }),
    );
    // Without folding the morph stage in, armcom's own buildOptions is empty
    // and the count would read 1 (armcom alone).
    expect(html).not.toContain("1 units");
    expect(html).toContain("2 units");
  });
});
