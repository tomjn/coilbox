// @vitest-environment happy-dom

/**
 * The Lego Parts page's frame (#4535) and what it hands the inventory grid.
 * The grid is replaced by what it was given, so the test sees only the page's
 * choices. `components/Inventory.dom.test.tsx` covers the detail panel.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../model";
import type { LoadedPack } from "../pack";
import { CELL } from "./components/TileGrid";

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
    escapeAnywhere?: boolean;
    scrollRoot?: unknown;
    onInsertModule?: unknown;
  };
  return {
    InventoryFilters: () => null,
    InventoryGrids: ({ escapeAnywhere, scrollRoot, onInsertModule }: Grids) => (
      <section
        aria-label="grid"
        data-escape={escapeAnywhere ? "anywhere" : "inside"}
        data-scroll={scrollRoot ? "page" : "own"}
        data-places={onInsertModule ? "yes" : "no"}
      >
        pick part
      </section>
    ),
  };
});

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

describe("the grid", () => {
  it("scrolls with the page, closes its panel on any Escape and places nothing", async () => {
    render(<PartsPage />);
    const grid = await screen.findByLabelText("grid");
    expect(grid.getAttribute("data-scroll")).toBe("page");
    expect(grid.getAttribute("data-escape")).toBe("anywhere");
    expect(grid.getAttribute("data-places")).toBe("no");
  });
});
