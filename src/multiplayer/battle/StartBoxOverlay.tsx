import type { StartRect } from "../bindings";
import { allyLetter, readableText } from "./config";

/** TASServer ADDSTARTRECT coordinates are on a 0..200 grid (200 = full map). */
const GRID = 200;
const pct = (v: number) => (v / GRID) * 100;

/**
 * Render-only ally start boxes over the minimap. Bounds come from the lobby as
 * integers on a 0..200 grid, normalised to `%` inside the aspect-correct image
 * box. Each box gets a dark hairline (so it reads on light *and* dark maps), a
 * gently pulsing ally-coloured fill, and a solid ally-coloured label pill with
 * contrasting text — keeping many boxes distinguishable. Editing is a host
 * concern and out of scope for the joiner room.
 */
export function StartBoxOverlay({
  rects,
  allyColors,
}: {
  rects: Record<string, StartRect>;
  /** Ally index -> CSS colour; falls back to a neutral outline. */
  allyColors?: Record<number, string>;
}) {
  return (
    <>
      {Object.entries(rects).map(([ally, r]) => {
        const i = Number(ally);
        const color = allyColors?.[i] ?? "#e5e7eb";
        return (
          <div
            key={ally}
            className="absolute border-2"
            style={{
              left: `${pct(r.left)}%`,
              top: `${pct(r.top)}%`,
              width: `${pct(r.right - r.left)}%`,
              height: `${pct(r.bottom - r.top)}%`,
              borderColor: color,
              // Dark hairline around the coloured border so the box is visible
              // even against a same-coloured or very light map.
              boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
            }}
          >
            <div
              className="absolute inset-0 motion-safe:animate-pulse"
              style={{ background: `${color}33` }}
              aria-hidden
            />
            <span
              className="absolute left-0 top-0 m-0.5 rounded px-1 text-[10px] font-bold leading-tight shadow"
              style={{ background: color, color: readableText(color) }}
            >
              {allyLetter(i)}
            </span>
          </div>
        );
      })}
    </>
  );
}
