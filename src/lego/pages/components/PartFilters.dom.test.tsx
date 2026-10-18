// @vitest-environment happy-dom

/**
 * The controls above a parts grid, and what they are told about the library
 * (issue #586).
 *
 * `../../filter.test.ts` covers what a query and a category actually keep. This
 * is the row of controls in the Change part drawer that drives it, plus the three things it says about a
 * library rather than about a part: the pack picker only appears once there is
 * more than one pack to choose between, a pack that would not load is shown
 * rather than logged, and the atlas list only appears once a unit has a choice.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  over: { category?: string | null; shown?: number } = {},
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
    />,
  );
}

/** Opens the category menu and picks the named option. */
function pickCategory(option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
  fireEvent.click(screen.getByRole("option", { name: option }));
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

  it("offers every colourway the pack declares, and a genuine all", () => {
    show(pack());
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["All categories", "Grey", "Tan"]);
  });

  /** The swap drawer lists parts alone, so it has no Shapes entry. */
  it("leaves Shapes out", () => {
    show(pack());
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    expect(screen.queryByRole("option", { name: "Shapes" })).toBeNull();
  });

  it("shows the colourway in force in the menu", () => {
    show(pack(), { category: "tan" });
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toBe(
      "Tan",
    );
  });

  /** Clearing the category is null, not the string "all": every part matches,
   *  including one in no category at all. */
  it("chooses a colourway, and clears it rather than filtering by all", () => {
    show(pack());
    pickCategory("Grey");
    expect(onCategory).toHaveBeenLastCalledWith("grey");
    cleanup();
    show(pack(), { category: "tan" });
    pickCategory("All categories");
    expect(onCategory).toHaveBeenLastCalledWith(null);
  });

  /** The container query swapped controls in the frame it measured them,
   *  which flooded the console with ResizeObserver errors (#4538). */
  it("has no container query", () => {
    const { container } = show(pack());
    expect(container.innerHTML).not.toContain("@container");
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
