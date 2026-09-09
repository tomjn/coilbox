import { describe, expect, it } from "vitest";
import { GRID, MIN_BOX, type StartRect } from "./geometry";
import {
  nextSlotStart,
  PRESETS,
  presetBoxes,
  rotateBoxes,
  rotateOrder,
  sizeToGrid,
  slotWindow,
} from "./presets";

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

  it("offers the other 2-corner diagonal, NE and SW", () => {
    expect(presetBoxes("corners2alt", 20)).toEqual([
      { left: 160, top: 0, right: GRID, bottom: 40 },
      { left: 0, top: 160, right: 40, bottom: GRID },
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

  it("both 2-corner diagonals cover the same four corners between them", () => {
    const pair = [
      ...presetBoxes("corners2", 20),
      ...presetBoxes("corners2alt", 20),
    ];
    const four = presetBoxes("corners4", 20);
    const key = (b: { left: number; top: number }) => `${b.left},${b.top}`;
    expect(new Set(pair.map(key))).toEqual(new Set(four.map(key)));
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

describe("rotateBoxes", () => {
  const a = { left: 0, top: 0, right: 40, bottom: 40 };
  const b = { left: 160, top: 160, right: 200, bottom: 200 };
  const c = { left: 160, top: 0, right: 200, bottom: 40 };

  it("swaps the two boxes when two allies hold one", () => {
    expect(rotateBoxes({ "0": a, "1": b }, [0, 1])).toEqual({
      "0": b,
      "1": a,
    });
  });

  it("cycles each box on to the next holder when there are more than two", () => {
    expect(rotateBoxes({ "0": a, "1": b, "2": c }, [0, 1, 2])).toEqual({
      "0": c,
      "1": a,
      "2": b,
    });
  });

  it("skips allies with no box rather than handing them one", () => {
    expect(rotateBoxes({ "0": a, "2": b }, [0, 1, 2])).toEqual({
      "0": b,
      "2": a,
    });
  });

  it("is a no-op below two boxes", () => {
    const one = { "0": a };
    expect(rotateBoxes(one, [0, 1])).toBe(one);
    expect(rotateBoxes({}, [0, 1])).toEqual({});
  });

  it("rotating as many times as there are boxes returns the original", () => {
    const start: Record<string, StartRect> = { "0": a, "1": b, "2": c };
    let out = start;
    for (let i = 0; i < 3; i++) out = rotateBoxes(out, [0, 1, 2]);
    expect(out).toEqual(start);
  });
});

describe("slotWindow", () => {
  it("takes the first slots when the roster fills the preset", () => {
    expect(slotWindow(2, 2, 0)).toEqual([0, 1]);
    expect(slotWindow(4, 4, 0)).toEqual([0, 1, 2, 3]);
  });

  it("takes only as many slots as there are allies", () => {
    expect(slotWindow(4, 2, 0)).toEqual([0, 1]);
  });

  it("moves the window along, so the spare slots are reachable", () => {
    // "4 sides" with two allies: west/east, then north/south.
    expect(slotWindow(4, 2, 2)).toEqual([2, 3]);
  });

  it("wraps rather than running off the end", () => {
    expect(slotWindow(4, 2, 3)).toEqual([3, 0]);
    expect(slotWindow(4, 3, 3)).toEqual([3, 0, 1]);
  });

  it("gives out no more boxes than the preset holds", () => {
    expect(slotWindow(2, 5, 0)).toEqual([0, 1]);
  });

  it("has nothing to give an empty roster", () => {
    expect(slotWindow(4, 0, 0)).toEqual([]);
  });
});

describe("nextSlotStart", () => {
  it("advances by a whole roster so the next click is the next set", () => {
    expect(nextSlotStart(4, 2, 0)).toBe(2);
    expect(nextSlotStart(4, 2, 2)).toBe(0);
  });

  it("stays put when the roster fills the preset, so re-applying repeats it", () => {
    expect(nextSlotStart(2, 2, 0)).toBe(0);
    expect(nextSlotStart(2, 4, 0)).toBe(0);
  });

  it("cycles every slot into play when the roster does not divide evenly", () => {
    const seen = new Set<number>();
    let start = 0;
    for (let i = 0; i < 4; i++) {
      for (const slot of slotWindow(4, 3, start)) seen.add(slot);
      start = nextSlotStart(4, 3, start);
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("rotateOrder", () => {
  it("moves the order one step left", () => {
    expect(rotateOrder([0, 1])).toEqual([1, 0]);
    expect(rotateOrder([0, 1, 2])).toEqual([1, 2, 0]);
  });

  it("leaves a list too short to rotate alone", () => {
    expect(rotateOrder([3])).toEqual([3]);
    expect(rotateOrder([])).toEqual([]);
  });

  it("matches rotateBoxes, so a swap does not fight the next preset", () => {
    // Applying a preset under the rotated order must reproduce exactly what
    // rotating the live boxes drew. Without this the swap button and the preset
    // tiles disagree, and the next apply silently undoes the swap.
    for (const allies of [
      [0, 1],
      [0, 1, 2],
      [1, 4, 7, 9],
    ]) {
      const slots = presetBoxes("sides4", 30).slice(0, allies.length);
      const applied: Record<string, StartRect> = {};
      allies.forEach((ally, i) => {
        applied[String(ally)] = slots[i];
      });

      const swapped = rotateBoxes(applied, allies);

      const reapplied: Record<string, StartRect> = {};
      rotateOrder(allies).forEach((ally, i) => {
        reapplied[String(ally)] = slots[i];
      });

      expect(reapplied).toEqual(swapped);
    }
  });
});
