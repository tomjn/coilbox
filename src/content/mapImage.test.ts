import { describe, expect, it } from "vitest";
import { contrast, type Rgb } from "@/lib/contrast.testhelper";
import { HEAT_RAMPS } from "@/lib/heatRamp";
import { WHOLE } from "./mapAggregate";
import type { MapExportInfo } from "./mapAggregateExport";
import {
  type Draw2D,
  drawMapImage,
  fitText,
  IMAGE_COLOURS,
  type ImageWords,
  imageBlocks,
  layoutImage,
  MAX_MAP_SIDE,
  MIN_IMAGE_WIDTH,
  MINIMAP_DIM_ALPHA,
  mapPixelSize,
  wrapText,
} from "./mapImage";

/** Every character is 10 wide, in any font. */
const TEN = (text: string) => text.length * 10;

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const info: MapExportInfo = {
  mapName: "Tabula 2.1",
  mapVersions: ["Tabula 2.1", "Tabula v2.0"],
  gameVersions: ["Game A 1.0"],
  matches: 5,
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
  worldHeight: 8192,
  exportedUtc: "2026-10-10T12:34:56.000Z",
};

const words: ImageWords = {
  info,
  layer: "buildings",
  layerSentence: "Where buildings were ordered",
  legend:
    "on average 12% of a match's orders to place a building within 256 elmos of one spot, across 4 matches",
  normalise: "share",
  window: WHOLE,
  contributing: 4,
  events: 172,
  appVersion: "1.2.3",
  marks: true,
};

describe("mapPixelSize", () => {
  it("is the minimap's own size for a square map, never enlarged", () => {
    expect(
      mapPixelSize(
        { worldWidth: 8192, worldHeight: 8192 },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 1024, height: 1024 });
    expect(
      mapPixelSize(
        { worldWidth: 8192, worldHeight: 8192 },
        { width: 256, height: 256 },
      ),
    ).toEqual({ width: 256, height: 256 });
  });

  it("follows a wide map's shape on the shorter side", () => {
    expect(
      mapPixelSize(
        { worldWidth: 8192, worldHeight: 4096 },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 1024, height: 512 });
  });

  it("follows a tall map's shape on the shorter side", () => {
    expect(
      mapPixelSize(
        { worldWidth: 6144, worldHeight: 10240 },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 614, height: 1024 });
  });

  it("stops at the stated maximum", () => {
    expect(
      mapPixelSize(
        { worldWidth: 1, worldHeight: 1 },
        { width: 8192, height: 8192 },
      ),
    ).toEqual({ width: MAX_MAP_SIDE, height: MAX_MAP_SIDE });
  });

  it("falls back to a square for a map with no size", () => {
    expect(
      mapPixelSize(
        { worldWidth: 0, worldHeight: 0 },
        { width: 1024, height: 1024 },
      ),
    ).toEqual({ width: 1024, height: 1024 });
  });
});

describe("wrapText", () => {
  it("wraps at the width and keeps words whole", () => {
    expect(wrapText("aaa bbb ccc ddd", 70, TEN)).toEqual([
      "aaa bbb",
      "ccc ddd",
    ]);
  });

  it("never returns a line wider than the width", () => {
    const text = "one; two three; four five six seven; eight";
    for (const line of wrapText(text, 120, TEN))
      expect(TEN(line)).toBeLessThanOrEqual(120);
  });

  it("cuts a word that is wider than a line between letters", () => {
    const lines = wrapText("abcdefghijklmnop", 50, TEN);
    expect(lines).toEqual(["abcde", "fghij", "klmno", "p"]);
  });

  it("carries on from the rest of a cut word and wraps the next word", () => {
    expect(wrapText("abcdefgh xy", 50, TEN)).toEqual(["abcde", "fgh", "xy"]);
  });

  it("returns nothing for empty text and collapses runs of spaces", () => {
    expect(wrapText("", 50, TEN)).toEqual([]);
    expect(wrapText("a   b", 50, TEN)).toEqual(["a b"]);
  });
});

describe("fitText", () => {
  it("leaves text that fits", () => {
    expect(fitText("Front", 100, TEN)).toBe("Front");
  });

  it("cuts to the width with an ellipsis", () => {
    const got = fitText("A very long position name", 100, TEN);
    expect(got.endsWith("…")).toBe(true);
    expect(TEN(got)).toBeLessThanOrEqual(100);
  });
});

describe("imageBlocks", () => {
  const text = imageBlocks(words).map((b) => b.text);

  it("leads with the map's name and the layer", () => {
    expect(text[0]).toBe("Tabula 2.1");
    expect(text[1]).toBe("Building density. Where buildings were ordered.");
  });

  it("states the replays, the window, the scaling, the versions and the filters", () => {
    expect(text).toContain(
      "Replays: 5 matches of this map. 4 have something on this layer, 172 orders to place a building.",
    );
    expect(text).toContain("Time window: the whole match.");
    expect(text).toContain("Scaling: Share of each match.");
    expect(text).toContain("Map versions: Tabula 2.1; Tabula v2.0.");
    expect(text).toContain("Game and version: Game A 1.0.");
    expect(text).toContain(
      "Filters: any number of players, any sides, analysed or not, matches under a minute left out.",
    );
  });

  it("says what the brightest spot holds", () => {
    expect(text[2]).toBe(`Brightest spot: ${words.legend}.`);
  });

  it("ends with the app and the day, which says which library it was made from", () => {
    expect(text[text.length - 1]).toContain(
      "Made with coilbox 1.2.3 on 2026-10-10.",
    );
  });

  it("names a window by its minutes and every filter that is set", () => {
    const got = imageBlocks({
      ...words,
      window: { kind: "range", from: 5, to: 10 },
      appVersion: null,
      marks: false,
      contributing: 1,
      info: {
        ...info,
        filters: {
          players: "4 players",
          sides: "Free for all",
          analysed: "analysed",
          playedFrom: "2026-01-01",
          playedUntil: "2026-02-01",
          replaySet: "Cup",
          includesShort: true,
        },
      },
    }).map((b) => b.text);
    expect(got).toContain(
      "Time window: minutes 5 to 10 of each match, by its own clock.",
    );
    expect(
      got.some((t) =>
        t.includes("172 orders to place a building in minutes 5 to 10."),
      ),
    ).toBe(true);
    expect(got).toContain(
      "Filters: 4 players, Free for all, analysed, played from 2026-01-01, played until 2026-02-01, replay set Cup, matches under a minute included.",
    );
    expect(got[got.length - 1]).toBe(
      "Colours compare places on this map with each other, not with another picture. Made with coilbox on 2026-10-10.",
    );
    expect(got.some((t) => t.startsWith("White dots"))).toBe(false);
  });
});

describe("layoutImage", () => {
  const blocks = imageBlocks(words);

  it("puts a square map at the top of a panel of the same width", () => {
    const layout = layoutImage({ width: 1024, height: 1024 }, blocks, TEN);
    expect(layout.width).toBe(1024);
    expect(layout.map).toEqual({ x: 0, y: 0, w: 1024, h: 1024 });
    expect(layout.panel).toEqual({
      x: 0,
      y: 1024,
      w: 1024,
      h: layout.height - 1024,
    });
    expect(layout.markScale).toBeCloseTo(1024 / 384, 6);
  });

  it("centres a narrow map on a panel of the least width", () => {
    const layout = layoutImage({ width: 614, height: 1024 }, blocks, TEN);
    expect(layout.width).toBe(MIN_IMAGE_WIDTH);
    expect(layout.map).toEqual({ x: 53, y: 0, w: 614, h: 1024 });
    expect(layout.panel.w).toBe(MIN_IMAGE_WIDTH);
  });

  it("keeps a wide map's own height", () => {
    const layout = layoutImage({ width: 1024, height: 512 }, blocks, TEN);
    expect(layout.map.h).toBe(512);
    expect(layout.panel.y).toBe(512);
  });

  it("keeps every line inside the image and under the map", () => {
    for (const size of [
      { width: 1024, height: 1024 },
      { width: 614, height: 1024 },
      { width: 1024, height: 512 },
    ]) {
      const layout = layoutImage(size, blocks, TEN);
      for (const line of layout.lines) {
        const width = TEN(line.text);
        expect(line.x).toBeGreaterThanOrEqual(0);
        expect(line.x + width).toBeLessThanOrEqual(layout.width);
        expect(line.y).toBeGreaterThan(size.height);
        expect(line.y).toBeLessThanOrEqual(layout.height);
      }
      expect(layout.bar.x + layout.bar.w).toBeLessThanOrEqual(layout.width);
      expect(layout.bar.y).toBeGreaterThanOrEqual(size.height);
    }
  });

  it("wraps a long list of versions into lines that fit", () => {
    const many = {
      ...words,
      info: {
        ...info,
        mapVersions: Array.from({ length: 40 }, (_, i) => `Tabula v2.${i}`),
      },
    };
    const layout = layoutImage(
      { width: 1024, height: 1024 },
      imageBlocks(many),
      TEN,
    );
    const versions = layout.lines.filter((l) => l.text.includes("Tabula v2."));
    expect(versions.length).toBeGreaterThan(1);
    for (const line of layout.lines)
      expect(line.x + TEN(line.text)).toBeLessThanOrEqual(layout.width);
    expect(
      versions
        .map((l) => l.text)
        .join(" ")
        .replace(/\s+/g, " "),
    ).toContain("Tabula v2.39.");
  });

  it("reads in order: the title, the layer, the ramp's words, then the rest", () => {
    const layout = layoutImage({ width: 1024, height: 1024 }, blocks, TEN);
    const order = layout.lines.map((l) => l.text);
    expect(order.slice(0, 4)).toEqual([
      "Tabula 2.1",
      expect.stringMatching(/^Building density/),
      "Least",
      "Most",
    ]);
    const ys = layout.lines.map((l) => l.y);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it("scales the type with the image's width", () => {
    const small = layoutImage({ width: 1024, height: 1024 }, blocks, TEN);
    const big = layoutImage({ width: 2048, height: 2048 }, blocks, TEN);
    expect(small.lines[0].font).toMatch(/^bold 30px /);
    expect(big.lines[0].font).toMatch(/^bold 60px /);
  });
});

describe("the colours", () => {
  it("make every kind of text readable on the panel, at AAA", () => {
    const panel = hex(IMAGE_COLOURS.panel);
    for (const ink of [
      IMAGE_COLOURS.title,
      IMAGE_COLOURS.body,
      IMAGE_COLOURS.small,
    ])
      expect(contrast(hex(ink), panel)).toBeGreaterThanOrEqual(7);
  });

  it("make a position's number readable on its circle", () => {
    expect(
      contrast(hex(IMAGE_COLOURS.markText), hex(IMAGE_COLOURS.markFill)),
    ).toBeGreaterThanOrEqual(7);
  });

  it("make a name readable on its label over the darkest and the lightest map", () => {
    // The label is black at 0.7 over the map. Over white that is 30% grey.
    const overWhite = 255 * 0.3;
    const label: Rgb = [overWhite / 255, overWhite / 255, overWhite / 255];
    expect(
      contrast(hex(IMAGE_COLOURS.labelText), label),
    ).toBeGreaterThanOrEqual(7);
  });
});

/** A 2D context that records what it was asked to do. */
function recorder() {
  const calls: unknown[][] = [];
  const style: Record<string, unknown> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = new Proxy(
    {
      measureText: (text: string) => ({ width: TEN(text) }),
      createLinearGradient: (...args: unknown[]) => {
        calls.push(["createLinearGradient", ...args]);
        return {
          addColorStop: (...stop: unknown[]) =>
            calls.push(["addColorStop", ...stop]),
        };
      },
    } as Record<string | symbol, unknown>,
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key in style) return style[key as string];
        return record(String(key));
      },
      set(_, key, value) {
        style[key as string] = value;
        calls.push(["set", String(key), value]);
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as Draw2D, calls };
}

describe("drawMapImage", () => {
  const layout = layoutImage(
    { width: 800, height: 800 },
    [
      { role: "title", text: "Map" },
      { role: "layer", text: "Layer." },
      { role: "body", text: "Words." },
    ],
    TEN,
  );
  const minimap = { tag: "minimap" } as unknown as CanvasImageSource;
  const field = { tag: "field" } as unknown as CanvasImageSource;

  it("draws the panel, the map, its dimming, then the field, in that order", () => {
    const { ctx, calls } = recorder();
    drawMapImage(ctx, layout, {
      minimap,
      field,
      kind: "buildings",
      dots: [],
      places: [],
    });
    const named = calls.filter(
      (c) => c[0] === "fillRect" || c[0] === "drawImage",
    );
    expect(named[0]).toEqual(["fillRect", 0, 0, layout.width, layout.height]);
    expect(named[1]).toEqual(["drawImage", minimap, 0, 0, 800, 800]);
    expect(named[2]).toEqual(["fillRect", 0, 0, 800, 800]);
    expect(named[3]).toEqual(["drawImage", field, 0, 0, 800, 800]);
    const fills = calls.filter((c) => c[0] === "set" && c[1] === "fillStyle");
    expect(fills[0][2]).toBe(IMAGE_COLOURS.panel);
    expect(fills[1][2]).toBe(`rgba(0, 0, 0, ${MINIMAP_DIM_ALPHA})`);
  });

  it("draws a plain backdrop when the map has no minimap", () => {
    const { ctx, calls } = recorder();
    drawMapImage(ctx, layout, {
      minimap: null,
      field,
      kind: "buildings",
      dots: [],
      places: [],
    });
    expect(calls.some((c) => c[0] === "drawImage" && c[1] === minimap)).toBe(
      false,
    );
    expect(
      calls.some((c) => c[0] === "set" && c[2] === IMAGE_COLOURS.mapBackdrop),
    ).toBe(true);
  });

  it("puts a dot and a numbered circle where their fractions say", () => {
    const { ctx, calls } = recorder();
    drawMapImage(ctx, layout, {
      minimap,
      field,
      kind: "buildings",
      dots: [{ left: 0.25, top: 0.5 }],
      places: [{ left: 0.5, top: 0.75, n: 3, name: null }],
    });
    const arcs = calls.filter((c) => c[0] === "arc");
    expect(arcs[0].slice(1, 3)).toEqual([200, 400]);
    expect(arcs[1].slice(1, 3)).toEqual([400, 600]);
    const numbers = calls.filter((c) => c[0] === "fillText" && c[1] === "3");
    expect(numbers).toEqual([["fillText", "3", 400, 600]]);
  });

  it("puts a name to the left of a circle that is near the map's right edge", () => {
    const { ctx, calls } = recorder();
    drawMapImage(ctx, layout, {
      minimap,
      field,
      kind: "buildings",
      dots: [],
      places: [
        { left: 0.1, top: 0.2, n: 1, name: "Front" },
        { left: 0.95, top: 0.6, n: 2, name: "Back" },
      ],
    });
    const names = calls.filter(
      (c) => c[0] === "fillText" && (c[1] === "Front" || c[1] === "Back"),
    );
    const front = names.find((c) => c[1] === "Front");
    const back = names.find((c) => c[1] === "Back");
    // The first starts right of its circle, the second ends left of its own.
    expect(front?.[2] as number).toBeGreaterThan(80);
    expect(back?.[2] as number).toBeLessThan(760);
  });

  it("draws the ramp's bar from the page's stops and then every line of text", () => {
    const { ctx, calls } = recorder();
    drawMapImage(ctx, layout, {
      minimap,
      field,
      kind: "buildings",
      dots: [],
      places: [],
    });
    expect(calls.filter((c) => c[0] === "addColorStop")).toHaveLength(
      HEAT_RAMPS.buildings.length,
    );
    expect(calls.find((c) => c[0] === "addColorStop")?.[2]).toBe(
      "rgba(85, 30, 166, 0.30)",
    );
    const text = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
    expect(text).toEqual(layout.lines.map((l) => l.text));
    const last = calls[calls.length - 1];
    expect(last[0]).toBe("fillText");
  });
});
