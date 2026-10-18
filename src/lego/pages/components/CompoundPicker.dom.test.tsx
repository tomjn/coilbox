// @vitest-environment happy-dom

/**
 * The module grid on the Lego Parts page, where it scrolls with the page
 * (#4520). happy-dom lays nothing out, so these check the structure the grid's
 * width rests on, not where it lands on screen. The WebGL canvas is replaced by
 * a renderer that records the camera it is asked to draw with.
 */

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";

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
          render: () => {},
        };
        const scene = build({ renderer, host, render() {}, resize() {} });
        scene?.resize(600, 400);
        return () => scene?.dispose();
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

import { CompoundPicker } from "./CompoundPicker";

const pack = {
  library: {
    packs: [],
    atlases: [{ tex1: "atlas.png", packId: "lego", folder: null }],
  },
} as unknown as LoadedPack;

const module = (id: string): LegoProject =>
  ({ id, name: `Module ${id}`, pieces: [] }) as unknown as LegoProject;

const noop = () => {};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});

afterEach(cleanup);

describe("scrolling with the page", () => {
  const several = [module("a"), module("b"), module("c")];

  function Page() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <div ref={root} data-testid="page">
        <CompoundPicker
          pack={pack}
          compounds={several}
          onDelete={noop}
          onRename={noop}
          onCopy={noop}
          scrollRoot={root}
        />
      </div>
    );
  }

  it("has no scroller of its own", () => {
    const { getByTestId } = render(<Page />);
    expect(
      getByTestId("page").querySelector('[class*="overflow-y-auto"]'),
    ).toBeNull();
  });

  // A flex item with no width is as wide as its content. Here the only content
  // in the flow is the canvas, whose size comes from the grid, so the width and
  // the canvas fed each other (#4520).
  it("is as wide as its area, whatever the canvas holds", () => {
    const { getByTestId } = render(<Page />);
    const content = getByTestId("page").firstElementChild as HTMLElement;
    expect(content.className).toContain("w-full");
    expect(content.className).toContain("min-w-0");
    expect(content.className).toContain("shrink-0");
  });
});
