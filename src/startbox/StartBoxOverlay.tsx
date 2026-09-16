import { allyLetter, readableText } from "@/lib/allyDisplay";
import { allyPaletteColor } from "@/lib/allyPalette";
import { GRID, type StartRect } from "./geometry";

const pct = (v: number) => (v / GRID) * 100;

/**
 * Render-only ally start boxes over the minimap. Bounds come from the lobby as
 * integers on a 0..200 grid, normalised to `%` inside the aspect-correct image
 * box. Each box gets a dark hairline (so it reads on light *and* dark maps), a
 * gently pulsing ally-coloured fill, and a solid ally-coloured label pill with
 * contrasting text, keeping many boxes distinguishable. This is the read-only
 * half: `StartBoxEditor` is the variant shown to whoever may change the boxes.
 */
export function StartBoxOverlay({
  rects,
}: {
  rects: Record<string, StartRect>;
}) {
  return (
    <>
      {Object.entries(rects).map(([ally, r]) => {
        const i = Number(ally);
        const color = allyPaletteColor(i);
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
