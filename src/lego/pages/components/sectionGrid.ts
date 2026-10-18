/**
 * Where each tile of the inventory grid goes (#4536).
 *
 * The grid is one list of tiles split into sections, each under a heading:
 * Shapes, Parts, Built in modules, Saved modules. It is drawn on one canvas
 * behind a layer of buttons, so the drawing and the buttons have to agree on
 * every position, and both read them from here. A tile's place is given by its
 * index in the whole list, so arrow keys can walk across sections as one list.
 */

export interface GridMetrics {
  /** The square a tile's model is drawn in. */
  cell: number;
  /** The name line under the square. */
  label: number;
  gap: number;
  /** A heading row, with the space between it and its first row of tiles. */
  heading: number;
  /** Extra space above every heading but the first. */
  sectionGap: number;
}

export interface SectionBox {
  /** Where the heading sits. */
  top: number;
  /** Where the first row of tiles sits. */
  cellsTop: number;
  /** The index of the section's first tile in the whole list. */
  first: number;
  count: number;
}

export interface SectionLayout {
  columns: number;
  pitchX: number;
  pitchY: number;
  sections: SectionBox[];
  /** The number of tiles in every section together. */
  total: number;
  height: number;
}

/**
 * Lay out sections of `counts` tiles, `columns` across. A section with no
 * tiles gets no heading and no space, so the caller can pass every section.
 */
export function sectionLayout(
  counts: number[],
  columns: number,
  metrics: GridMetrics,
): SectionLayout {
  const across = Math.max(1, columns);
  const pitchX = metrics.cell + metrics.gap;
  const pitchY = metrics.cell + metrics.label + metrics.gap;
  const sections: SectionBox[] = [];
  let top = 0;
  let first = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    if (sections.length > 0) top += metrics.sectionGap;
    const cellsTop = top + metrics.heading;
    sections.push({ top, cellsTop, first, count });
    top = cellsTop + Math.ceil(count / across) * pitchY;
    first += count;
  }
  return {
    columns: across,
    pitchX,
    pitchY,
    sections,
    total: first,
    height: Math.max(top - metrics.gap, 0),
  };
}

/** The section holding tile `index`, or undefined past the end. */
function sectionOf(
  layout: SectionLayout,
  index: number,
): SectionBox | undefined {
  return layout.sections.find(
    (section) =>
      index >= section.first && index < section.first + section.count,
  );
}

/** The top left of tile `index`. */
export function tileAt(
  layout: SectionLayout,
  index: number,
): { left: number; top: number } | undefined {
  const section = sectionOf(layout, index);
  if (!section) return undefined;
  const local = index - section.first;
  return {
    left: (local % layout.columns) * layout.pitchX,
    top: section.cellsTop + Math.floor(local / layout.columns) * layout.pitchY,
  };
}

/**
 * The tiles with any part between `top` and `bottom`, plus `overscan` rows
 * either side of them in each section, in list order.
 */
export function tilesBetween(
  layout: SectionLayout,
  top: number,
  bottom: number,
  overscan = 0,
): number[] {
  const { columns, pitchY } = layout;
  const indices: number[] = [];
  for (const section of layout.sections) {
    const rows = Math.ceil(section.count / columns);
    const firstRow = Math.max(
      0,
      Math.floor((top - section.cellsTop) / pitchY) - overscan,
    );
    const lastRow = Math.min(
      rows - 1,
      Math.floor((bottom - section.cellsTop) / pitchY) + overscan,
    );
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = 0; column < columns; column++) {
        const local = row * columns + column;
        if (local >= section.count) break;
        indices.push(section.first + local);
      }
    }
  }
  return indices;
}

/** One row down, into the next section's first row from a section's last. */
function down(layout: SectionLayout, index: number): number {
  const section = sectionOf(layout, index);
  if (!section) return index;
  const { columns } = layout;
  const local = index - section.first;
  const column = local % columns;
  const row = Math.floor(local / columns);
  if (row < Math.ceil(section.count / columns) - 1) {
    return section.first + Math.min(local + columns, section.count - 1);
  }
  const next = layout.sections[layout.sections.indexOf(section) + 1];
  if (!next) return index;
  return next.first + Math.min(column, next.count - 1);
}

/** One row up, into the previous section's last row from a section's first. */
function up(layout: SectionLayout, index: number): number {
  const section = sectionOf(layout, index);
  if (!section) return index;
  const { columns } = layout;
  const local = index - section.first;
  const column = local % columns;
  if (local >= columns) return index - columns;
  const previous = layout.sections[layout.sections.indexOf(section) - 1];
  if (!previous) return index;
  const lastRowStart = Math.floor((previous.count - 1) / columns) * columns;
  return previous.first + Math.min(lastRowStart + column, previous.count - 1);
}

/** Rows a Page Up or Page Down moves. */
const PAGE_ROWS = 4;

/**
 * Where a key moves the focus from tile `index`, or undefined for a key that
 * does not move it. Left and right run along the whole list. Up and down keep
 * the column, and cross into the next or previous section at its edge.
 */
export function stepFrom(
  layout: SectionLayout,
  index: number,
  key: string,
): number | undefined {
  const last = layout.total - 1;
  if (last < 0) return undefined;
  const repeat = (move: (at: number) => number, times: number) => {
    let at = index;
    for (let i = 0; i < times; i++) at = move(at);
    return at;
  };
  switch (key) {
    case "ArrowRight":
      return Math.min(last, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowDown":
      return down(layout, index);
    case "ArrowUp":
      return up(layout, index);
    case "PageDown":
      return repeat((at) => down(layout, at), PAGE_ROWS);
    case "PageUp":
      return repeat((at) => up(layout, at), PAGE_ROWS);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

/**
 * The count after a section's name: "373", or "12 of 373" while a search, a
 * category or a list narrows the section.
 */
export function sectionCount(shown: number, total: number): string {
  return shown < total ? `${shown} of ${total}` : `${shown}`;
}
