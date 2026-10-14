/**
 * Keeping place names readable on a terrain map (issue #3685).
 *
 * The names are DOM labels at a fixed size, so two towns that sit close on
 * screen put their names on top of each other. This works out, from the
 * labels' boxes in screen pixels, which names stay, which hide and which move.
 *
 * Pure: boxes in, placements out. The view runs it when the camera or the
 * labels change, never on every frame.
 */

/** One label's box on screen, in pixels, `top` growing downwards. */
export interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Higher stays when two names collide. A capital outranks a town. */
  rank: number;
  /** The name of a selected, hovered or player-owned place. It is never hidden,
   *  and when it collides with another pinned name it moves instead. */
  pinned: boolean;
}

export interface LabelPlacement {
  /** Hide the name until the camera comes closer and the collision is gone. */
  hidden: boolean;
  /** Pixels to move the name down (positive) or up (negative). */
  dy: number;
}

/** Clear space kept between two names, in pixels. */
export const LABEL_GAP_PX = 3;

const overlaps = (
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
  gap: number,
) =>
  a.left < b.left + b.width + gap &&
  b.left < a.left + a.width + gap &&
  a.top < b.top + b.height + gap &&
  b.top < a.top + a.height + gap;

/**
 * Decide each label's placement so no two shown names overlap.
 *
 * Names are settled in order of importance: pinned first, then by rank, then in
 * list order. A name that collides with one already settled is hidden. A pinned
 * name moves up or down by the smallest amount that clears every settled name,
 * and stays put when no such move exists. Placements are index-aligned to
 * `boxes`.
 */
export function declutterLabels(
  boxes: readonly LabelBox[],
  gap: number = LABEL_GAP_PX,
): LabelPlacement[] {
  const order = boxes
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(boxes[b].pinned) - Number(boxes[a].pinned) ||
        boxes[b].rank - boxes[a].rank ||
        a - b,
    );
  const out: LabelPlacement[] = boxes.map(() => ({ hidden: false, dy: 0 }));
  const settled: LabelBox[] = [];

  for (const i of order) {
    const box = boxes[i];
    const hits = settled.filter((s) => overlaps(box, s, gap));
    if (hits.length === 0) {
      settled.push(box);
      continue;
    }
    if (!box.pinned) {
      out[i].hidden = true;
      continue;
    }
    // Every move that takes the box clear of one name it hits, smallest first.
    const moves = hits
      .flatMap((s) => [
        s.top + s.height + gap - box.top,
        s.top - gap - box.height - box.top,
      ])
      .sort((a, b) => Math.abs(a) - Math.abs(b));
    const dy = moves.find((m) => {
      const moved = { ...box, top: box.top + m };
      return !settled.some((s) => overlaps(moved, s, gap));
    });
    if (dy === undefined) {
      settled.push(box);
      continue;
    }
    out[i].dy = dy;
    settled.push({ ...box, top: box.top + dy });
  }
  return out;
}

/** True when two matrices hold the same numbers. Compared in place, because
 *  joining 32 numbers into a string on every frame drawn is wasted work. */
export function sameNumbers(
  a: ArrayLike<number> | undefined,
  b: ArrayLike<number> | undefined,
): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The part of a label's element the pass touches. */
export interface LabelElement {
  style: { visibility: string; marginTop: string };
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

/** One label as the pass sees it. */
export interface LabelInput {
  el: LabelElement;
  /** Where the anchor sits in normalised device coordinates, or null when the
   *  name is hidden or outside the view and takes no part. */
  ndc: { x: number; y: number } | null;
  /** The label's anchor within its own box: 0.5, 0.5 is the middle. */
  center: { x: number; y: number };
  rank: number;
  pinned: boolean;
}

/** A label's size in pixels. It does not depend on the camera. */
export interface LabelSize {
  width: number;
  height: number;
}

/**
 * Place every name for one camera.
 *
 * Reads first, writes second. The sizes are read from the page only for a
 * label with no size kept yet, or all of them when `remeasure` is set, and
 * every style write waits until the last read is done. Mixing the two makes the
 * webview lay the page out again once per label.
 *
 * `sizes` is the caller's store of kept sizes. A zero size is never kept,
 * since a label the page has not shown yet reports none.
 */
export function placeLabels(
  inputs: readonly LabelInput[],
  viewWidth: number,
  viewHeight: number,
  sizes: Map<LabelElement, LabelSize>,
  remeasure: boolean,
): void {
  const entries: { el: LabelElement; box: LabelBox }[] = [];
  for (const input of inputs) {
    if (!input.ndc) continue;
    let size = remeasure ? undefined : sizes.get(input.el);
    if (!size) {
      size = { width: input.el.offsetWidth, height: input.el.offsetHeight };
      if (size.width > 0 && size.height > 0) sizes.set(input.el, size);
      else sizes.delete(input.el);
    }
    entries.push({
      el: input.el,
      box: {
        left:
          (input.ndc.x * 0.5 + 0.5) * viewWidth - size.width * input.center.x,
        top:
          (-input.ndc.y * 0.5 + 0.5) * viewHeight -
          size.height * input.center.y,
        width: size.width,
        height: size.height,
        rank: input.rank,
        pinned: input.pinned,
      },
    });
  }
  const placed = declutterLabels(entries.map((e) => e.box));

  // Writes. A name that took no part in the pass comes back to its own place.
  const result = new Map<LabelElement, LabelPlacement>();
  for (let k = 0; k < placed.length; k++) {
    result.set(entries[k].el, placed[k]);
  }
  for (const { el } of inputs) {
    const p = result.get(el);
    const visibility = p?.hidden ? "hidden" : "";
    const marginTop = p && !p.hidden && p.dy !== 0 ? `${p.dy}px` : "";
    if (el.style.visibility !== visibility) el.style.visibility = visibility;
    if (el.style.marginTop !== marginTop) el.style.marginTop = marginTop;
  }
}
