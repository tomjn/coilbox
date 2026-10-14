// @vitest-environment happy-dom
/**
 * A land map with placed models opens once (issue #3996). The models' sources
 * arrive after the scene is built, and they are added to it instead of the
 * terrain being built again.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalaxyDoc } from "../model";
import type { PlacedModelSources } from "./placedModelLoaders";

const h = vi.hoisted(() => ({
  terrainBuilds: vi.fn(),
  gameRead: vi.fn(),
}));

vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    domElement = document.createElement("canvas");
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});
vi.mock("three/addons/renderers/CSS2DRenderer.js", async (orig) => {
  class FakeLabelRenderer {
    domElement = document.createElement("div");
    setSize() {}
    render() {}
  }
  return {
    ...(await orig<typeof import("three/addons/renderers/CSS2DRenderer.js")>()),
    CSS2DRenderer: FakeLabelRenderer,
  };
});
vi.mock("./terrainMesh", () => ({
  buildTerrainMesh: (...args: unknown[]) => h.terrainBuilds(...args),
}));
vi.mock("./placedModelLoaders", () => ({
  placedModelLoaders: () => ({
    game: async (names: string[]) => {
      h.gameRead(names);
      return new Map();
    },
    file: async () => {
      throw new Error("no file");
    },
  }),
}));

const { GalaxyView } = await import("./GalaxyView");

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  h.terrainBuilds.mockReset();
  h.gameRead.mockReset();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  window.matchMedia = (() => ({ matches: true })) as never;
  // Each frame the view asks for is dropped, so no draw runs.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const galaxy = {
  schemaVersion: 1,
  id: "shores",
  type: "conquest-galaxy",
  title: "Shores",
  description: "",
  game: { name: "g" },
  playerFactionId: "a",
  factions: [{ id: "a", name: "A", color: "#ff0000" }],
  nodes: [
    { id: "n1", name: "One", pos: [20, 20], owner: "a", difficulty: 1 },
    { id: "n2", name: "Two", pos: [80, 80], owner: "a", difficulty: 1 },
  ],
  links: [["n1", "n2"]],
  terrain: { image: "data:image/png;base64,AAAA", width: 100, height: 100 },
  models: [{ model: { game: "pinetree" }, pos: [10, 10] }],
} as unknown as GalaxyDoc;

const color = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray(16),
} as never;
const terrainPixels = { color };

describe("GalaxyView with placed models", () => {
  it("builds the terrain once when the model sources arrive after the scene", async () => {
    const pending: PlacedModelSources = { pending: true };
    const ready: PlacedModelSources = {
      game: { enginePath: "/e", dataDir: "/d", gameArchive: "g.sdz" },
    };
    const view = (sources: PlacedModelSources) => (
      <GalaxyView
        galaxy={galaxy}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        modelSources={sources}
        display={{ reduceMotion: true, effects: false }}
      />
    );
    const { rerender } = render(view(pending));
    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
    expect(h.gameRead).not.toHaveBeenCalled();

    await act(async () => {
      rerender(view(ready));
    });

    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
    expect(h.gameRead).toHaveBeenCalledTimes(1);
    expect(h.gameRead).toHaveBeenCalledWith(["pinetree"]);
  });

  it("reads the models once when the sources are there from the start", async () => {
    const ready: PlacedModelSources = {
      game: { enginePath: "/e", dataDir: "/d", gameArchive: "g.sdz" },
    };
    await act(async () => {
      render(
        <GalaxyView
          galaxy={galaxy}
          playerFactionId="a"
          owners={{}}
          terrainPixels={terrainPixels}
          modelSources={ready}
          display={{ reduceMotion: true, effects: false }}
        />,
      );
    });
    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
    expect(h.gameRead).toHaveBeenCalledTimes(1);
  });
});
