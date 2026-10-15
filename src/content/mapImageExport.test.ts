import { afterEach, describe, expect, it, vi } from "vitest";
import type { HeatField } from "@/lib/heatField";
import { WHOLE } from "./mapAggregate";
import type { ImageWords } from "./mapImage";
import { canvasPng, loadMinimap } from "./mapImage";

const save = vi.fn();
vi.mock("../lego/bindings", () => ({
  legoSaveGlb: (a: unknown) => save(a),
}));

const { renderMapImage, savePngBytes } = await import("./mapImageExport");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("loadMinimap", () => {
  it("reads the bytes with fetch and makes a bitmap from the blob", async () => {
    const blob = new Blob(["png"]);
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    const bitmap = { width: 1024, height: 1024 };
    const make = vi.fn(async () => bitmap);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("createImageBitmap", make);
    await expect(
      loadMinimap("coilbox://localhost/unitsyncthumb/a.png"),
    ).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenCalledWith(
      "coilbox://localhost/unitsyncthumb/a.png",
    );
    expect(make).toHaveBeenCalledWith(blob);
  });

  it("says so when the minimap cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })),
    );
    await expect(loadMinimap("coilbox://localhost/x.png")).rejects.toThrow(
      /404 Not Found/,
    );
  });
});

describe("canvasPng", () => {
  it("returns the PNG's bytes", async () => {
    const canvas = {
      toBlob: (done: (b: Blob | null) => void, type: string) => {
        expect(type).toBe("image/png");
        done(new Blob([new Uint8Array([137, 80, 78, 71])]));
      },
    } as unknown as HTMLCanvasElement;
    expect(Array.from(await canvasPng(canvas))).toEqual([137, 80, 78, 71]);
  });

  it("rejects when the canvas cannot be encoded, as a tainted one cannot", async () => {
    const canvas = {
      toBlob: (done: (b: Blob | null) => void) => done(null),
    } as unknown as HTMLCanvasElement;
    await expect(canvasPng(canvas)).rejects.toThrow(/PNG/);
  });
});

describe("savePngBytes", () => {
  it("writes the bytes to the path through the unit builder's save", async () => {
    save.mockResolvedValue({ path: "/tmp/a.png" });
    await savePngBytes("/tmp/a.png", new Uint8Array([1, 2, 3]));
    expect(save).toHaveBeenCalledWith({ path: "/tmp/a.png", bytes: [1, 2, 3] });
  });
});

describe("renderMapImage", () => {
  const field = {
    width: 2,
    height: 2,
    worldWidth: 8192,
    worldHeight: 4096,
    radius: 1,
    peak: 1,
    peakAt: null,
    counted: 1,
    dropped: 0,
    values: new Float32Array([0, 0, 1, 0]),
  } as HeatField;
  const words = {
    info: {
      mapName: "Tabula",
      mapVersions: ["Tabula"],
      gameVersions: ["G 1"],
      matches: 2,
      filters: {
        players: "any number of players",
        sides: "any sides",
        analysed: "analysed or not",
        playedFrom: "",
        playedUntil: "",
        replaySet: "",
        includesShort: false,
      },
      worldWidth: 8192,
      worldHeight: 4096,
      exportedUtc: "2026-10-10T00:00:00.000Z",
    },
    layer: "buildings",
    layerSentence: "Where buildings were ordered",
    legend: "something",
    normalise: "share",
    window: WHOLE,
    contributing: 1,
    events: 1,
    appVersion: null,
    marks: false,
  } satisfies ImageWords;

  function fakeCanvas() {
    const draws: unknown[][] = [];
    const ctx = {
      measureText: (t: string) => ({ width: t.length * 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => {},
      drawImage: (...a: unknown[]) => draws.push(["drawImage", ...a]),
      fillRect: () => {},
      fillText: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (done: (b: Blob) => void) =>
        done(new Blob([new Uint8Array([137, 80, 78, 71])])),
    };
    return { canvas, draws };
  }

  it("draws on a canvas it made, from a bitmap it read, and closes the bitmap", async () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const c = fakeCanvas();
        made.push(c);
        return c.canvas;
      },
    });
    const close = vi.fn();
    const bitmap = { width: 1024, height: 1024, close };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"]) })),
    );
    vi.stubGlobal("createImageBitmap", async () => bitmap);

    const bytes = await renderMapImage({
      minimapUrl: "coilbox://localhost/unitsyncthumb/a.png",
      world: { worldWidth: 8192, worldHeight: 4096 },
      field,
      kind: "buildings",
      words,
      dots: [],
      places: [],
    });

    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
    expect(close).toHaveBeenCalled();
    const picture = made[0];
    // A wide map: 1024 across, 512 down, with the panel under it.
    expect(picture.canvas.width).toBe(1024);
    expect(picture.canvas.height).toBeGreaterThan(512);
    expect(picture.draws[0]).toEqual(["drawImage", bitmap, 0, 0, 1024, 512]);
  });

  it("closes the bitmap when the drawing fails", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null }),
    });
    const close = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"]) })),
    );
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 10,
      height: 10,
      close,
    }));
    await expect(
      renderMapImage({
        minimapUrl: "coilbox://localhost/a.png",
        world: { worldWidth: 1, worldHeight: 1 },
        field,
        kind: "buildings",
        words,
        dots: [],
        places: [],
      }),
    ).rejects.toThrow(/2D canvas/);
    expect(close).toHaveBeenCalled();
  });
});
