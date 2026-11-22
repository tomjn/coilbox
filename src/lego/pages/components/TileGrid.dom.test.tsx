// @vitest-environment happy-dom

/**
 * The one grid of shapes, parts and modules (#4536). The WebGL canvas is
 * replaced by a renderer that records what it is asked to draw, so the test can
 * see which geometry each tile gets. happy-dom lays nothing out, so the page
 * tests check the structure the sticky canvas and the grid's width rest on,
 * not where they land on screen.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { getShapeGeometry, type ShapeKind } from "../../shapes";

const drawn = vi.hoisted(() => ({
  scenes: [] as unknown[],
  partGeometry: null as unknown,
}));

vi.mock("@/lib/useCanvas3D", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    useCanvas3D: (
      host: unknown,
      build: (
        canvas: unknown,
      ) =>
        | { resize: (w: number, h: number) => void; dispose: () => void }
        | undefined,
      _deps: unknown,
      ready = true,
    ) => {
      useLayoutEffect(() => {
        if (!ready) return;
        const renderer = {
          domElement: { clientWidth: 600 },
          render: (scene: unknown) => drawn.scenes.push(scene),
        };
        const scene = build({ renderer, host, render() {}, resize() {} });
        scene?.resize(600, 400);
        return () => scene?.dispose();
        // Once ready, as the real hook builds once for the grid's `[]` deps.
      }, [ready]);
    },
  };
});

vi.mock("../../../general/display", () => ({ useReduceMotion: () => true }));

vi.mock("../../geometry", () => ({
  addStandardLights: () => {},
  importedMaterial: () => ({
    material: new THREE.MeshBasicMaterial(),
    dispose: () => {},
  }),
  partMaterial: () => new THREE.MeshBasicMaterial(),
}));

vi.mock("../../compoundPreview", () => ({
  buildCompoundHolder: () => new THREE.Group(),
}));

vi.mock("../../pack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../pack")>()),
  getPartGeometry: () => drawn.partGeometry,
}));

import {
  type GridItem,
  type GridSection,
  type TileDrag,
  TileGrid,
} from "./TileGrid";

const part = (id: string): LegoPartInfo =>
  ({
    id,
    name: id,
    tags: ["beam"],
    bbox: { min: [0, 0, 0], max: [4, 1, 1] },
  }) as unknown as LegoPartInfo;

const module = (id: string): LegoProject =>
  ({ id, name: `Module ${id}`, pieces: [] }) as unknown as LegoProject;

const pack = {
  parts: [] as LegoPartInfo[],
  manifest: { categories: [] },
  library: {
    packs: [],
    atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
  },
} as unknown as LoadedPack;

const cylinder: ShapeKind = {
  id: "cylinder",
  kind: "cylinder",
  label: "Cylinder",
  size: [2, 2, 2],
  tags: ["round"],
};

function sections({
  shapes = [],
  parts = [],
  modules = [],
  partsTotal = parts.length,
}: {
  shapes?: ShapeKind[];
  parts?: LegoPartInfo[];
  modules?: LegoProject[];
  partsTotal?: number;
}): GridSection[] {
  return [
    {
      id: "shapes",
      label: "Shapes",
      total: 6,
      items: shapes.map((shape) => ({ kind: "shape", shape })),
    },
    {
      id: "parts",
      label: "Parts",
      total: partsTotal,
      items: parts.map((p) => ({ kind: "part", part: p })),
    },
    {
      id: "saved",
      label: "Saved modules",
      total: modules.length,
      items: modules.map((m) => ({ kind: "module", module: m })),
    },
  ];
}

function tiles(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("button[data-index]"),
  ];
}

const focused = (container: HTMLElement) =>
  tiles(container).find((tile) => tile.tabIndex === 0) as HTMLButtonElement;

beforeEach(() => {
  drawn.scenes = [];
  drawn.partGeometry = new THREE.BufferGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});

afterEach(cleanup);

describe("sections", () => {
  it("are headed with their name and count, and an empty one is left out", () => {
    render(
      <TileGrid
        pack={pack}
        sections={sections({
          shapes: [],
          parts: [part("beam"), part("block")],
          partsTotal: 373,
          modules: [module("a")],
        })}
      />,
    );
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Parts2 of 373", "Saved modules1"]);
  });

  it("put every tile in one list, with its name under it", () => {
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({
          shapes: [cylinder],
          parts: [part("beam")],
          modules: [module("a")],
        })}
      />,
    );
    expect(tiles(container).map((tile) => tile.textContent)).toEqual([
      "Cylinder",
      "beam",
      "Module a",
    ]);
    expect(tiles(container).map((tile) => tile.dataset.index)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  it("give shapes, parts and modules each their own title", () => {
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({
          shapes: [cylinder],
          parts: [part("beam")],
          modules: [module("a")],
        })}
      />,
    );
    expect(tiles(container).map((tile) => tile.title)).toEqual([
      "Cylinder, 2 x 2 x 2",
      "beam, beam",
      "Module a, 0 pieces",
    ]);
  });
});

describe("part names", () => {
  it("hides atlas row tags and tells parts with one name apart", () => {
    const one = {
      ...part("one"),
      name: "grey beam",
      tags: ["beam", "row5"],
      sourceNames: ["Object12"],
    } as LegoPartInfo;
    const two = { ...one, id: "two", sourceNames: ["Object40"] };
    const { container } = render(
      <TileGrid
        pack={{ ...pack, parts: [one, two] } as LoadedPack}
        sections={sections({ parts: [one, two] })}
      />,
    );
    expect(tiles(container).map((tile) => tile.title)).toEqual([
      "grey beam (Object12), beam",
      "grey beam (Object40), beam",
    ]);
  });
});

describe("drawing", () => {
  it("draws shapes from their own geometry and parts from the pack's", () => {
    render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder], parts: [part("beam")] })}
      />,
    );
    const scene = drawn.scenes.at(-1) as THREE.Scene;
    const meshes = scene.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(meshes.map((mesh) => mesh.geometry)).toEqual([
      getShapeGeometry({ kind: "cylinder", size: [2, 2, 2] }),
      drawn.partGeometry,
    ]);
    // Fitted to the tile by their longest side.
    expect(meshes[0].scale.x).toBeCloseTo((88 * 0.62) / 2);
    expect(meshes[1].scale.x).toBeCloseTo((88 * 0.62) / 4);
  });

  it("draws a module's assembly in its tile on the same canvas", () => {
    render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")], modules: [module("a")] })}
      />,
    );
    const scene = drawn.scenes.at(-1) as THREE.Scene;
    const groups = scene.children.filter(
      (child): child is THREE.Group =>
        child instanceof THREE.Group && child.visible,
    );
    expect(groups).toHaveLength(1);
    // Second tile across, below the Saved modules heading and the parts row:
    // the centre of a tile 88 square, 96 apart, under a 24 heading and 8 gap.
    expect(groups[0].position.x).toBe(44);
    expect(groups[0].position.y).toBe(-(24 + 114 + 8 + 24 + 44));
  });
});

describe("picking", () => {
  it("hands the tile's item over, with the Alt key", () => {
    const onPick = vi.fn<(item: GridItem, alt: boolean) => void>();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder], modules: [module("b")] })}
        onPick={onPick}
      />,
    );
    fireEvent.click(tiles(container)[0], { altKey: true });
    expect(onPick).toHaveBeenLastCalledWith(
      { kind: "shape", shape: cylinder },
      true,
    );
    fireEvent.click(tiles(container)[1]);
    expect(onPick).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "module" }),
      false,
    );
  });

  it("says a module will be placed where there is a unit", () => {
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ modules: [module("a")] })}
        placesModules
      />,
    );
    expect(tiles(container)[0].title).toMatch(/^Place Module a/);
  });

  it("draws the chosen tile pressed", () => {
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")], modules: [module("a")] })}
        selectedKey="module:a"
      />,
    );
    expect(
      tiles(container).map((tile) => tile.getAttribute("aria-pressed")),
    ).toEqual(["false", "true"]);
  });
});

describe("dragging a tile", () => {
  function dragger(): TileDrag {
    return {
      start: vi.fn(() => true),
      move: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(),
    };
  }
  const press = (tile: HTMLElement) =>
    fireEvent.pointerDown(tile, { button: 0, clientX: 10, clientY: 10 });

  it("keeps a press and release in place a click that picks the tile", () => {
    const onPick = vi.fn<(item: GridItem, alt: boolean) => void>();
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")] })}
        onPick={onPick}
        drag={drag}
      />,
    );
    const [tile] = tiles(container);
    press(tile);
    fireEvent.pointerUp(window, { clientX: 11, clientY: 10 });
    fireEvent.click(tile);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(drag.start).not.toHaveBeenCalled();
  });

  it("still picks with Enter or Space, which press no pointer", () => {
    const onPick = vi.fn<(item: GridItem, alt: boolean) => void>();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")] })}
        onPick={onPick}
        drag={dragger()}
      />,
    );
    fireEvent.click(tiles(container)[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("drags once the pointer travels, drops on release and does not pick", () => {
    const onPick = vi.fn<(item: GridItem, alt: boolean) => void>();
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")] })}
        onPick={onPick}
        drag={drag}
      />,
    );
    const [tile] = tiles(container);
    press(tile);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    expect(drag.start).toHaveBeenCalledWith({
      kind: "part",
      part: part("beam"),
    });
    expect(drag.move).toHaveBeenLastCalledWith(60, 10);
    expect(document.documentElement.dataset.partDrag).toBe("");
    fireEvent.pointerUp(window, { clientX: 80, clientY: 20 });
    expect(drag.end).toHaveBeenCalledWith(80, 20);
    expect(document.documentElement.dataset.partDrag).toBeUndefined();
    fireEvent.click(tile);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("cancels on Escape and drops nothing on release", () => {
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")] })}
        drag={drag}
      />,
    );
    press(tiles(container)[0]);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(drag.cancel).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(window, { clientX: 80, clientY: 20 });
    expect(drag.end).not.toHaveBeenCalled();
  });

  it("leaves a tile the page will not drag as a click", () => {
    const drag = { ...dragger(), start: vi.fn(() => false) };
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ parts: [part("beam")] })}
        drag={drag}
      />,
    );
    press(tiles(container)[0]);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10 });
    expect(drag.move).not.toHaveBeenCalled();
    expect(drag.end).not.toHaveBeenCalled();
  });

  it("drags a shape, which the page decides what to do with", () => {
    const onPick = vi.fn<(item: GridItem, alt: boolean) => void>();
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder] })}
        onPick={onPick}
        drag={drag}
      />,
    );
    const [tile] = tiles(container);
    press(tile);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    expect(drag.start).toHaveBeenCalledWith({ kind: "shape", shape: cylinder });
    fireEvent.pointerUp(window, { clientX: 80, clientY: 20 });
    expect(drag.end).toHaveBeenCalledWith(80, 20);
    fireEvent.click(tile);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("drags a module, mesh-bearing or not, and releases outside as an end", () => {
    const meshes = {
      ...module("lifted"),
      pieces: [{ id: "a", meshId: "mesh-1" }],
    } as unknown as LegoProject;
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ modules: [meshes] })}
        drag={drag}
      />,
    );
    press(tiles(container)[0]);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    expect(drag.start).toHaveBeenCalledWith({ kind: "module", module: meshes });
    // The page checks where the release landed, so an off-screen release is
    // still an end and not a cancel.
    fireEvent.pointerUp(window, { clientX: -50, clientY: -50 });
    expect(drag.end).toHaveBeenCalledWith(-50, -50);
    expect(drag.cancel).not.toHaveBeenCalled();
  });

  it("cancels once, whichever of Escape or the system ends the drag first", () => {
    const drag = dragger();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder] })}
        drag={drag}
      />,
    );
    press(tiles(container)[0]);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerCancel(window);
    expect(drag.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("the keyboard", () => {
  // Six across at 600 wide: shapes take one row, parts the next two.
  const many = Array.from({ length: 9 }, (_, i) => part(`p${i}`));

  it("moves across sections as one list", () => {
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder], parts: many })}
      />,
    );
    expect(focused(container).dataset.index).toBe("0");
    fireEvent.keyDown(focused(container), { key: "ArrowRight" });
    expect(focused(container).textContent).toBe("p0");
    fireEvent.keyDown(focused(container), { key: "ArrowLeft" });
    fireEvent.keyDown(focused(container), { key: "ArrowDown" });
    expect(focused(container).textContent).toBe("p0");
    fireEvent.keyDown(focused(container), { key: "ArrowDown" });
    expect(focused(container).textContent).toBe("p6");
    fireEvent.keyDown(focused(container), { key: "ArrowUp" });
    fireEvent.keyDown(focused(container), { key: "ArrowUp" });
    expect(focused(container).textContent).toBe("Cylinder");
  });

  it("stars the focused tile with F", () => {
    const onFavourite = vi.fn();
    const { container } = render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder] })}
        onFavourite={onFavourite}
      />,
    );
    fireEvent.keyDown(tiles(container)[0], { key: "f" });
    expect(onFavourite).toHaveBeenCalledWith({
      kind: "shape",
      shape: cylinder,
    });
  });

  it("shows a pressed star for a favourite", () => {
    render(
      <TileGrid
        pack={pack}
        sections={sections({ shapes: [cylinder], modules: [module("a")] })}
        favourites={new Set(["module:a"])}
        onFavourite={() => {}}
      />,
    );
    expect(
      screen
        .getByLabelText("Favourite the Cylinder shape")
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByLabelText("Favourite the Module a module")
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

/** A module's actions are in the detail panel (#4537), so its tile is a part's. */
describe("a module's tile", () => {
  it("has only its star beside the tile itself", () => {
    render(
      <TileGrid
        pack={pack}
        sections={sections({ modules: [module("a")] })}
        favourites={new Set()}
        onFavourite={() => {}}
      />,
    );
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? "tile"),
    ).toEqual(["tile", "Favourite the Module a module"]);
  });
});

describe("scrolling with the page", () => {
  const many = Array.from({ length: 30 }, (_, i) => part(`p${i}`));

  function Page({ parts = many }: { parts?: LegoPartInfo[] }) {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div ref={root} data-testid="page">
        <TileGrid
          pack={pack}
          sections={sections({ parts })}
          scrollRoot={root}
        />
      </div>
    );
  }

  it("has no scroller of its own, and is as tall as its rows", () => {
    render(<Page />);
    const page = screen.getByTestId("page");
    expect(page.querySelector('[class*="overflow-y-auto"]')).toBeNull();
    // 600 wide holds 6 tiles of 88 with gaps of 8, so 30 are 5 rows of 114
    // under a heading of 24, less the last gap.
    const content = page.firstElementChild as HTMLElement;
    expect(content.style.height).toBe(`${24 + 5 * 114 - 8}px`);
  });

  // A flex item with no width is as wide as its content. Here the only content
  // in the flow is the canvas, whose size comes from the grid, so the width and
  // the canvas fed each other (#4520).
  it("is as wide as its area, whatever the canvas holds", () => {
    render(<Page />);
    const content = screen.getByTestId("page").firstElementChild as HTMLElement;
    expect(content.className).toContain("w-full");
    expect(content.className).toContain("min-w-0");
  });

  it("keeps the canvas in a sticky box over the tiles, no taller than the page", () => {
    render(<Page />);
    const content = screen.getByTestId("page").firstElementChild as HTMLElement;
    const host = content.firstElementChild as HTMLElement;
    expect(host.className).toContain("sticky");
    expect(host.className).toContain("top-0");
    expect(host.className).toContain("pointer-events-none");
    expect(host.style.height).toBe("400px");
  });

  it("scrolls the page, not itself, to bring a tile into view", () => {
    const tall = Array.from({ length: 60 }, (_, i) => part(`t${i}`));
    const { container } = render(<Page parts={tall} />);
    const page = screen.getByTestId("page");
    // Page Down is 4 rows down. Row 4 starts at 24 + 4 * 114 = 480 and its
    // tile ends 106 lower, so the page scrolls until that is its bottom.
    fireEvent.keyDown(tiles(container)[0], { key: "PageDown" });
    expect(focused(container).dataset.index).toBe("24");
    expect(page.scrollTop).toBe(480 + 106 - 400);
  });
});

describe("scrolling in the drawer", () => {
  it("scrolls in a box of its own, with the canvas laid over it", () => {
    const { container } = render(
      <div className="flex">
        <TileGrid pack={pack} sections={sections({ parts: [part("beam")] })} />
      </div>,
    );
    const root = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(root.className).toContain("min-w-0");
    expect(root.querySelector('[class*="overflow-y-auto"]')).toBeTruthy();
    const host = root.lastElementChild as HTMLElement;
    expect(host.className).toContain("pointer-events-none");
    expect(host.className).toContain("z-10");
  });
});
