// @vitest-environment happy-dom

/**
 * The one inventory (issue #3306): the kind filter, the recent and favourites
 * lists, and what is drawn for each. The two canvases are replaced with lists
 * of names, because what is under test is which items reach them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";

const store = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

vi.mock("@picoframe/frame", async (importOriginal) => {
  const { useState } = await import("react");
  return {
    ...(await importOriginal<typeof import("@picoframe/frame")>()),
    useSetting: (key: string, fallback: unknown) => {
      const [, bump] = useState(0);
      return [
        store.values.has(key) ? store.values.get(key) : fallback,
        (next: unknown) => {
          store.values.set(key, next);
          bump((n) => n + 1);
        },
      ];
    },
  };
});

vi.mock("./PartPicker", () => ({
  PartPicker: ({
    parts,
    favourites,
    onFavourite,
  }: {
    parts: LegoPartInfo[];
    favourites: ReadonlySet<string>;
    onFavourite: (part: LegoPartInfo) => void;
  }) => (
    <ul aria-label="part grid">
      {parts.map((part) => (
        <li key={part.id}>
          {part.name}
          <button type="button" onClick={() => onFavourite(part)}>
            {favourites.has(part.id) ? "unstar" : "star"} {part.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

vi.mock("./CompoundPicker", () => ({
  CompoundPicker: ({
    compounds,
    favourites,
    onFavourite,
  }: {
    compounds: LegoProject[];
    favourites: ReadonlySet<string>;
    onFavourite: (module: LegoProject) => void;
  }) => (
    <ul aria-label="module grid">
      {compounds.map((module) => (
        <li key={module.id}>
          {module.name}
          <button type="button" onClick={() => onFavourite(module)}>
            {favourites.has(module.id) ? "unstar" : "star"} {module.name}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

import { type InventoryRef, useInventoryView } from "../../inventory";
import { InventoryFilters, InventoryGrids } from "./Inventory";

const part = (id: string): LegoPartInfo =>
  ({
    id,
    name: id,
    shape: id,
    category: "grey",
    material: "",
    tags: [],
    sourceNames: [],
    packId: "lego",
  }) as unknown as LegoPartInfo;

function module(name: string): LegoProject {
  return newProject({
    id: name,
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
}

const pack = {
  manifest: { categories: [] },
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts: [part("beam"), part("block"), part("wedge")],
} as unknown as LoadedPack;

const modules = [module("leg"), module("turret")];

function Harness({
  known = modules,
  showGameUnits = false,
}: {
  known?: LegoProject[];
  showGameUnits?: boolean;
}) {
  const view = useInventoryView(pack, known);
  return (
    <>
      <InventoryFilters
        view={view}
        pack={pack}
        compounds={known}
        showGameUnits={showGameUnits}
      />
      <InventoryGrids
        view={view}
        pack={pack}
        compounds={known}
        gameUnits={<p>units for "{view.query}"</p>}
        onDeleteModule={vi.fn()}
        onRenameModule={vi.fn()}
        onCopyModule={vi.fn()}
      />
      <button
        type="button"
        onClick={() => view.inventory.record({ kind: "part", id: "wedge" })}
      >
        use wedge
      </button>
      <button
        type="button"
        onClick={() => view.inventory.record({ kind: "module", id: "leg" })}
      >
        use leg
      </button>
    </>
  );
}

const names = (grid: string) =>
  [...screen.getByLabelText(grid).querySelectorAll("li")].map((li) =>
    li.firstChild?.textContent?.trim(),
  );

beforeEach(() => store.values.clear());
afterEach(cleanup);

describe("the kind filter", () => {
  it("lists parts and modules together by default", () => {
    render(<Harness />);
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
    expect(names("module grid")).toEqual(["leg", "turret"]);
  });

  it("shows only parts, then only modules", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Parts" }));
    expect(screen.queryByLabelText("module grid")).toBeNull();
    expect(screen.getByLabelText("part grid")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    expect(screen.queryByLabelText("part grid")).toBeNull();
    expect(names("module grid")).toEqual(["leg", "turret"]);
  });

  it("searches both kinds with one box", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "e" },
    });
    expect(names("part grid")).toEqual(["beam", "wedge"]);
    expect(names("module grid")).toEqual(["leg", "turret"]);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "tur" },
    });
    expect(screen.queryByLabelText("part grid")).toBeNull();
    expect(names("module grid")).toEqual(["turret"]);
  });
});

describe("game units", () => {
  it("are not offered where there is no unit to take from", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Game units" })).toBeNull();
  });

  it("replace the parts and modules, and share the search box", () => {
    render(<Harness showGameUnits />);
    fireEvent.click(screen.getByRole("button", { name: "Game units" }));
    expect(screen.queryByLabelText("part grid")).toBeNull();
    expect(screen.queryByLabelText("module grid")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search the game's units"), {
      target: { value: "com" },
    });
    expect(screen.getByText('units for "com"')).toBeTruthy();
  });

  it("are left out of All", () => {
    render(<Harness showGameUnits />);
    expect(screen.queryByText(/units for/)).toBeNull();
  });
});

describe("recent items", () => {
  it("say nothing has been used before anything is", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(screen.getByText("Nothing used yet.")).toBeTruthy();
  });

  it("list what was added, newest first, across both kinds", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "use wedge" }));
    fireEvent.click(screen.getByRole("button", { name: "use leg" }));
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(names("part grid")).toEqual(["wedge"]);
    expect(names("module grid")).toEqual(["leg"]);
  });

  it("drop a module that has since been deleted, without an error", () => {
    store.values.set("lego.inventory.recent", [
      { kind: "module", id: "gone" },
      { kind: "module", id: "turret" },
      { kind: "part", id: "no-such-part" },
    ] satisfies InventoryRef[]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(names("module grid")).toEqual(["turret"]);
    expect(screen.queryByLabelText("part grid")).toBeNull();
  });

  it("leave the list when Recent is clicked again", () => {
    render(<Harness />);
    const recent = screen.getByRole("button", { name: "Recent" });
    fireEvent.click(recent);
    fireEvent.click(recent);
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
  });
});

describe("favourites", () => {
  it("are marked from either grid and survive in the stored setting", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "star block" }));
    fireEvent.click(screen.getByRole("button", { name: "star turret" }));
    expect(store.values.get("lego.inventory.favourites")).toEqual([
      { kind: "part", id: "block" },
      { kind: "module", id: "turret" },
    ]);
  });

  it("filter both grids to the starred items", () => {
    store.values.set("lego.inventory.favourites", [
      { kind: "part", id: "block" },
      { kind: "module", id: "turret" },
    ]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Favourites" }));
    expect(names("part grid")).toEqual(["block"]);
    expect(names("module grid")).toEqual(["turret"]);
  });

  it("unstar on a second click", () => {
    store.values.set("lego.inventory.favourites", [
      { kind: "part", id: "block" },
    ]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "unstar block" }));
    expect(store.values.get("lego.inventory.favourites")).toEqual([]);
  });

  it("ignore a stored value that is not a list", () => {
    store.values.set("lego.inventory.favourites", "broken");
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Favourites" }));
    expect(screen.getByText("No favourites yet. Click a star.")).toBeTruthy();
  });
});
