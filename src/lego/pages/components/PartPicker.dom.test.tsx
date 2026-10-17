// @vitest-environment happy-dom

/**
 * The parts grid with generated shapes in it (#3337). The WebGL canvas is
 * replaced by a renderer that records what it is asked to draw, so the test can
 * see which geometry each cell gets.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        // Once ready, as the real hook builds once for the picker's `[]` deps.
      }, [ready]);
    },
  };
});

vi.mock("../../../general/display", () => ({ useReduceMotion: () => true }));

vi.mock("../../geometry", () => ({
  addStandardLights: () => {},
  partMaterial: () => new THREE.MeshBasicMaterial(),
}));

vi.mock("../../pack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../pack")>()),
  getPartGeometry: () => drawn.partGeometry,
}));

import { PartPicker } from "./PartPicker";

const part = (id: string): LegoPartInfo =>
  ({
    id,
    name: id,
    tags: ["beam"],
    bbox: { min: [0, 0, 0], max: [4, 1, 1] },
  }) as unknown as LegoPartInfo;

const pack = {
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

function cells(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>("button[data-index]"),
  ];
}

beforeEach(() => {
  drawn.scenes = [];
  drawn.partGeometry = new THREE.BufferGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});

afterEach(cleanup);

describe("shape cells", () => {
  it("come before the parts, named by their kind", () => {
    const { container } = render(
      <PartPicker
        pack={pack}
        parts={[part("beam"), part("block")]}
        shapes={[cylinder]}
      />,
    );
    expect(cells(container).map((cell) => cell.textContent)).toEqual([
      "Cylinder",
      "beam",
      "block",
    ]);
  });

  it("have a tooltip with the kind and its default size", () => {
    const { container } = render(
      <PartPicker pack={pack} parts={[part("beam")]} shapes={[cylinder]} />,
    );
    expect(cells(container)[0].title).toBe("Cylinder, 2 x 2 x 2");
  });

  it("are drawn from their own generated geometry, beside the pack's", () => {
    render(
      <PartPicker pack={pack} parts={[part("beam")]} shapes={[cylinder]} />,
    );
    const scene = drawn.scenes.at(-1) as THREE.Scene;
    const meshes = scene.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    );
    expect(meshes.map((mesh) => mesh.geometry)).toEqual([
      getShapeGeometry({ kind: "cylinder", size: [2, 2, 2] }),
      drawn.partGeometry,
    ]);
    // Fitted to the cell by their longest side, as parts are.
    expect(meshes[0].scale.x).toBeCloseTo((72 * 0.62) / 2);
    expect(meshes[1].scale.x).toBeCloseTo((72 * 0.62) / 4);
  });

  it("are real buttons that add the shape on a click", () => {
    const onSelectShape = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <PartPicker
        pack={pack}
        parts={[part("beam")]}
        shapes={[cylinder]}
        onSelect={onSelect}
        onSelectShape={onSelectShape}
      />,
    );
    fireEvent.click(cells(container)[0]);
    expect(onSelectShape).toHaveBeenCalledWith(cylinder, false);
    fireEvent.click(cells(container)[0], { altKey: true });
    expect(onSelectShape).toHaveBeenLastCalledWith(cylinder, true);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(cells(container)[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("take part in the arrow key order and the star key", () => {
    const onFavouriteShape = vi.fn();
    const { container } = render(
      <PartPicker
        pack={pack}
        parts={[part("beam")]}
        shapes={[cylinder]}
        onFavouriteShape={onFavouriteShape}
      />,
    );
    const [first, second] = cells(container);
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(cells(container)[1].tabIndex).toBe(0);
    fireEvent.keyDown(first, { key: "f" });
    expect(onFavouriteShape).toHaveBeenCalledWith(cylinder);
  });

  it("show a pressed star for a favourite kind", () => {
    const { getByLabelText } = render(
      <PartPicker
        pack={pack}
        parts={[]}
        shapes={[cylinder]}
        favouriteShapes={new Set(["cylinder"])}
        onFavouriteShape={() => {}}
      />,
    );
    expect(
      getByLabelText("Favourite the Cylinder shape").getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("are not drawn when the grid is given none", () => {
    const { container } = render(
      <PartPicker pack={pack} parts={[part("beam")]} />,
    );
    expect(cells(container).map((cell) => cell.textContent)).toEqual(["beam"]);
  });
});

/**
 * On the Lego Parts page the grid scrolls with the page rather than in a box of
 * its own (#4468). happy-dom lays nothing out, so these check the structure the
 * sticky canvas rests on, not where it lands on screen.
 */
describe("scrolling with the page", () => {
  const many = Array.from({ length: 30 }, (_, i) => part(`p${i}`));

  function Page() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div ref={root} data-testid="page">
        <PartPicker pack={pack} parts={many} scrollRoot={root} />
      </div>
    );
  }

  it("has no scroller of its own, and is as tall as its rows", () => {
    const { getByTestId } = render(<Page />);
    const page = getByTestId("page");
    expect(page.querySelector('[class*="overflow-y-auto"]')).toBeNull();
    // 600 pixels wide holds 7 cells of 72 with gaps of 8, so 30 cells are 5
    // rows: 5 pitches of 80 less the last gap.
    const content = page.firstElementChild as HTMLElement;
    expect(content.style.height).toBe("392px");
  });

  it("keeps the canvas in a sticky box no taller than the page", () => {
    const { getByTestId } = render(<Page />);
    const content = getByTestId("page").firstElementChild as HTMLElement;
    const host = content.firstElementChild as HTMLElement;
    expect(host.className).toContain("sticky");
    expect(host.className).toContain("top-0");
    // Every element reports a client height of 400 here, so the page is 400
    // tall and the grid, at 392, is shorter.
    expect(host.style.height).toBe("392px");
  });

  it("scrolls the page, not itself, to bring a cell into view", () => {
    const tall = Array.from({ length: 70 }, (_, i) => part(`t${i}`));
    function TallPage() {
      const root = useRef<HTMLDivElement>(null);
      return (
        <div ref={root} data-testid="tall">
          <PartPicker pack={pack} parts={tall} scrollRoot={root} />
        </div>
      );
    }
    const { getByTestId, container } = render(<TallPage />);
    const page = getByTestId("tall");
    const content = page.firstElementChild as HTMLElement;
    // 70 cells are 10 rows, 792 tall, so the canvas stops at the page's 400.
    expect(content.style.height).toBe("792px");
    expect((content.firstElementChild as HTMLElement).style.height).toBe(
      "400px",
    );
    // Page Down twice is 8 rows down. Row 8 starts at 640 and its cell ends
    // at 712, so the page scrolls until that is its bottom edge: 712 - 400.
    fireEvent.keyDown(cells(container)[0], { key: "PageDown" });
    const focused = () =>
      cells(container).find((cell) => cell.tabIndex === 0) as HTMLElement;
    fireEvent.keyDown(focused(), { key: "PageDown" });
    expect(page.scrollTop).toBe(312);
  });
});
