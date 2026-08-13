/**
 * A layout as a small picture, for a card in the library (issue #1415).
 *
 * One rounded square per building, sized by what it stands on, which is the
 * same drawing the hub and the website make of a shared layout. The arithmetic
 * is `blueprintShape` in `@/hub/preview`, so a base looks the same on its card
 * here as it does on the page somebody else finds it on.
 *
 * Nothing is drawn for a layout with no buildings in it. An empty box reads as
 * broken where an absence reads as a layout nobody has drawn yet.
 */

import { blueprintShape } from "@/hub/preview";
import type { BlueprintPayload } from "../../payload";

export function LayoutThumb({ layout }: { layout: BlueprintPayload }) {
  const shape = blueprintShape(layout);
  if (!shape) return null;

  return (
    <svg
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      className="max-h-24 w-full"
      role="img"
      aria-label={`${shape.squares.length} buildings over ${Math.round(shape.width)} by ${Math.round(shape.height)} build squares`}
    >
      {shape.squares.map((square) => (
        <rect
          key={`${square.def}@${square.x},${square.y}`}
          x={square.x}
          y={square.y}
          width={square.width}
          height={square.height}
          rx={0.18}
          strokeWidth={0.06}
          className="fill-muted stroke-border"
        />
      ))}
    </svg>
  );
}
