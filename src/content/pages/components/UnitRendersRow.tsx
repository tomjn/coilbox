/**
 * The unit's four rendered angles, laid out the way the hub's own
 * encyclopedia does: a plan from above, then front, side and angled pictures
 * of the model. `useUnitRenders` fetches and draws them, and this only shows
 * whatever state each one is currently in.
 *
 * Every card says what it is showing rather than showing nothing: a render
 * still being drawn, one this unit has no model for, or one the engine could
 * not draw, are each their own sentence rather than a blank or broken image.
 */

import { type AngleRender, angleLabel } from "./useUnitRenders";

/** Checkerboard behind a render, so a transparent picture reads as
 *  transparent rather than looking the same as an opaque one on a plain
 *  card. Matches the drawer's own top-down preview. */
const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%),linear-gradient(45deg,#0002 25%,transparent 25%,transparent 75%,#0002 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 8px 8px",
};

export function UnitRendersRow({
  renders,
}: {
  renders: Record<string, AngleRender>;
}) {
  const angles = Object.keys(renders);
  if (angles.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Renders</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {angles.map((angle) => (
          <RenderCard key={angle} render={renders[angle]} />
        ))}
      </div>
    </section>
  );
}

function RenderCard({ render }: { render: AngleRender }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card p-2">
      <div
        className="flex aspect-square items-center justify-center overflow-hidden rounded"
        style={CHECKERBOARD}
      >
        {render.status === "ready" && render.url ? (
          <img
            src={render.url}
            alt={`${angleLabel(render.angle)} render of this unit`}
            className="max-h-full max-w-full object-contain"
          />
        ) : render.status === "unavailable" ? (
          <p className="px-2 text-center text-xs text-muted-foreground">
            {render.message ?? "Not available."}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {render.status === "drawing" ? "Drawing…" : "Checking…"}
          </p>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {angleLabel(render.angle)}
      </p>
    </div>
  );
}
