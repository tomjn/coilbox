/**
 * Where each cell of the module list goes, with the built in modules under a
 * heading of their own above the user's (issue #3299).
 *
 * The list is drawn on one canvas behind a scroller of buttons, so the cells and
 * the drawing have to agree on every position. Both read them from here.
 */

export interface GridMetrics {
  cell: number;
  label: number;
  gap: number;
  /** The height of a heading row, gap included. */
  heading: number;
}

export interface GridLayout {
  /** The top left of each cell, in list order. */
  cells: { left: number; top: number }[];
  headings: { label: string; top: number }[];
  height: number;
}

/**
 * The cells of `builtIn.length` modules, `columns` across. Built in modules
 * come first in the list. Headings appear only when there are built in modules
 * to tell apart from the user's, so a list of the user's own looks as it did.
 */
export function gridLayout(
  builtIn: boolean[],
  columns: number,
  metrics: GridMetrics,
): GridLayout {
  const pitchX = metrics.cell + metrics.gap;
  const pitchY = metrics.cell + metrics.label + metrics.gap;
  const ownStart = builtIn.findIndex((flag) => !flag);
  const firstOwn = ownStart < 0 ? builtIn.length : ownStart;
  const sections =
    firstOwn === 0
      ? [{ label: null, from: 0, to: builtIn.length }]
      : [
          { label: "Built in", from: 0, to: firstOwn },
          ...(firstOwn < builtIn.length
            ? [{ label: "Saved", from: firstOwn, to: builtIn.length }]
            : []),
        ];

  const cells: GridLayout["cells"] = [];
  const headings: GridLayout["headings"] = [];
  let top = 0;
  for (const section of sections) {
    if (section.label) {
      headings.push({ label: section.label, top });
      top += metrics.heading;
    }
    const count = section.to - section.from;
    for (let i = 0; i < count; i++) {
      cells.push({
        left: (i % columns) * pitchX,
        top: top + Math.floor(i / columns) * pitchY,
      });
    }
    top += Math.ceil(count / columns) * pitchY;
  }
  return { cells, headings, height: Math.max(top - metrics.gap, 0) };
}
