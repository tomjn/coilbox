import { readableText } from "@/lib/allyDisplay";
import {
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
 * the map's size is known, since that is what places a point.
 */
export function StartPolygonOverlay({
  areas,
  extent,
}: {
  areas: StartArea[];
  extent: WorldExtent | null | undefined;
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
              <g key={`${area.key}:${i}`}>
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
        const at = area.label ? labelAnchor(area, extent) : null;
        if (!at) return null;
        return (
          <span
            key={`${area.key}:label`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-bold leading-tight shadow"
            style={{
              left: `${at.left}%`,
              top: `${at.top}%`,
              background: area.color,
              color: readableText(area.color),
            }}
            title={area.title}
          >
            {area.label}
          </span>
        );
      })}
    </>
  );
}
