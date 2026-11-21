/**
 * Polygon start areas in world units, mapped onto a map preview. The preview's
 * image box keeps the map's aspect ratio, so a point is placed by its share of
 * the map's width and height, the same way `MinimapPreview` places its start
 * markers. Kept apart from the 0 to 200 lobby grid in `./geometry`, which only
 * holds rectangles.
 */

/** A point on the map as `[x, z]` in world units. */
export type WorldPoint = readonly [number, number];

/** The map's size in world units: 512 per map size unit. */
export interface WorldExtent {
  x: number;
  z: number;
}

/** A position inside the preview, in percent of its width and height. */
export interface PreviewPoint {
  left: number;
  top: number;
}

/** One area's polygons and suggested start points, ready to draw. */
export interface StartArea {
  key: string;
  /** Short name drawn on the area. */
  label?: string;
  /** Long name, shown on hover. */
  title?: string;
  color: string;
  polygons: WorldPoint[][];
  points: WorldPoint[];
}

/** Where a world point sits in the preview. */
export function toPreview(
  [x, z]: WorldPoint,
  extent: WorldExtent,
): PreviewPoint {
  return { left: (x / extent.x) * 100, top: (z / extent.z) * 100 };
}

/** A polygon as the `points` of an SVG drawn on a 0 to 100 `viewBox`. */
export function polygonPoints(
  polygon: readonly WorldPoint[],
  extent: WorldExtent,
): string {
  return polygon
    .map((p) => {
      const { left, top } = toPreview(p, extent);
      return `${round(left)},${round(top)}`;
    })
    .join(" ");
}

/**
 * Where to put an area's label: the middle of the box around all its
 * polygons, or of its start points when it has no polygons. Null when it has
 * neither.
 */
export function labelAnchor(
  area: Pick<StartArea, "polygons" | "points">,
  extent: WorldExtent,
): PreviewPoint | null {
  const corners = area.polygons.flat();
  const from = corners.length > 0 ? corners : area.points;
  if (from.length === 0) return null;
  const xs = from.map((p) => p[0]);
  const zs = from.map((p) => p[1]);
  return toPreview(
    [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ],
    extent,
  );
}

/**
 * The top left of the box around all an area's polygons, or of its start points
 * when it has no polygons. For a label that must stay clear of the middle of
 * the area, where start positions are drawn. Null when it has neither.
 */
export function cornerAnchor(
  area: Pick<StartArea, "polygons" | "points">,
  extent: WorldExtent,
): PreviewPoint | null {
  const corners = area.polygons.flat();
  const from = corners.length > 0 ? corners : area.points;
  if (from.length === 0) return null;
  return toPreview(
    [Math.min(...from.map((p) => p[0])), Math.min(...from.map((p) => p[1]))],
    extent,
  );
}

/**
 * Whether a point is inside a polygon, by counting how many of its edges a ray
 * from the point to the east crosses. A point exactly on an edge may fall
 * either way, which no start position is likely to land on.
 */
export function pointInPolygon(
  [x, z]: WorldPoint,
  polygon: readonly WorldPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Whether `extent` can place a point at all. */
export function usableExtent(extent: WorldExtent | null | undefined): boolean {
  return !!extent && extent.x > 0 && extent.z > 0;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
