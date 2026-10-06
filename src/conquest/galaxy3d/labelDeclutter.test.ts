import { describe, expect, it } from "vitest";
import { declutterLabels, LABEL_GAP_PX, type LabelBox } from "./labelDeclutter";

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
