// @vitest-environment happy-dom
/**
 * A land map with placed models opens once (issue #3996). The models' sources
 * arrive after the scene is built, and they are added to it instead of the
 * terrain being built again. Its ground detail is baked over the first frames
 * (issue #3992).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalaxyDoc } from "../model";
import type { PlacedModelSources } from "./placedModelLoaders";

const h = vi.hoisted(() => ({
  terrainBuilds: vi.fn(),
  gameRead: vi.fn(),
  rendererOptions: [] as unknown[],
  lost: vi.fn(),
  /** Whether a browser has taken a context back, by the renderer's number. */
  taken: new Set<number>(),
  made: 0,
}));

vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer {
    constructor(options: unknown) {
      h.rendererOptions.push(options);
    }
    number = h.made++;
    getContext() {
      return { isContextLost: () => h.taken.has(this.number) };
    }
    domElement = document.createElement("canvas");
    setClearColor() {}
    pixelRatio = 1;
    getPixelRatio() {
      return this.pixelRatio;
    }
    setPixelRatio(ratio: number) {
      this.pixelRatio = ratio;
    }
    setSize() {}
    render() {}
    async compileAsync() {}
    getRenderTarget() {
      return null;
    }
    setRenderTarget() {}
    dispose() {}
    clear() {}
    forceContextLoss() {
      h.lost();
    }
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
const { releaseKeptRenderers } = await import("../../lib/keptRenderer");

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  releaseKeptRenderers();
  h.terrainBuilds.mockReset();
  h.gameRead.mockReset();
  h.rendererOptions.length = 0;
  h.taken.clear();
  h.made = 0;
  h.lost.mockReset();
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

  it("keeps the scene it built when the player picks another faction", async () => {
    const view = (playerFactionId: string) => (
      <GalaxyView
        galaxy={galaxy}
        playerFactionId={playerFactionId}
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />
    );
    const { rerender, container } = render(view("a"));
    const canvas = container.querySelector("canvas");
    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender(view("b"));
    });

    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
    expect(container.querySelector("canvas")).toBe(canvas);
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

  // WebKit counts a context after it is given back, so a map rebuilt for every
  // galaxy it is shown made another view blank (issue #5348).
  it("keeps one renderer while it is shown one galaxy after another", async () => {
    const view = (n: number) => (
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined, title: `Shores ${n}` }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />
    );
    const { rerender, container, unmount } = render(view(0));
    const canvas = container.querySelector("canvas");
    for (let n = 1; n <= 20; n++) {
      await act(async () => {
        rerender(view(n));
      });
    }
    expect(h.terrainBuilds).toHaveBeenCalledTimes(21);
    expect(h.rendererOptions).toHaveLength(1);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(h.lost).not.toHaveBeenCalled();
    unmount();
    // Parked for the next map rather than given back (issue #5351).
    expect(h.lost).not.toHaveBeenCalled();
    releaseKeptRenderers();
    expect(h.lost).toHaveBeenCalledTimes(1);
  });

  // WebKit counts a context until its canvas is collected, so a map opened
  // again and again, as the conquest page does each time it is visited, ran the
  // browser out at the 15th open and another view went blank (issue #5351).
  it("makes one renderer however many times the map is opened", async () => {
    const view = (
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />
    );
    for (let open = 0; open < 20; open++) {
      const shown = render(view);
      expect(shown.container.querySelectorAll("canvas")).toHaveLength(1);
      shown.unmount();
    }
    expect(h.terrainBuilds).toHaveBeenCalledTimes(20);
    expect(h.rendererOptions).toHaveLength(1);
    expect(h.lost).not.toHaveBeenCalled();
  });

  it("does not take a renderer back that the browser has lost", () => {
    const view = (
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />
    );
    render(view).unmount();
    h.taken.add(0);
    render(view).unmount();
    expect(h.rendererOptions).toHaveLength(2);
    expect(h.lost).toHaveBeenCalledTimes(1);
  });

  it("makes a new renderer when performance mode changes its antialiasing", async () => {
    const view = (performanceMode: boolean) => (
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false, performanceMode }}
      />
    );
    const { rerender, container } = render(view(false));
    await act(async () => {
      rerender(view(true));
    });
    expect(h.rendererOptions).toHaveLength(2);
    expect(h.rendererOptions[1]).toMatchObject({ antialias: false });
    // The antialiased one is kept for the next map that wants it.
    expect(h.lost).not.toHaveBeenCalled();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    await act(async () => {
      rerender(view(false));
    });
    expect(h.rendererOptions).toHaveLength(2);
  });

  it("asks for the high performance GPU", () => {
    render(
      <GalaxyView
        galaxy={galaxy}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        modelSources={{ pending: true }}
        display={{ reduceMotion: true, effects: false }}
      />,
    );
    expect(h.rendererOptions).toHaveLength(1);
    expect(h.rendererOptions[0]).toMatchObject({
      powerPreference: "high-performance",
    });
  });
});

describe("GalaxyView baking the ground", () => {
  it("prepares the ground before each draw and asks for frames until it is done", async () => {
    const prepare = vi.fn();
    prepare.mockReturnValueOnce(true).mockReturnValueOnce(true);
    prepare.mockReturnValue(false);
    h.terrainBuilds.mockReturnValue({ prepare });
    const queued: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      queued.push(cb);
      return queued.length;
    });
    render(
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />,
    );
    // Nothing draws until the shaders are compiled.
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => {});
    // Each frame drawn runs whatever the last one asked for.
    for (let i = 0; i < 10 && queued.length > 0; i++) queued.shift()?.();
    expect(queued).toHaveLength(0);
    expect(prepare).toHaveBeenCalledTimes(3);
    const renderer = prepare.mock.calls[0][0];
    expect(renderer.render).toBeTypeOf("function");
    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
  });

  it("counts the bake's tiles on the loading screen, then gives way to the map", async () => {
    let next = 0;
    const total = 3;
    const prepare = vi.fn(() => ++next < total);
    h.terrainBuilds.mockReturnValue({
      prepare,
      bake: { progress: () => ({ done: next, total }) },
    });
    const queued: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      queued.push(cb);
      return queued.length;
    });
    render(
      <GalaxyView
        galaxy={{ ...galaxy, models: undefined }}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Compiling shaders…",
    );
    await act(async () => {});
    act(() => queued.shift()?.());
    expect(screen.getByRole("status").textContent).toContain(
      "Painting the ground…",
    );
    expect(screen.getByRole("status").textContent).toContain("1 of 3");
    act(() => {
      for (let i = 0; i < 10 && queued.length > 0; i++) queued.shift()?.();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("draws nothing while paused, and catches up once when let go", async () => {
    const prepare = vi.fn().mockReturnValue(false);
    h.terrainBuilds.mockReturnValue({ prepare });
    const queued: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      queued.push(cb);
      return queued.length;
    });
    const bare = { ...galaxy, models: undefined };
    const view = (paused: boolean) => (
      <GalaxyView
        galaxy={bare}
        playerFactionId="a"
        owners={{}}
        terrainPixels={terrainPixels}
        display={{ reduceMotion: true, effects: false }}
        paused={paused}
      />
    );
    const { rerender } = render(view(true));
    await act(async () => {});
    expect(queued).toHaveLength(0);
    expect(prepare).not.toHaveBeenCalled();
    rerender(view(false));
    for (let i = 0; i < 10 && queued.length > 0; i++) queued.shift()?.();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(h.terrainBuilds).toHaveBeenCalledTimes(1);
  });
});
