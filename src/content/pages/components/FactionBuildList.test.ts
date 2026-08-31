import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { UnitDatasetEntry } from "../../bindings";

vi.mock("@picoframe/frame", () => ({
  Button: (props: {
    children?: ReactNode;
    disabled?: boolean;
    className?: string;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        disabled: props.disabled,
        className: props.className,
      },
      props.children,
    ),
  useDrawer: () => ({ open: () => {} }),
  // The browse-units link styles itself through these rather than through
  // `Button`, matching how the real component composes a `Link` into a
  // button look (see `home/suggestedMap.test.ts` for the same stand-in).
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
  buttonVariants: () => "button-variant",
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
      // The browse-units button is a real `Link`, which needs a router context
      // to render at all (see `home/suggestedMap.test.ts` for the same wrap).
      createElement(
        MemoryRouter,
        null,
        createElement(FactionBuildList, {
          enginePath: "",
          dataDir: "",
          gameArchive: "",
          gameName: "Test Game",
          sides: [{ name: "Arm", startUnit: "armcom" }],
          units,
          buildpics: null,
        }),
      ),
    );
    // Without folding the morph stage in, armcom's own buildOptions is empty
    // and the count would read 1 (armcom alone).
    expect(html).not.toContain("1 units");
    expect(html).toContain("2 units");
  });

  it("still counts correctly when the side's start unit is a non-base stage", () => {
    // The engine can report the upgraded stage as the spawn unit rather than
    // the base morphGroups picked. The folded edge map only has the base as a
    // key, so resolving the raw stage id straight to reachableCounts would
    // find nothing and read 0.
    const units = [
      unit("armcom", [], ["armcom1"]),
      unit("armcom1", ["armsolar"]),
      unit("armsolar"),
    ];
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(FactionBuildList, {
          enginePath: "",
          dataDir: "",
          gameArchive: "",
          gameName: "Test Game",
          sides: [{ name: "Arm", startUnit: "armcom1" }],
          units,
          buildpics: null,
        }),
      ),
    );
    // Unresolved, the count reads 0 and the button renders no "N units" text
    // at all (only shown when count > 0) and stays disabled.
    expect(html).toContain("2 units");
    expect(html).not.toContain("disabled");
  });
});
