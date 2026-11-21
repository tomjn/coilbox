import { cn } from "@picoframe/frame";
import { readableText } from "@/lib/allyDisplay";
import {
  cornerAnchor,
  labelAnchor,
  polygonPoints,
  type StartArea,
  toPreview,
  usableExtent,
  type WorldExtent,
} from "./polygon";

/**
 * Render-only start areas drawn as polygons over the minimap, in world units,
 * with each area's suggested start points and its name. The polygon twin of
 * `StartBoxOverlay`, which draws the lobby's rectangles. Draws nothing until
 * the map's size is known, since that is what places a point. With `named`
 * false the labels have no tooltip and let the pointer through to what is under
 * them, as the unit map needs. With `labelAt` "corner" a label sits at the top
 * left of its area and not in the middle, which is where a start position is.
 */
export function StartPolygonOverlay({
  areas,
  extent,
  named = true,
  labelAt = "centre",
}: {
  areas: StartArea[];
  extent: WorldExtent | null | undefined;
  named?: boolean;
  labelAt?: "centre" | "corner";
}) {
  if (!extent || !usableExtent(extent)) return null;
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {areas.flatMap((area) =>
          area.polygons.map((polygon, i) => {
            const points = polygonPoints(polygon, extent);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: an area's polygons never reorder
              <g key={`${area.key}:${i}`} data-layer="startBox">
                {/* A dark hairline under the coloured edge, so the area reads
                    on light and dark maps alike. */}
                <polygon
                  points={points}
                  fill="none"
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth={4}
                  vectorEffect="non-scaling-stroke"
                />
                <polygon
                  points={points}
                  fill={`${area.color}33`}
                  stroke={area.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          }),
        )}
      </svg>
      {areas.flatMap((area) =>
        area.points.map((point, i) => {
          const at = toPreview(point, extent);
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: an area's points never reorder
              key={`${area.key}:point:${i}`}
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/70"
              style={{
                left: `${at.left}%`,
                top: `${at.top}%`,
                background: area.color,
              }}
              aria-hidden
            />
          );
        }),
      )}
      {areas.map((area) => {
        const anchor = labelAt === "corner" ? cornerAnchor : labelAnchor;
        const at = area.label ? anchor(area, extent) : null;
        if (!at) return null;
        return (
          <span
            key={`${area.key}:label`}
            data-layer="startBoxLabel"
            className={cn(
              "absolute rounded px-1 text-[10px] font-bold leading-tight shadow",
              labelAt === "corner"
                ? "m-0.5"
                : "-translate-x-1/2 -translate-y-1/2",
              !named && "pointer-events-none",
            )}
            style={{
              left: `${at.left}%`,
              top: `${at.top}%`,
              background: area.color,
              color: readableText(area.color),
            }}
            title={named ? area.title : undefined}
          >
            {area.label}
          </span>
        );
      })}
    </>
  );
}
