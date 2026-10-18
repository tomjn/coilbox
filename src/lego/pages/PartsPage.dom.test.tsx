// @vitest-environment happy-dom

/**
 * What the detail panel on the Lego Parts page shows after a click (#4523).
 * The two grids and the panel's contents are replaced by buttons and a name, so
 * the test sees only which of them the page chooses to show.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../model";
import type { LegoPartInfo, LoadedPack } from "../pack";

const part = { id: "p1", name: "grey block" } as unknown as LegoPartInfo;
const module = { id: "m1", name: "Hull section" } as unknown as LegoProject;
const pack = {} as unknown as LoadedPack;

vi.mock("../pack", () => ({ loadPack: () => Promise.resolve(pack) }));
vi.mock("../projects", () => ({
  deleteCompound: () => Promise.resolve(),
  saveCompound: () => Promise.resolve(),
  useModules: () => [module],
}));
vi.mock("../useModuleFiles", () => ({
  useModuleFiles: () => ({ loadFile: () => {}, saveFile: () => {} }),
}));
vi.mock("../useModuleShare", () => ({
  useShareModule: () => () => {},
  useSharedModuleImport: () => {},
}));
vi.mock("../moduleFilter", () => ({ withLabels: (m: unknown) => m }));
vi.mock("../inventory", () => ({ useInventoryView: () => ({}) }));

vi.mock("./components/PartFilters", () => ({
  PackAtlases: () => null,
  PackProblems: () => null,
}));

vi.mock("./components/Inventory", async () => {
  type Grids = {
    onSelectPart: (part: LegoPartInfo, alt: boolean) => void;
    onSelectModule: (module: LegoProject) => void;
    aside: React.ReactNode;
  };
  return {
    InventoryFilters: () => null,
    InventoryGrids: ({ onSelectPart, onSelectModule, aside }: Grids) => (
      <>
        <button type="button" onClick={() => onSelectPart(part, false)}>
          pick part
        </button>
        <button type="button" onClick={() => onSelectModule(module)}>
          pick module
        </button>
        {aside}
      </>
    ),
  };
});

vi.mock("./components/PartDetail", () => ({
  PartDetail: ({ part }: { part: LegoPartInfo }) => (
    <aside aria-label="details">{part.name}</aside>
  ),
  ShapeDetail: () => null,
}));

import PartsPage from "./PartsPage";

afterEach(cleanup);

describe("the detail panel", () => {
  it("opens for a part", async () => {
    render(<PartsPage />);
    fireEvent.click(await screen.findByText("pick part"));
    expect(screen.getByLabelText("details").textContent).toBe("grey block");
  });

  it("closes when a module is clicked, rather than keeping the part", async () => {
    render(<PartsPage />);
    fireEvent.click(await screen.findByText("pick part"));
    fireEvent.click(screen.getByText("pick module"));
    expect(screen.queryByLabelText("details")).toBeNull();
  });
});
