// @vitest-environment happy-dom

/**
 * The controls above a parts grid, and what they are told about the library
 * (issue #586).
 *
 * `../../filter.test.ts` covers what a query and a category actually keep. This
 * is the row of controls that drives it, plus the three things it says about a
 * library rather than about a part: the pack picker only appears once there is
 * more than one pack to choose between, a pack that would not load is shown
 * rather than logged, and the atlas list only appears once a unit has a choice.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHAPES_CATEGORY } from "../../filter";
import type { LegoPackManifest, LoadedPack } from "../../pack";
import {
  NoMatches,
  PackAtlases,
  PackProblems,
  PartFilters,
} from "./PartFilters";

function manifest(id: string): LegoPackManifest {
  return {
    schemaVersion: 1,
    id,
    version: "1",
    licence: "CC0",
    atlas: { width: 1024, height: 1024 },
    textures: { tex1: `${id}.png` },
    geometry: { file: "", encoding: "", bytes: 0, vertexStride: 8 },
    categories: [
      { id: "grey", label: "Grey" },
      { id: "tan", label: "Tan" },
    ],
    parts: [],
  };
}

function pack(over: Partial<LoadedPack["library"]> = {}): LoadedPack {
  return {
    manifest: manifest("lego"),
    library: {
      packs: [manifest("lego")],
      atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
      dir: "/packs",
      problems: [],
      ...over,
    },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

const onQuery = vi.fn();
const onCategory = vi.fn();
const onPackId = vi.fn();

function show(
  loaded: LoadedPack,
  over: {
    category?: string | null;
    shown?: number;
    showShapes?: boolean;
    showPacks?: boolean;
  } = {},
) {
  return render(
    <PartFilters
      pack={loaded}
      query=""
      onQuery={onQuery}
      category={over.category ?? null}
      onCategory={onCategory}
      packId={null}
      onPackId={onPackId}
      shown={over.shown ?? 7}
      showShapes={over.showShapes}
      showPacks={over.showPacks}
    />,
  );
}

beforeEach(() => {
  onQuery.mockClear();
  onCategory.mockClear();
  onPackId.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the filter row", () => {
  it("reports what is typed into the search box", () => {
    show(pack());
    fireEvent.change(screen.getByLabelText("Search parts"), {
      target: { value: "beam" },
    });
    expect(onQuery).toHaveBeenCalledWith("beam");
  });

  it("offers every category the pack declares, and a genuine all", () => {
    show(pack());
    for (const name of ["All", "Grey", "Tan"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("marks the category in force and no other", () => {
    show(pack(), { category: "tan" });
    expect(
      screen.getByRole("button", { name: "Tan" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  /** Clearing the category is null, not the string "all": every part matches,
   *  including one in no category at all. */
  it("clears the category rather than filtering by a category called all", () => {
    show(pack(), { category: "tan" });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onCategory).toHaveBeenCalledWith(null);
  });

  it("says how many parts the grid is showing", () => {
    show(pack());
    expect(screen.getByText("7 parts")).toBeTruthy();
  });

  it("says 1 part, not 1 parts", () => {
    show(pack(), { shown: 1 });
    expect(screen.getByText("1 part")).toBeTruthy();
  });
});

describe("the Shapes category", () => {
  it("sits beside the colours when the grid lists shapes", () => {
    show(pack(), { showShapes: true });
    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["All", "Grey", "Tan", "Shapes"]);
  });

  it("is left out of a grid that has no shapes", () => {
    show(pack());
    expect(screen.queryByRole("button", { name: "Shapes" })).toBeNull();
  });

  it("chooses the shapes category, and marks it when in force", () => {
    show(pack(), { showShapes: true });
    fireEvent.click(screen.getByRole("button", { name: "Shapes" }));
    expect(onCategory).toHaveBeenCalledWith(SHAPES_CATEGORY);
    cleanup();
    show(pack(), { showShapes: true, category: SHAPES_CATEGORY });
    expect(
      screen
        .getByRole("button", { name: "Shapes" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

/**
 * The row has to stay one line in the builder's drawer, which shares its width
 * with the kind and list buttons (#4464). happy-dom lays nothing out, so these
 * check the classes the layout rests on, not the layout itself.
 */
describe("the row in a narrow space", () => {
  function row(container: HTMLElement) {
    return container.firstElementChild as HTMLElement;
  }

  /** Opens the category menu and picks the named option. */
  function pickCategory(option: string) {
    fireEvent.click(screen.getByRole("combobox", { name: "Part category" }));
    fireEvent.click(screen.getByRole("option", { name: option }));
  }

  it("is a container that never wraps, with a search box that can shrink", () => {
    const { container } = show(pack());
    expect(row(container).className).toContain("@container");
    expect(row(container).className).toContain("flex-nowrap");
    expect(row(container).className).not.toContain("flex-wrap");
    expect(screen.getByLabelText("Search parts").className).toContain(
      "min-w-32",
    );
  });

  it("swaps the category buttons for a menu below a container width", () => {
    const { container } = show(pack(), { showShapes: true });
    const buttons = screen.getByRole("group", { name: "Part category" });
    expect(buttons.className).toContain("hidden");
    expect(buttons.className).toContain("@2xl:flex");
    const menu = screen.getByRole("combobox", { name: "Part category" });
    expect(menu.className).toContain("@2xl:hidden");
    expect(row(container).textContent).toContain("7 parts");
  });

  it("waits for more room before the buttons when the pack menu is there too", () => {
    show(pack({ packs: [manifest("lego"), manifest("extras")] }));
    expect(
      screen.getByRole("group", { name: "Part category" }).className,
    ).toContain("@4xl:flex");
    expect(
      screen.getByRole("combobox", { name: "Part category" }).className,
    ).toContain("@4xl:hidden");
  });

  it("shows the category in force in the menu", () => {
    show(pack(), { category: "tan" });
    expect(
      screen.getByRole("combobox", { name: "Part category" }).textContent,
    ).toBe("Tan");
  });

  it("offers the same choices in the menu as the buttons", () => {
    show(pack(), { category: "tan", showShapes: true });
    pickCategory("Shapes");
    expect(onCategory).toHaveBeenCalledWith(SHAPES_CATEGORY);
    cleanup();
    show(pack(), { category: "tan" });
    pickCategory("All");
    expect(onCategory).toHaveBeenLastCalledWith(null);
    cleanup();
    show(pack());
    pickCategory("Grey");
    expect(onCategory).toHaveBeenLastCalledWith("grey");
  });
});

describe("the pack picker", () => {
  /** One pack means nothing to choose between, and a control with one option
   *  is noise. */
  it("stays away while only one pack is installed", () => {
    show(pack());
    expect(screen.queryByLabelText("Parts pack")).toBeNull();
  });

  it("appears once a second pack is installed", () => {
    show(pack({ packs: [manifest("lego"), manifest("extras")] }));
    expect(screen.getByLabelText("Parts pack")).toBeTruthy();
  });

  /** The Lego Parts page puts it in its header instead (#4535). */
  it("stays out of the row for a page that shows it elsewhere", () => {
    show(pack({ packs: [manifest("lego"), manifest("extras")] }), {
      showPacks: false,
    });
    expect(screen.queryByLabelText("Parts pack")).toBeNull();
  });
});

describe("what the library itself has to say", () => {
  /** The only person who can fix a pack that will not load is whoever
   *  installed it, and they are looking at this screen. */
  it("shows a pack that would not load, and where packs go", () => {
    show(pack());
    const { container } = render(
      <PackProblems pack={pack({ problems: ["extras: no pack.json"] })} />,
    );
    expect(screen.getByText("extras: no pack.json")).toBeTruthy();
    expect(container.textContent).toContain("/packs");
  });

  it("gives each problem a line of its own in one alert", () => {
    render(
      <PackProblems
        pack={pack({ problems: ["extras: no pack.json", "rust: bad atlas"] })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(
      [...alert.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual([
      "extras: no pack.json",
      "rust: bad atlas",
      "Extension packs live in /packs, one folder each.",
    ]);
  });

  it("says nothing when every pack loaded", () => {
    const { container } = render(<PackProblems pack={pack()} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the atlases only once a unit has a choice between them", () => {
    const one = render(<PackAtlases pack={pack()} />);
    expect(one.container.innerHTML).toBe("");
    one.unmount();

    render(
      <PackAtlases
        pack={pack({
          atlases: [
            { tex1: "atlas.png", packId: "lego", folder: null },
            { tex1: "rust.png", packId: "rust", folder: "rust" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/2 atlases installed/)).toBeTruthy();
    expect(screen.getByText("rust.png")).toBeTruthy();
  });

  /** An empty grid says what to try next rather than nothing at all. */
  it("suggests a way out when nothing matches", () => {
    render(<NoMatches />);
    expect(screen.getByText(/Try a shape like "beam"/)).toBeTruthy();
  });
});
