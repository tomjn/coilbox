/**
 * The controls of the four view layout (#5371): the button beside the compass
 * that switches between one view and four, and the frame round each quadrant
 * with its name.
 *
 * The scene draws the quadrants. This only marks them out, so the frames let
 * every click through to the canvas except on the names. The bands the chrome
 * sits in round them are solid and take their own clicks, so a press beside a
 * button never reaches a view it is not over (#5410).
 */

import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { Grid2x2 } from "lucide-react";
import { QUADRANTS, type Quadrant, type ViewBands } from "../../quadViews";
import { useShortcutOverrides } from "../../shortcutOverridesStore";
import { shortcutLabel } from "../../shortcuts";

export function FourViewsButton({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  // Re-render when a shortcut is rebound, so its tooltip keeps up.
  useShortcutOverrides();
  const key = shortcutLabel("four-views");
  const label = t`Four views (${key})`;
  return (
    <Button
      type="button"
      variant={on ? "default" : "outline"}
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onToggle}
      className="pointer-events-auto"
    >
      <Grid2x2 className="size-4" />
    </Button>
  );
}

/** Where each quadrant's name sits: in the corner nearest the middle of the
 *  canvas, clear of the chrome round its edges. */
const NAME_CORNER: Record<Quadrant, string> = {
  top: "right-1 bottom-1",
  front: "bottom-1 left-1",
  side: "top-1 right-1",
  perspective: "top-1 left-1",
};

export function QuadrantFrames({
  active,
  bands,
  onMaximise,
}: {
  /** The quadrant that has the controls. */
  active: Quadrant;
  /** What the chrome takes off the canvas's edges. The quadrants fill the
   *  rest. */
  bands: ViewBands;
  onMaximise: (id: Quadrant) => void;
}) {
  const { t } = useLingui();
  const names: Record<Quadrant, string> = {
    // A context of their own, since "Side" elsewhere is a team's side.
    top: t({ message: "Top", context: "view" }),
    front: t({ message: "Front", context: "view" }),
    side: t({ message: "Side", context: "view" }),
    perspective: t({ message: "Perspective", context: "view" }),
  };
  return (
    <>
      <div
        data-band="top"
        className="absolute inset-x-0 top-0 bg-background"
        style={{ height: bands.top }}
      />
      <div
        data-band="bottom"
        className="absolute inset-x-0 bottom-0 bg-background"
        style={{ height: bands.bottom }}
      />
      <div
        data-band="left"
        className="absolute left-0 bg-background"
        style={{ top: bands.top, bottom: bands.bottom, width: bands.left }}
      />
      <div
        className="pointer-events-none absolute right-0 grid grid-cols-2 grid-rows-2"
        style={{ top: bands.top, bottom: bands.bottom, left: bands.left }}
      >
        {QUADRANTS.map((id) => (
          <div
            key={id}
            data-quadrant={id}
            data-active={id === active || undefined}
            className={cn(
              "relative border",
              id === active ? "border-primary" : "border-border/60",
            )}
          >
            <button
              type="button"
              title={t`Double click to fill the view`}
              onDoubleClick={() => onMaximise(id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onMaximise(id);
              }}
              className={cn(
                "pointer-events-auto absolute rounded bg-background/70 px-1.5 py-0.5 text-xs backdrop-blur focus-visible:outline-2 focus-visible:outline-ring",
                NAME_CORNER[id],
                id === active && "text-primary",
              )}
            >
              {names[id]}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
