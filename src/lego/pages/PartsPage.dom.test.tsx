// @vitest-environment happy-dom

/**
 * The Lego Parts page's frame (#4535) and what its detail panel shows after a
 * click (#4523). The two grids and the panel's contents are replaced by buttons
 * and a name, so the test sees only which of them the page chooses to show.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../model";
import type { LegoPartInfo, LoadedPack } from "../pack";
import { CELL } from "./components/TileGrid";

const part = { id: "p1", name: "grey block" } as unknown as LegoPartInfo;
const module = { id: "m1", name: "Hull section" } as unknown as LegoProject;
function packWith(
  over: { packs?: string[]; problems?: string[] } = {},
): LoadedPack {
  return {
    library: {
      packs: (over.packs ?? ["lego"]).map((id) => ({ id })),
      problems: over.problems ?? [],
      atlases: [],
      dir: "/packs",
    },
  } as unknown as LoadedPack;
}

const state = vi.hoisted(() => ({
  load: (): Promise<unknown> => new Promise(() => {}),
  loadFile: () => {},
}));

vi.mock("../pack", () => ({ loadPack: () => state.load() }));
vi.mock("../projects", () => ({
  deleteCompound: () => Promise.resolve(),
  saveCompound: () => Promise.resolve(),
  useModules: () => [module],
}));
vi.mock("../useModuleFiles", () => ({
  useModuleFiles: () => ({ loadFile: state.loadFile, saveFile: () => {} }),
}));
vi.mock("../useModuleShare", () => ({
  useShareModule: () => () => {},
  useSharedModuleImport: () => {},
}));
vi.mock("../moduleFilter", () => ({ withLabels: (m: unknown) => m }));
vi.mock("../inventory", () => ({
  useInventoryView: () => ({
    partFilter: { packId: null, setPackId: () => {} },
  }),
}));

vi.mock("./components/PartFilters", async (actual) => ({
  ...(await actual<typeof import("./components/PartFilters")>()),
  PackAtlases: () => null,
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

beforeEach(() => {
  state.load = () => Promise.resolve(packWith());
  state.loadFile = () => {};
});

afterEach(cleanup);

describe("the page frame", () => {
  it("has a title and no description", async () => {
    const { container } = render(<PartsPage />);
    await screen.findByText("pick part");
    expect(screen.getByRole("heading", { name: "Lego Parts" })).toBeTruthy();
    expect(container.querySelector("header p")).toBeNull();
  });

  it("puts Load from file in the header", async () => {
    const loadFile = vi.fn();
    state.loadFile = loadFile;
    render(<PartsPage />);
    const load = await screen.findByRole("button", { name: "Load from file" });
    expect(load.closest("header")).toBeTruthy();
    fireEvent.click(load);
    expect(loadFile).toHaveBeenCalledOnce();
  });

  it("puts the pack menu in the header only once there are two packs", async () => {
    const one = render(<PartsPage />);
    await screen.findByText("pick part");
    expect(screen.queryByLabelText("Parts pack")).toBeNull();
    one.unmount();

    state.load = () => Promise.resolve(packWith({ packs: ["lego", "extras"] }));
    render(<PartsPage />);
    await screen.findByText("pick part");
    expect(screen.getByLabelText("Parts pack").closest("header")).toBeTruthy();
  });

  it("shows pack problems as an alert only when there are any", async () => {
    const clean = render(<PartsPage />);
    await screen.findByText("pick part");
    expect(screen.queryByRole("alert")).toBeNull();
    clean.unmount();

    state.load = () =>
      Promise.resolve(packWith({ problems: ["extras: no pack.json"] }));
    render(<PartsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("extras: no pack.json");
  });

  it("draws the loading skeleton at the parts grid's cell size", () => {
    render(<PartsPage />);
    const cells = document.querySelectorAll("[data-slot=skeleton]");
    expect(cells.length).toBeGreaterThan(0);
    expect((cells[0] as HTMLElement).style.height).toBe(`${CELL}px`);
    expect(screen.queryByRole("button", { name: "Load from file" })).toBeNull();
  });

  it("says a missing pack in one line", async () => {
    state.load = () => Promise.reject(new Error("no pack.json"));
    render(<PartsPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No parts pack installed: no pack.json");
  });
});

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
