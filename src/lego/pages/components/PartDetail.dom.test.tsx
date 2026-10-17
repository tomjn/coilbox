// @vitest-environment happy-dom

/**
 * The detail beside the Lego Parts grid for a generated shape (#3337): the
 * kind, its numbers and a preview that turns, with no pack, colourway or part
 * id. The canvas is replaced by a hook that runs the view's build.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedPack } from "../../pack";
import type { ShapeKind } from "../../shapes";

const motion = vi.hoisted(() => ({ reduce: false }));

vi.mock("@/lib/useCanvas3D", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    useCanvas3D: (
      _host: unknown,
      build: (canvas: unknown) => { dispose: () => void } | undefined,
      deps: unknown[],
    ) => {
      useLayoutEffect(() => {
        const renderer = {
          domElement: document.createElement("canvas"),
          render() {},
        };
        const scene = build({ renderer });
        return () => scene?.dispose();
        // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's own list, as the real hook takes it
      }, deps);
    },
  };
});

vi.mock("../../../general/display", () => ({
  useReduceMotion: () => motion.reduce,
}));

vi.mock("../../geometry", () => ({
  addStandardLights: () => {},
  partMaterial: () => new THREE.MeshBasicMaterial(),
}));

import { ShapeDetail } from "./PartDetail";

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
  size: [2, 3, 2],
  tags: ["round", "pole"],
};

let frames: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  motion.reduce = false;
  frames = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the shape detail", () => {
  it("shows the kind, its numbers and its tags, and no part fields", () => {
    const { container } = render(
      <ShapeDetail pack={pack} shape={cylinder} onClose={() => {}} />,
    );
    expect(screen.getByRole("heading", { name: "Cylinder" })).toBeTruthy();
    expect(container.textContent).toContain("cylinder");
    expect(container.textContent).toContain("2 x 3 x 2");
    expect(container.textContent).toContain("round, pole");
    for (const label of ["Part id", "Colourway", "Pack", "Atlas"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("lists a kind's options by name", () => {
    render(
      <ShapeDetail
        pack={pack}
        shape={{ ...cylinder, options: { sides: 8 } }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("sides")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("turns the preview, unless motion is reduced", () => {
    render(<ShapeDetail pack={pack} shape={cylinder} onClose={() => {}} />);
    expect(frames).toHaveBeenCalled();
    cleanup();
    frames.mockClear();
    motion.reduce = true;
    render(<ShapeDetail pack={pack} shape={cylinder} onClose={() => {}} />);
    expect(frames).not.toHaveBeenCalled();
  });

  it("closes", () => {
    const onClose = vi.fn();
    render(<ShapeDetail pack={pack} shape={cylinder} onClose={onClose} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Close shape details" }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
