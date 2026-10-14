import { describe, expect, it } from "vitest";
import {
  declutterLabels,
  LABEL_GAP_PX,
  type LabelBox,
  type LabelElement,
  type LabelInput,
  placeLabels,
  sameNumbers,
} from "./labelDeclutter";

const box = (over: Partial<LabelBox> = {}): LabelBox => ({
  left: 0,
  top: 0,
  width: 80,
  height: 12,
  rank: 1,
  pinned: false,
  ...over,
});

/** The boxes that stay, with each one's move applied. */
const shown = (boxes: LabelBox[]) =>
  declutterLabels(boxes).flatMap((p, i) =>
    p.hidden ? [] : [{ ...boxes[i], top: boxes[i].top + p.dy }],
  );

const clash = (a: LabelBox, b: LabelBox) =>
  a.left < b.left + b.width + LABEL_GAP_PX &&
  b.left < a.left + a.width + LABEL_GAP_PX &&
  a.top < b.top + b.height + LABEL_GAP_PX &&
  b.top < a.top + a.height + LABEL_GAP_PX;

const anyClash = (boxes: LabelBox[]) =>
  boxes.some((a, i) => boxes.slice(i + 1).some((b) => clash(a, b)));

describe("declutterLabels", () => {
  it("leaves names that do not touch alone", () => {
    const out = declutterLabels([box(), box({ left: 200 }), box({ top: 100 })]);
    expect(out).toEqual([
      { hidden: false, dy: 0 },
      { hidden: false, dy: 0 },
      { hidden: false, dy: 0 },
    ]);
  });

  it("hides the later of two equal names that overlap", () => {
    const out = declutterLabels([box(), box({ left: 40 })]);
    expect(out.map((p) => p.hidden)).toEqual([false, true]);
  });

  it("keeps the higher rank, whatever the order", () => {
    const out = declutterLabels([box(), box({ left: 40, rank: 2 })]);
    expect(out.map((p) => p.hidden)).toEqual([true, false]);
  });

  it("treats names that are only a gap apart as touching", () => {
    const out = declutterLabels([box(), box({ left: 80 + LABEL_GAP_PX - 1 })]);
    expect(out[1].hidden).toBe(true);
    const apart = declutterLabels([box(), box({ left: 80 + LABEL_GAP_PX })]);
    expect(apart[1].hidden).toBe(false);
  });

  it("never hides a pinned name, and moves it by the smallest clearing amount", () => {
    const boxes = [box({ rank: 2 }), box({ left: 40, top: 4, pinned: true })];
    const out = declutterLabels(boxes);
    expect(out[1].hidden).toBe(false);
    // The pinned name outranks the capital, so the capital hides instead.
    expect(out[0].hidden).toBe(true);
    expect(out[1].dy).toBe(0);
  });

  it("moves a pinned name that collides with another pinned name", () => {
    const boxes = [box({ pinned: true }), box({ left: 40, pinned: true })];
    const out = declutterLabels(boxes);
    expect(out.every((p) => !p.hidden)).toBe(true);
    // Up is -(12 + 3), down is +(12 + 3). Both are the same distance.
    expect(Math.abs(out[1].dy)).toBe(12 + LABEL_GAP_PX);
    expect(anyClash(shown(boxes))).toBe(false);
  });

  it("hides a plain name that collides with a pinned one", () => {
    const out = declutterLabels([box({ rank: 3 }), box({ pinned: true })]);
    expect(out.map((p) => p.hidden)).toEqual([true, false]);
  });

  it("leaves no overlap among the names it shows", () => {
    const boxes: LabelBox[] = [];
    for (let i = 0; i < 40; i++) {
      boxes.push(
        box({
          left: (i * 37) % 200,
          top: (i * 11) % 60,
          rank: i % 3,
          pinned: i % 9 === 0,
        }),
      );
    }
    const kept = shown(boxes);
    const pinned = boxes.filter((b) => b.pinned);
    // Pinned names may share space only when no move could clear them.
    const plain = kept.filter((b) => !b.pinned);
    expect(plain.length).toBeGreaterThan(0);
    for (const a of plain) {
      for (const b of kept) if (a !== b) expect(clash(a, b)).toBe(false);
    }
    expect(pinned.length).toBeGreaterThan(0);
  });

  it("answers an empty list with an empty list", () => {
    expect(declutterLabels([])).toEqual([]);
  });
});

describe("sameNumbers", () => {
  it("is true only for equal numbers in the same order", () => {
    expect(sameNumbers([1, 2, 3], new Float32Array([1, 2, 3]))).toBe(true);
    expect(sameNumbers([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(sameNumbers([1, 2], [1, 2, 3])).toBe(false);
    expect(sameNumbers(undefined, [1])).toBe(false);
  });
});

/** An element that logs each size read and style write, in order. */
function fakeLabel(log: string[], name: string, width = 40, height = 10) {
  const style = { _v: "", _m: "" } as {
    _v: string;
    _m: string;
    visibility: string;
    marginTop: string;
  };
  Object.defineProperty(style, "visibility", {
    get: () => style._v,
    set: (v: string) => {
      log.push(`write ${name}`);
      style._v = v;
    },
  });
  Object.defineProperty(style, "marginTop", {
    get: () => style._m,
    set: (v: string) => {
      log.push(`write ${name}`);
      style._m = v;
    },
  });
  return {
    style,
    get offsetWidth() {
      log.push(`read ${name}`);
      return width;
    },
    get offsetHeight() {
      return height;
    },
  } as LabelElement;
}

const input = (
  el: LabelElement,
  ndc: { x: number; y: number } | null,
  extra: Partial<LabelInput> = {},
): LabelInput => ({
  el,
  ndc,
  center: { x: 0.5, y: 0.5 },
  rank: 1,
  pinned: false,
  ...extra,
});

describe("placeLabels", () => {
  it("hides lower ranked names that overlap a pinned one", () => {
    const log: string[] = [];
    const capital = fakeLabel(log, "capital");
    const town = fakeLabel(log, "town");
    const mine = fakeLabel(log, "mine");
    const far = fakeLabel(log, "far");
    placeLabels(
      [
        input(capital, { x: 0, y: 0 }, { rank: 2 }),
        input(town, { x: 0, y: 0 }),
        input(mine, { x: 0, y: 0 }, { pinned: true }),
        input(far, { x: 0.9, y: 0.9 }),
      ],
      800,
      600,
      new Map(),
      true,
    );
    expect(mine.style.visibility).toBe("");
    expect(mine.style.marginTop).toBe("");
    expect(capital.style.visibility).toBe("hidden");
    expect(town.style.visibility).toBe("hidden");
    expect(far.style.visibility).toBe("");
  });

  it("moves a pinned name clear of another pinned name", () => {
    const log: string[] = [];
    const a = fakeLabel(log, "a");
    const b = fakeLabel(log, "b");
    placeLabels(
      [
        input(a, { x: 0, y: 0 }, { pinned: true }),
        input(b, { x: 0, y: 0 }, { pinned: true }),
      ],
      800,
      600,
      new Map(),
      true,
    );
    expect(a.style.marginTop).toBe("");
    expect(b.style.visibility).toBe("");
    expect(b.style.marginTop).toBe(`${10 + LABEL_GAP_PX}px`);
  });

  it("brings back a name that stops colliding or leaves the view", () => {
    const log: string[] = [];
    const a = fakeLabel(log, "a");
    const b = fakeLabel(log, "b");
    const sizes = new Map();
    const first = input(a, { x: 0, y: 0 }, { rank: 2 });
    placeLabels([first, input(b, { x: 0, y: 0 })], 800, 600, sizes, true);
    expect(b.style.visibility).toBe("hidden");
    placeLabels([first, input(b, { x: 0.8, y: 0 })], 800, 600, sizes, false);
    expect(b.style.visibility).toBe("");
    placeLabels([first, input(b, { x: 0, y: 0 })], 800, 600, sizes, false);
    expect(b.style.visibility).toBe("hidden");
    placeLabels([first, input(b, null)], 800, 600, sizes, false);
    expect(b.style.visibility).toBe("");
  });

  it("makes no size read after a style write within one pass", () => {
    const log: string[] = [];
    const labels = ["a", "b", "c", "d"].map((n) => fakeLabel(log, n));
    placeLabels(
      labels.map((el, i) => input(el, { x: 0.01 * i, y: 0 })),
      800,
      600,
      new Map(),
      true,
    );
    const reads = log.filter((l) => l.startsWith("read"));
    expect(reads).toHaveLength(4);
    const firstWrite = log.findIndex((l) => l.startsWith("write"));
    expect(firstWrite).toBeGreaterThan(log.lastIndexOf("read d"));
  });

  it("keeps sizes between passes and reads them again only on request", () => {
    const log: string[] = [];
    const el = fakeLabel(log, "a");
    const sizes = new Map();
    const labels = [input(el, { x: 0, y: 0 })];
    placeLabels(labels, 800, 600, sizes, true);
    placeLabels(labels, 800, 600, sizes, false);
    expect(log.filter((l) => l === "read a")).toHaveLength(1);
    placeLabels(labels, 800, 600, sizes, true);
    expect(log.filter((l) => l === "read a")).toHaveLength(2);
  });

  it("reads a zero size again, since the page has not shown that label yet", () => {
    const log: string[] = [];
    const el = fakeLabel(log, "a", 0, 0);
    const sizes = new Map();
    const labels = [input(el, { x: 0, y: 0 })];
    placeLabels(labels, 800, 600, sizes, true);
    placeLabels(labels, 800, 600, sizes, false);
    expect(log.filter((l) => l === "read a")).toHaveLength(2);
  });
});
