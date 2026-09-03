// @vitest-environment happy-dom
/**
 * What this proves: the panorama never shows more than two copies of the art at
 * once (issue #2380, where a full-bleed briefing tiled the same picture roughly
 * six times), that art already wide enough is left exactly as it was, and that
 * the loop distance always equals the width the art is actually drawn at, which
 * is what keeps the scroll wrap seamless.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanoramaScroller, panoramaTileWidth } from "./PanoramaScroller";

vi.mock("../../panorama", () => ({
  useCampaignImage: () => "blob:panorama",
}));
vi.mock("../../../general/display", () => ({
  useReduceMotion: () => false,
  useEffectsEnabled: () => true,
}));

/** The element size the component measures itself against, per test. */
let box = { width: 0, height: 0 };
/** The source image's pixel size, which gives the aspect ratio. */
let art = { width: 0, height: 0 };

/** happy-dom's ResizeObserver is a stub that never calls back, and the component
 *  only measures on that callback or on image load. This one fires once, so the
 *  measured size is whatever `box` holds. */
class FiringResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

/** An Image whose load lands synchronously when `src` is assigned, so the
 *  measurement has run by the time render() returns. */
class InstantImage {
  onload: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_value: string) {
    this.naturalWidth = art.width;
    this.naturalHeight = art.height;
    this.onload?.();
  }
}

beforeEach(() => {
  for (const [prop, read] of [
    ["clientWidth", () => box.width],
    ["clientHeight", () => box.height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get: read,
    });
  }
  vi.stubGlobal("ResizeObserver", FiringResizeObserver);
  vi.stubGlobal("Image", InstantImage);
  window.Image = InstantImage as unknown as typeof window.Image;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the scroller and read back the two properties the CSS uses. */
function measure(element: { width: number; height: number }, fill = false) {
  box = element;
  const { container } = render(
    <PanoramaScroller
      fill={fill}
      campaignId="c1"
      panorama={{ kind: "file", file: "art.jpg" }}
    />,
  );
  const el = container.querySelector(".campaign-panorama") as HTMLElement;
  return {
    tile: Number.parseFloat(el.style.getPropertyValue("--panorama-tile")),
    size: el.style.getPropertyValue("--panorama-size"),
    duration: el.style.getPropertyValue("--panorama-duration"),
  };
}

describe("panoramaTileWidth", () => {
  it("draws the whole picture when it is wide enough to", () => {
    // 3.125:1 art in an 820px-tall backdrop is 2562px wide on its own, well over
    // half the window, so nothing is cropped.
    expect(panoramaTileWidth(3.125, 1512, 820)).toBeCloseTo(2562.5);
  });

  it("still draws the whole picture at exactly two copies", () => {
    expect(panoramaTileWidth(2, 1000, 250)).toBe(500);
  });

  it("widens the art rather than repeat it a third time", () => {
    // The same art in an 80px card strip is only 250px wide, five copies across.
    expect(panoramaTileWidth(3.125, 1252, 80)).toBe(626);
  });

  it("has nothing to measure before the element or the art has a size", () => {
    expect(panoramaTileWidth(0, 1512, 820)).toBe(0);
    expect(panoramaTileWidth(3.125, 1512, 0)).toBe(0);
  });

  it("falls back to the whole picture when the element has no width yet", () => {
    expect(panoramaTileWidth(3.125, 0, 80)).toBe(250);
  });
});

describe("PanoramaScroller", () => {
  it("leaves a wide backdrop alone", () => {
    art = { width: 3750, height: 1200 };
    expect(measure({ width: 1512, height: 820 }, true).tile).toBeCloseTo(
      2562.5,
    );
  });

  it("caps a tall panorama at two copies of the art", () => {
    art = { width: 400, height: 1200 };
    const { tile, size } = measure({ width: 1512, height: 820 }, true);
    // 273px on its own, five and a half copies across the window.
    expect(tile).toBe(756);
    expect(size).toBe("756px auto");
  });

  it("caps the short mission card strip too", () => {
    art = { width: 3750, height: 1200 };
    expect(measure({ width: 1252, height: 80 }).tile).toBe(626);
  });

  it("scrolls exactly one drawn tile per loop", () => {
    art = { width: 400, height: 1200 };
    const { tile, size } = measure({ width: 1512, height: 820 }, true);
    // The seam depends on this: the keyframes shift the background by
    // --panorama-tile, so it has to match the width in --panorama-size exactly.
    expect(size).toBe(`${tile}px auto`);
  });

  it("holds the scroll speed steady as the tile grows", () => {
    art = { width: 3750, height: 1200 };
    // 626px at 25px/s.
    expect(measure({ width: 1252, height: 80 }).duration).toBe("25.04s");
  });
});
