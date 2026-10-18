// @vitest-environment happy-dom

/**
 * The one inventory (issue #3306): the kind filter, the recent and favourites
 * lists, and what is drawn for each, and which tile the detail panel shows
 * (#4537). The grid is replaced with lists of names and the panel with what it
 * was asked to show, because what is under test is which items reach them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { SHAPE_KINDS, type ShapeKind } from "../../shapes";

const ALL_SHAPES = SHAPE_KINDS.map((shape) => shape.label);

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

/**
 * The grid, as one list per kind of tile and the headings with their counts.
 * A list with nothing in it is left out, as the grid leaves out an empty
 * section.
 */
vi.mock("./TileGrid", async () => {
  const { sectionCount } = await import("./sectionGrid");
  type Item =
    | { kind: "shape"; shape: ShapeKind }
    | { kind: "part"; part: LegoPartInfo }
    | { kind: "module"; module: LegoProject };
  const keyOf = (item: Item) =>
    item.kind === "shape"
      ? `shape:${item.shape.id}`
      : item.kind === "part"
        ? `part:${item.part.id}`
        : `module:${item.module.id}`;
  const nameOf = (item: Item) =>
    item.kind === "shape"
      ? item.shape.label
      : item.kind === "part"
        ? item.part.name
        : item.module.name;
  const GRIDS = [
    { kind: "shape", label: "shape grid" },
    { kind: "part", label: "part grid" },
    { kind: "module", label: "module grid" },
  ] as const;
  return {
    TileGrid: ({
      sections,
      selectedKey,
      onPick,
      favourites,
      onFavourite,
      scrollRoot,
    }: {
      sections: {
        id: string;
        label: string;
        total: number;
        items: Item[];
      }[];
      selectedKey?: string;
      onPick: (item: Item, alt: boolean) => void;
      favourites: ReadonlySet<string>;
      onFavourite: (item: Item) => void;
      scrollRoot?: unknown;
    }) => {
      const items = sections.flatMap((section) => section.items);
      return (
        <section
          aria-label="grid"
          data-scroll={scrollRoot ? "page" : "own"}
          data-selected={selectedKey ?? ""}
        >
          {sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <h3 key={section.id}>
                {`${section.label} ${sectionCount(section.items.length, section.total)}`}
              </h3>
            ))}
          {GRIDS.map(({ kind, label }) => {
            const these = items.filter((item) => item.kind === kind);
            return these.length === 0 ? null : (
              <ul key={kind} aria-label={label}>
                {these.map((item) => (
                  <li key={keyOf(item)}>
                    {nameOf(item)}
                    <button type="button" onClick={() => onPick(item, false)}>
                      pick {nameOf(item)}
                    </button>
                    <button type="button" onClick={() => onFavourite(item)}>
                      {favourites.has(keyOf(item)) ? "unstar" : "star"}{" "}
                      {nameOf(item)}
                    </button>
                  </li>
                ))}
              </ul>
            );
          })}
        </section>
      );
    },
  };
});

/**
 * What the panel was asked to show, a field that uses Escape, its X, and a
 * Colourway control that picks the tan part of a shape named "<shape>-<colour>".
 */
vi.mock("./DetailPanel", () => ({
  DetailPanel: ({
    selected,
    onSelect,
    onClose,
  }: {
    selected: { kind: string; id: string };
    onSelect: (ref: { kind: string; id: string }) => void;
    onClose: () => void;
  }) => (
    <aside aria-label="detail">
      {`${selected.kind}:${selected.id}`}
      <button
        type="button"
        onClick={() =>
          onSelect({
            kind: "part",
            id: selected.id.replace(/-[a-z]+$/, "-tan"),
          })
        }
      >
        Tan
      </button>
      <input
        aria-label="panel field"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}
      />
      <button type="button" onClick={onClose}>
        close
      </button>
    </aside>
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
  manifest: {
    categories: [{ id: "grey", label: "Grey" }],
    swatches: [{ id: "grey" }],
  },
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts: [part("beam"), part("block"), part("wedge")],
} as unknown as LoadedPack;

const modules = [module("leg"), module("turret")];

function Harness({
  known = modules,
  showGameUnits = false,
  escapeAnywhere = false,
}: {
  known?: LegoProject[];
  showGameUnits?: boolean;
  escapeAnywhere?: boolean;
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
        escapeAnywhere={escapeAnywhere}
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
      <button
        type="button"
        onClick={() => view.inventory.record({ kind: "shape", id: "cylinder" })}
      >
        use cylinder
      </button>
      <button type="button" onClick={() => view.partFilter.setPackId("other")}>
        pick another pack
      </button>
    </>
  );
}

const names = (grid: string) =>
  [...screen.getByLabelText(grid).querySelectorAll("li")].map((li) =>
    li.firstChild?.textContent?.trim(),
  );

/** Radix moves a tab on mouse down, not on click. */
function pickTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

/** What the category menu lists, headings too, read by opening it. */
function menuEntries() {
  fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
  return [
    ...document.querySelectorAll("[data-slot=select-label], [role=option]"),
  ].map((node) => node.textContent);
}

/** Opens the category menu and picks the named entry. */
function pickCategory(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

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
    pickTab("Parts");
    expect(screen.queryByLabelText("module grid")).toBeNull();
    expect(screen.getByLabelText("part grid")).toBeTruthy();

    pickTab("Modules");
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

/** The counts are on the section headings, so the row has none (#4538). */
describe("the count", () => {
  it("is not in the filter row", () => {
    const { container } = render(<Harness />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.textContent).not.toMatch(/\d+ (parts?|modules?)/);
  });
});

describe("the section headings", () => {
  const headings = () =>
    screen.getAllByRole("heading").map((heading) => heading.textContent);

  it("count each section, with built in modules apart from saved ones", () => {
    const starter = { ...module("Wheel"), id: "builtin.wheel" };
    render(<Harness known={[starter, ...modules]} />);
    expect(headings()).toEqual([
      `Shapes ${SHAPE_KINDS.length}`,
      "Parts 3",
      "Built in modules 1",
      "Saved modules 2",
    ]);
  });

  it("say how many of the whole section a search leaves", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "e" },
    });
    expect(headings()).toContain("Parts 2 of 3");
    expect(headings()).toContain("Saved modules 2");
  });

  it("leave out a section a filter empties", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "tur" },
    });
    expect(headings()).toEqual(["Saved modules 1 of 2"]);
  });

  it("count a list as a narrowing too", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "use wedge" }));
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(headings()).toEqual(["Parts 1 of 3"]);
  });
});

describe("shapes", () => {
  it("are listed beside the parts by default", () => {
    render(<Harness />);
    expect(names("shape grid")).toEqual(ALL_SHAPES);
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
  });

  it("are found by kind and by tag, and hidden by a search they do not match", () => {
    render(<Harness />);
    const search = screen.getByLabelText("Search the inventory");
    fireEvent.change(search, { target: { value: "round" } });
    expect(names("shape grid")).toEqual(
      SHAPE_KINDS.filter((s) => s.tags.includes("round")).map((s) => s.label),
    );
    fireEvent.change(search, { target: { value: "slope" } });
    expect(names("shape grid")).toEqual(["Wedge"]);
    fireEvent.change(search, { target: { value: "round" } });
    expect(screen.queryByLabelText("grid")).toBeTruthy();
    fireEvent.change(search, { target: { value: "beam" } });
    expect(screen.queryByLabelText("shape grid")).toBeNull();
  });

  it("are the only cells under the Shapes category", () => {
    render(<Harness />);
    pickTab("Parts");
    pickCategory("Shapes");
    expect(names("shape grid")).toEqual(ALL_SHAPES);
    expect(screen.queryByLabelText("part grid")).toBeNull();
  });

  it("are hidden by a colour", () => {
    render(<Harness />);
    pickTab("Parts");
    pickCategory("Grey");
    expect(screen.queryByLabelText("shape grid")).toBeNull();
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
  });

  it("stay when a pack is picked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "pick another pack" }));
    expect(screen.queryByLabelText("part grid")).toBeNull();
    expect(names("shape grid")).toEqual(ALL_SHAPES);
  });

  it("are not offered by a pack that lists no swatches", () => {
    const bare = {
      ...pack,
      manifest: { ...pack.manifest, swatches: [] },
    } as unknown as LoadedPack;
    function Bare() {
      const view = useInventoryView(bare, modules);
      return <InventoryFilters view={view} pack={bare} compounds={modules} />;
    }
    render(<Bare />);
    pickTab("Parts");
    expect(menuEntries()).not.toContain("Shapes");
  });

  it("are left out of the modules kind", () => {
    render(<Harness />);
    pickTab("Modules");
    expect(screen.queryByLabelText("shape grid")).toBeNull();
  });

  it("join the recent list and the favourites", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(screen.getByText("Nothing used yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    fireEvent.click(screen.getByRole("button", { name: "use cylinder" }));
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(names("shape grid")).toEqual(["Cylinder"]);
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    fireEvent.click(screen.getByRole("button", { name: "star Cylinder" }));
    expect(store.values.get("lego.inventory.favourites")).toEqual([
      { kind: "shape", id: "cylinder" },
    ]);
  });
});

describe("game units", () => {
  it("are not offered where there is no unit to take from", () => {
    render(<Harness />);
    expect(screen.queryByRole("tab", { name: "Game units" })).toBeNull();
  });

  it("replace the parts and modules, and share the search box", () => {
    render(<Harness showGameUnits />);
    pickTab("Game units");
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
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(screen.getByText("Nothing used yet.")).toBeTruthy();
  });

  it("list what was added, newest first, across both kinds", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "use wedge" }));
    fireEvent.click(screen.getByRole("button", { name: "use leg" }));
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
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
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(names("module grid")).toEqual(["turret"]);
    expect(screen.queryByLabelText("part grid")).toBeNull();
  });

  it("leave the list when Recent is clicked again", () => {
    render(<Harness />);
    const recent = screen.getByRole("radio", { name: "Recent" });
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
    fireEvent.click(screen.getByRole("radio", { name: "Favourites" }));
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

  it("say so in one line when a search matches nothing", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "nothing is called this" },
    });
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
  });

  it("ignore a stored value that is not a list", () => {
    store.values.set("lego.inventory.favourites", "broken");
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Favourites" }));
    expect(screen.getByText("No favourites yet.")).toBeTruthy();
  });
});

/**
 * One row that keeps its shape on every tab (#4538): the same controls in the
 * same order, with what a tab has no use for switched off. happy-dom lays
 * nothing out, so this checks which controls are there and in what order.
 */
describe("the filter row", () => {
  function Filters({ showGameUnits = false }: { showGameUnits?: boolean }) {
    const view = useInventoryView(pack, known);
    return (
      <InventoryFilters
        view={view}
        pack={pack}
        compounds={known}
        onLoadModuleFile={() => {}}
        showGameUnits={showGameUnits}
      />
    );
  }
  const known = [
    { ...module("leg"), category: "Leg" },
    { ...module("turret"), category: "Turret" },
    module("plain"),
  ];

  /** Each control's name, in the order the row has them. */
  function controls(container: HTMLElement) {
    const row = container.firstElementChild as HTMLElement;
    return [...row.children].map(
      (child) =>
        child.getAttribute("aria-label") ??
        child.querySelector("[aria-label]")?.getAttribute("aria-label"),
    );
  }

  it("has the same controls in the same places on every tab", () => {
    const { container } = render(<Filters showGameUnits />);
    const expected = [
      "Kind",
      "Search the inventory",
      "Category",
      "List",
      "Load from file",
    ];
    expect(controls(container)).toEqual(expected);
    for (const tab of ["Parts", "Modules"]) {
      pickTab(tab);
      expect(controls(container)).toEqual(expected);
    }
    pickTab("Game units");
    expect(controls(container)).toEqual(
      expected.map((name) =>
        name === "Search the inventory" ? "Search the game's units" : name,
      ),
    );
  });

  it("switches off the menu and the lists for game units, and back on", () => {
    render(<Filters showGameUnits />);
    pickTab("Game units");
    const menu = screen.getByRole("combobox", { name: "Category" });
    expect(menu.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("radio", { name: "Recent" }).hasAttribute("disabled"),
    ).toBe(true);
    pickTab("Parts");
    expect(menu.hasAttribute("disabled")).toBe(false);
  });

  it("marks the tab in force", () => {
    render(<Filters />);
    pickTab("Modules");
    expect(
      screen
        .getByRole("tab", { name: "Modules" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  /** The container queries swapped controls in the frame they measured them,
   *  which flooded the console with ResizeObserver errors. */
  it("has no container query on any tab", () => {
    const { container } = render(<Filters />);
    for (const tab of ["All", "Parts", "Modules"]) {
      pickTab(tab);
      expect(container.innerHTML).not.toContain("@container");
    }
  });
});

describe("the category menu", () => {
  const known = [
    { ...module("leg"), category: "Leg" },
    { ...module("turret"), category: "Turret" },
    module("plain"),
  ];

  it("lists the colourways, then the module categories, under headings on All", () => {
    render(<Harness known={known} />);
    expect(menuEntries()).toEqual([
      "All categories",
      "Colourways",
      "Grey",
      "Module categories",
      "Leg",
      "Turret",
    ]);
  });

  it("lists the colourways and Shapes on Parts", () => {
    render(<Harness known={known} />);
    pickTab("Parts");
    expect(menuEntries()).toEqual(["All categories", "Grey", "Shapes"]);
  });

  it("lists the module categories and Uncategorised on Modules", () => {
    render(<Harness known={known} />);
    pickTab("Modules");
    expect(menuEntries()).toEqual([
      "All categories",
      "Leg",
      "Turret",
      "Uncategorised",
    ]);
  });

  it("leaves Uncategorised out while every module has a category", () => {
    render(<Harness known={known.slice(0, 2)} />);
    pickTab("Modules");
    expect(menuEntries()).not.toContain("Uncategorised");
  });

  it("gives each colourway a chip", () => {
    render(<Harness known={known} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    const grey = screen.getByRole("option", { name: "Grey" });
    expect(grey.querySelector("[data-colourway=grey]")).toBeTruthy();
    const leg = screen.getByRole("option", { name: "Leg" });
    expect(leg.querySelector("[data-colourway]")).toBeNull();
  });

  it("hides the modules on All when a colourway is chosen", () => {
    render(<Harness known={known} />);
    pickCategory("Grey");
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
    expect(screen.queryByLabelText("module grid")).toBeNull();
    expect(screen.queryByLabelText("shape grid")).toBeNull();
  });

  it("hides the parts and shapes on All when a module category is chosen", () => {
    render(<Harness known={known} />);
    pickCategory("Turret");
    expect(names("module grid")).toEqual(["turret"]);
    expect(screen.queryByLabelText("part grid")).toBeNull();
    expect(screen.queryByLabelText("shape grid")).toBeNull();
  });

  it("lists only the uncategorised modules under Uncategorised", () => {
    render(<Harness known={known} />);
    pickTab("Modules");
    pickCategory("Uncategorised");
    expect(names("module grid")).toEqual(["plain"]);
  });

  it("keeps a colourway across All and Parts", () => {
    render(<Harness known={known} />);
    pickCategory("Grey");
    pickTab("Parts");
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe(
      "Grey",
    );
    pickTab("All");
    expect(screen.queryByLabelText("module grid")).toBeNull();
  });

  it("drops a choice the new tab does not offer", () => {
    render(<Harness known={known} />);
    pickTab("Parts");
    pickCategory("Shapes");
    pickTab("All");
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe(
      "All categories",
    );
    expect(screen.getByLabelText("part grid")).toBeTruthy();
    expect(screen.getByLabelText("module grid")).toBeTruthy();
    pickCategory("Leg");
    pickTab("Parts");
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
  });

  it("clears the choice with All categories", () => {
    render(<Harness known={known} />);
    pickCategory("Grey");
    pickCategory("All categories");
    expect(names("module grid")).toEqual(["leg", "turret", "plain"]);
  });
});

/** Neither or either of Recent and Favourites can be on (#4538). */
describe("the Recent and Favourites toggle", () => {
  const pressed = (name: string) =>
    screen.getByRole("radio", { name }).getAttribute("aria-checked");

  it("starts with neither on", () => {
    render(<Harness />);
    expect(pressed("Recent")).toBe("false");
    expect(pressed("Favourites")).toBe("false");
  });

  it("turns one on, then moves to the other", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Recent" }));
    expect(pressed("Recent")).toBe("true");
    expect(screen.getByText("Nothing used yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Favourites" }));
    expect(pressed("Recent")).toBe("false");
    expect(pressed("Favourites")).toBe("true");
    expect(screen.getByText("No favourites yet.")).toBeTruthy();
  });

  it("turns off again, back to everything", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Favourites" }));
    fireEvent.click(screen.getByRole("radio", { name: "Favourites" }));
    expect(pressed("Favourites")).toBe("false");
    expect(names("part grid")).toEqual(["beam", "block", "wedge"]);
  });
});

/**
 * The Lego Parts page scrolls as one (#4468). The builder's drawer keeps a
 * scroller in the grid.
 */
describe("one scroll for the page", () => {
  function Grids({ page }: { page: boolean }) {
    const view = useInventoryView(pack, modules);
    return (
      <InventoryGrids
        view={view}
        pack={pack}
        compounds={modules}
        scrollRoot={page ? createRef<HTMLElement>() : undefined}
        onDeleteModule={vi.fn()}
        onRenameModule={vi.fn()}
        onCopyModule={vi.fn()}
      />
    );
  }

  function openDetail() {
    fireEvent.click(screen.getByRole("button", { name: "pick beam" }));
  }

  it("hands the page's scroller to the grid", () => {
    render(<Grids page />);
    expect(screen.getByLabelText("grid").getAttribute("data-scroll")).toBe(
      "page",
    );
  });

  it("keeps the detail beside the grids in view as the page scrolls", () => {
    render(<Grids page />);
    openDetail();
    const holder = screen.getByLabelText("detail").parentElement as HTMLElement;
    expect(holder.className).toContain("sticky");
    expect(holder.className).toContain("top-0");
  });

  it("leaves the grid its own scroller where no page scroller is given", () => {
    render(<Grids page={false} />);
    expect(screen.getByLabelText("grid").getAttribute("data-scroll")).toBe(
      "own",
    );
    openDetail();
    const holder = screen.getByLabelText("detail").parentElement as HTMLElement;
    expect(holder.className).not.toContain("sticky");
  });
});

/** One panel for every kind of tile (#4537). */
describe("the detail panel", () => {
  const detail = () =>
    screen.queryByLabelText("detail")?.firstChild?.textContent;
  const selectedKey = () =>
    screen.getByLabelText("grid").getAttribute("data-selected");

  it("is closed until a tile is picked", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("detail")).toBeNull();
  });

  it("opens a shape, a part and a module, each replacing the last", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "pick Cylinder" }));
    expect(detail()).toBe("shape:cylinder");
    expect(selectedKey()).toBe("shape:cylinder");

    fireEvent.click(screen.getByRole("button", { name: "pick beam" }));
    expect(detail()).toBe("part:beam");
    expect(selectedKey()).toBe("part:beam");

    fireEvent.click(screen.getByRole("button", { name: "pick turret" }));
    expect(detail()).toBe("module:turret");
    expect(selectedKey()).toBe("module:turret");
    expect(screen.getAllByLabelText("detail")).toHaveLength(1);
  });

  it("closes with its X", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "pick leg" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByLabelText("detail")).toBeNull();
    expect(selectedKey()).toBe("");
  });

  it("closes with Escape from anywhere on the Lego Parts page", () => {
    render(<Harness escapeAnywhere />);
    fireEvent.click(screen.getByRole("button", { name: "pick leg" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByLabelText("detail")).toBeNull();
  });

  it("stays open when a field in it used the Escape", () => {
    render(<Harness escapeAnywhere />);
    fireEvent.click(screen.getByRole("button", { name: "pick leg" }));
    fireEvent.keyDown(screen.getByLabelText("panel field"), { key: "Escape" });
    expect(detail()).toBe("module:leg");
  });

  it("in the builder, closes with Escape only from the grid or the panel", () => {
    render(<Harness />);
    const pick = screen.getByRole("button", { name: "pick leg" });
    fireEvent.click(pick);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(detail()).toBe("module:leg");
    fireEvent.keyDown(pick, { key: "Escape" });
    expect(screen.queryByLabelText("detail")).toBeNull();
  });
});

/** One tile per shape in the chosen colourway (#4540). */
describe("a colourway", () => {
  const tinted = (id: string, shapeId: string, colourway: string) =>
    ({
      ...part(id),
      shapeId,
      category: colourway,
      colourway,
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    }) as unknown as LegoPartInfo;
  const parts = [
    tinted("beam-grey", "beam", "grey"),
    tinted("beam-tan", "beam", "tan"),
    tinted("block-grey", "block", "grey"),
    tinted("panel-mixed", "panel", "mixed"),
  ];
  const tans = {
    manifest: {
      categories: [
        { id: "tan", label: "Tan" },
        { id: "grey", label: "Grey" },
        { id: "mixed", label: "Mixed" },
      ],
      swatches: [{ id: "grey" }, { id: "tan" }],
    },
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
  } as unknown as LoadedPack;

  const headings = () =>
    screen.getAllByRole("heading").map((heading) => heading.textContent);

  function Drawer({
    onSelectPart,
    onSwitchPlacingPart,
    placing,
  }: {
    onSelectPart: (part: LegoPartInfo, alt: boolean) => void;
    onSwitchPlacingPart?: (part: LegoPartInfo) => void;
    /** The part the builder is placing. */
    placing?: string;
  }) {
    const view = useInventoryView(tans, modules);
    return (
      <>
        <InventoryFilters view={view} pack={tans} compounds={modules} />
        <InventoryGrids
          view={view}
          pack={tans}
          compounds={modules}
          onSelectPart={onSelectPart}
          onSwitchPlacingPart={onSwitchPlacingPart}
          selectedPartId={placing}
          onDeleteModule={vi.fn()}
          onRenameModule={vi.fn()}
          onCopyModule={vi.fn()}
        />
      </>
    );
  }

  it("lists every part, a shape's colourways together, under All categories", () => {
    render(<Drawer onSelectPart={vi.fn()} />);
    expect(names("part grid")).toEqual([
      "beam-tan",
      "beam-grey",
      "block-grey",
      "panel-mixed",
    ]);
    expect(headings()).toContain("Parts 4");
  });

  it("lists each shape once in the colourway, and the mixed part", () => {
    render(<Drawer onSelectPart={vi.fn()} />);
    pickCategory("Grey");
    expect(names("part grid")).toEqual([
      "beam-grey",
      "block-grey",
      "panel-mixed",
    ]);
    pickCategory("Tan");
    expect(names("part grid")).toEqual(["beam-tan", "panel-mixed"]);
  });

  it("counts what the colourway shows", () => {
    render(<Drawer onSelectPart={vi.fn()} />);
    pickCategory("Grey");
    expect(headings()).toEqual(["Parts 3"]);
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "block" },
    });
    expect(headings()).toEqual(["Parts 1 of 3"]);
    pickCategory("Tan");
    fireEvent.change(screen.getByLabelText("Search the inventory"), {
      target: { value: "" },
    });
    expect(headings()).toEqual(["Parts 2"]);
  });

  it("places the shape in the chosen colourway", () => {
    const onSelectPart = vi.fn();
    render(<Drawer onSelectPart={onSelectPart} />);
    pickCategory("Tan");
    fireEvent.click(screen.getByRole("button", { name: "pick beam-tan" }));
    expect(onSelectPart).toHaveBeenLastCalledWith(parts[1], false);
    fireEvent.click(screen.getByRole("button", { name: "pick panel-mixed" }));
    expect(onSelectPart).toHaveBeenLastCalledWith(parts[3], false);
  });

  it("places the part clicked under All categories", () => {
    const onSelectPart = vi.fn();
    render(<Drawer onSelectPart={onSelectPart} />);
    fireEvent.click(screen.getByRole("button", { name: "pick beam-grey" }));
    expect(onSelectPart).toHaveBeenLastCalledWith(parts[0], false);
    fireEvent.click(screen.getByRole("button", { name: "pick beam-tan" }));
    expect(onSelectPart).toHaveBeenLastCalledWith(parts[1], false);
  });

  it("switches the part in the panel with its Colourway control", () => {
    render(<Drawer onSelectPart={vi.fn()} />);
    pickCategory("Grey");
    fireEvent.click(screen.getByRole("button", { name: "pick beam-grey" }));
    fireEvent.click(screen.getByRole("button", { name: "Tan" }));
    expect(screen.getByLabelText("detail").firstChild?.textContent).toBe(
      "part:beam-tan",
    );
  });

  it("places the other colourway when the panel switches the part being placed", () => {
    const onSwitchPlacingPart = vi.fn();
    render(
      <Drawer
        onSelectPart={vi.fn()}
        onSwitchPlacingPart={onSwitchPlacingPart}
        placing="beam-grey"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pick beam-grey" }));
    fireEvent.click(screen.getByRole("button", { name: "Tan" }));
    expect(onSwitchPlacingPart).toHaveBeenCalledWith(parts[1]);
  });

  it("leaves what is placed alone when the panel shows another part", () => {
    const onSwitchPlacingPart = vi.fn();
    render(
      <Drawer
        onSelectPart={vi.fn()}
        onSwitchPlacingPart={onSwitchPlacingPart}
        placing="block-grey"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pick beam-grey" }));
    fireEvent.click(screen.getByRole("button", { name: "Tan" }));
    expect(onSwitchPlacingPart).not.toHaveBeenCalled();
  });
});
