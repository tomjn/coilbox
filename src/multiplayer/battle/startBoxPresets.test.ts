import { describe, expect, it } from "vitest";
import { GRID, MIN_BOX } from "./startBoxGeometry";
import { PRESETS, presetBoxes, sizeToGrid } from "./startBoxPresets";

describe("startBoxPresets", () => {
  it("converts a size percentage to a grid depth, clamped to sane bounds", () => {
    expect(sizeToGrid(30)).toBe(60); // 30% of 200
    expect(sizeToGrid(50)).toBe(100);
    // Below MIN_BOX or above half the map clamps rather than degenerating.
    expect(sizeToGrid(0)).toBe(MIN_BOX);
    expect(sizeToGrid(90)).toBe(100);
  });

  it("vertical split: full-height west and east stripes", () => {
    expect(presetBoxes("vertical", 30)).toEqual([
      { left: 0, top: 0, right: 60, bottom: GRID },
      { left: 140, top: 0, right: GRID, bottom: GRID },
    ]);
  });

  it("horizontal split: full-width north and south stripes", () => {
    expect(presetBoxes("horizontal", 25)).toEqual([
      { left: 0, top: 0, right: GRID, bottom: 50 },
      { left: 0, top: 150, right: GRID, bottom: GRID },
    ]);
  });

  it("2-corner diagonal: opposed NW and SE squares", () => {
    expect(presetBoxes("corners2", 20)).toEqual([
      { left: 0, top: 0, right: 40, bottom: 40 },
      { left: 160, top: 160, right: GRID, bottom: GRID },
    ]);
  });

  it("4 corners: diagonally-opposed pairs first so 2 allies face off", () => {
    const [nw, se, ne, sw] = presetBoxes("corners4", 20);
    expect(nw).toEqual({ left: 0, top: 0, right: 40, bottom: 40 });
    expect(se).toEqual({ left: 160, top: 160, right: GRID, bottom: GRID });
    expect(ne).toEqual({ left: 160, top: 0, right: GRID, bottom: 40 });
    expect(sw).toEqual({ left: 0, top: 160, right: 40, bottom: GRID });
  });

  it("4 sides: edge-centred squares, opposed pairs first", () => {
    const [west, east, north, south] = presetBoxes("sides4", 20);
    expect(west).toEqual({ left: 0, top: 80, right: 40, bottom: 120 });
    expect(east).toEqual({ left: 160, top: 80, right: GRID, bottom: 120 });
    expect(north).toEqual({ left: 80, top: 0, right: 120, bottom: 40 });
    expect(south).toEqual({ left: 80, top: 160, right: 120, bottom: GRID });
  });

  it("every preset at every slider extreme yields valid non-overlapping rects", () => {
    for (const p of PRESETS) {
      for (const pct of [10, 50]) {
        const boxes = presetBoxes(p.kind, pct);
        expect(boxes).toHaveLength(p.slots);
        for (const b of boxes) {
          expect(b.right - b.left).toBeGreaterThanOrEqual(MIN_BOX);
          expect(b.bottom - b.top).toBeGreaterThanOrEqual(MIN_BOX);
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.top).toBeGreaterThanOrEqual(0);
          expect(b.right).toBeLessThanOrEqual(GRID);
          expect(b.bottom).toBeLessThanOrEqual(GRID);
          expect(Number.isInteger(b.left) && Number.isInteger(b.top)).toBe(
            true,
          );
          expect(Number.isInteger(b.right) && Number.isInteger(b.bottom)).toBe(
            true,
          );
        }
        // No two boxes overlap (they may touch at 50%).
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const overlaps =
              a.left < b.right &&
              b.left < a.right &&
              a.top < b.bottom &&
              b.top < a.bottom;
            expect(overlaps).toBe(false);
          }
        }
      }
    }
  });
});
