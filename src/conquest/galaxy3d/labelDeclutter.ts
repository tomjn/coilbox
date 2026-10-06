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
