/**
 * Which of a set of screen-space labels to draw so that none covers another
 * (#4481). A label marked `always` is drawn whatever it covers: the selected
 * and hovered bones' names. The rest go nearest the camera first, and a label
 * is drawn only if it clears every label already drawn.
 */

/** A label's rectangle on screen in CSS pixels, y down. */
export interface LabelBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Distance from the camera along its view direction. Nearer goes first. */
  depth: number;
  always: boolean;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** The ids of the labels to draw. */
export function shownLabels(boxes: LabelBox[]): Set<string> {
  const order = [...boxes].sort(
    (a, b) => Number(b.always) - Number(a.always) || a.depth - b.depth,
  );
  const placed: LabelBox[] = [];
  for (const box of order) {
    if (box.always || !placed.some((other) => overlaps(box, other))) {
      placed.push(box);
    }
  }
  return new Set(placed.map((box) => box.id));
}
