/**
 * Turns 4,412 parts named `Object1848_copy5182` into something a picker can be
 * browsed and searched.
 *
 * Nothing here needs a human. Curation through `overrides.json` improves the
 * result but is never required, so the pack is usable the day it is built.
 *
 * The signals, in the order they carry information:
 *
 * 1. Colourway. The atlas is three vertical columns of the same panel layout in
 *    green, tan and grey. A part's u coordinate says which it samples, and a
 *    unit generally wants one colourway throughout, so this is the filter that
 *    matters most.
 * 2. Material. The only artist-authored label in the file.
 * 3. Shape and size, from the bounding box.
 * 4. Atlas row, which groups parts the artist drew near each other.
 */

/**
 * The atlas is three equal columns. Verified against the image.
 *
 * These double as the pack's categories. A unit generally wants one colourway
 * throughout, so it is the cut people browse by, and the counts come out
 * roughly even. Shape does not work as the primary axis: two thirds of the
 * parts are chunky enough to land in one bucket however the thresholds are set.
 */
export const COLOURWAYS = [
  { id: "green", label: "Green" },
  { id: "tan", label: "Tan" },
  { id: "grey", label: "Grey" },
  { id: "mixed", label: "Mixed" },
];

export const SHAPES = [
  { id: "sheet", label: "Sheets" },
  { id: "beam", label: "Beams" },
  { id: "plate", label: "Plates" },
  { id: "block", label: "Blocks" },
];

const SIZES = ["tiny", "small", "medium", "large", "huge"];

/**
 * Which atlas column a part samples, or "mixed" when it spans a boundary.
 *
 * @param {{ min: number[], max: number[] }} uvBox
 */
export function colourwayOf(uvBox) {
  const column = (u) => Math.min(2, Math.max(0, Math.floor(u * 3)));
  const low = column(uvBox.min[0]);
  const high = column(uvBox.max[0]);
  return low === high ? COLOURWAYS[low].id : "mixed";
}

/**
 * Classify by how many of the three dimensions are thin. A sheet has no
 * thickness at all, a beam is thin in two, a plate in one, a block in none.
 *
 * Thresholds are set from the parts file rather than picked by feel: the median
 * part has short/long of 0.33 and mid/long of 0.5, so a cut at 0.2 and 0.35
 * puts roughly a quarter of parts in each of beam and plate and leaves blocks
 * as the genuine remainder.
 *
 * @param {{ min: number[], max: number[] }} bbox
 */
export function shapeOf(bbox) {
  const [long, mid, short] = bbox.max
    .map((max, i) => max - bbox.min[i])
    .sort((a, b) => b - a);
  if (long === 0) return "sheet";
  if (short / long < 0.02) return "sheet";
  // Beam before plate: a long thin strut is thin on both counts, and "beam" is
  // the more useful of the two labels for it.
  if (mid / long < 0.35) return "beam";
  if (short / long < 0.2) return "plate";
  return "block";
}

/**
 * @param {Array<{ mesh: import("./mesh.mjs").PartMesh, sourceNames: string[] }>} entries
 * @param {Record<string, object>} overrides keyed by part id
 */
export function categorise(entries, overrides = {}) {
  const longest = entries
    .map(({ mesh }) => longestSide(mesh.bbox))
    .sort((a, b) => a - b);
  const cut = (fraction) => longest[Math.floor(longest.length * fraction)];
  const thresholds = [cut(0.2), cut(0.4), cut(0.6), cut(0.8)];

  return entries.map(({ mesh, sourceNames }) => {
    const colourway = colourwayOf(mesh.uvBox);
    const shape = shapeOf(mesh.bbox);
    const size =
      SIZES[thresholds.filter((t) => longestSide(mesh.bbox) > t).length];
    // Which eighth of the atlas the part sits in vertically. Parts the artist
    // drew together end up adjacent, which is a decent proxy for a family.
    const row = Math.min(
      7,
      Math.floor(((mesh.uvBox.min[1] + mesh.uvBox.max[1]) / 2) * 8),
    );

    const auto = {
      id: mesh.id,
      name: autoName(colourway, shape, mesh.bbox),
      category: colourway,
      colourway,
      shape,
      material: mesh.material,
      tags: [shape, size, `row${row}`],
      sourceNames,
      aliasCount: sourceNames.length,
    };

    const override = overrides[mesh.id];
    return override
      ? { ...auto, ...override, tags: [...auto.tags, ...(override.tags ?? [])] }
      : auto;
  });
}

/**
 * Something like "green plate 4x2x0.5". The dimensions are what an assembler
 * actually looks for, so they belong in the name rather than only in a tooltip.
 */
function autoName(colourway, shape, bbox) {
  const dims = bbox.max
    .map((max, i) => max - bbox.min[i])
    .sort((a, b) => b - a)
    .map((n) => round(n))
    .join("x");
  return `${colourway} ${shape} ${dims}`;
}

function round(n) {
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 4) / 4);
}

function longestSide(bbox) {
  return Math.max(...bbox.max.map((max, i) => max - bbox.min[i]));
}
