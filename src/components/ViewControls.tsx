/**
 * The bar of view controls an editor puts in the corner of its viewport (issue
 * #1870).
 *
 * Changing how you are looking at a thing is not the same as changing the thing,
 * and every editor that draws a 3D view needs both. The unit builder grew a bar
 * for the first kind in the bottom right of its viewport, and the placement
 * surface grew its own row in the top right with different buttons at a
 * different size. This is that bar, once: the corner it sits in, how the buttons
 * are grouped, how big they are, and how each one says what it does.
 *
 * What goes in it is the editor's business. A collision volume and an aim point
 * mean nothing outside the unit builder, and a map has no backdrop to pick. Two
 * do belong anywhere, so they are offered here rather than rebuilt each time:
 * {@link GridToggle} and {@link ResetViewButton}.
 *
 * It is for editing surfaces only. A map preview, a mission briefing and the
 * conquest map are things you look at rather than things you change, and a row
 * of view toggles on one of those is clutter.
 *
 * Deliberately not a 2D component. The three surfaces that want it - the unit
 * builder's model viewport, the scenario editor's map and the base layout
 * editor - are all three.js scenes with a camera. `@/blueprint/LayoutPlan` draws
 * a layout as a flat SVG plan, but nothing edits through it: it is the drawing a
 * library card, a share drawer and the hub item page all show. So there is no 2D
 * editing surface to serve, and the reset control can assume there is a camera
 * to put back.
 *
 * Tooltips are the `title` attribute rather than a Radix `Tooltip`, which is
 * what the unit builder's bar already used. Every button also carries that same
 * text as its `aria-label`: a `title` alone does name a button, but only if the
 * screen reader is set to read titles, and none of these buttons has any text of
 * its own to fall back on. A toggle carries its state in `aria-pressed`
 * alongside it, because a toggle that does not say which way it is set is worse
 * than no toggle at all.
 */

import { Button } from "@picoframe/frame";
import { Frame, Grid3x3, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ButtonGroup } from "@/components/ui/button-group";

/**
 * The bar itself. Put it inside a positioned viewport and fill it with the
 * controls below.
 *
 * Bottom right, because the top of a viewport is where an editor's own chrome
 * goes and the bottom left is where its notes go.
 */
export function ViewControls({ children }: { children: ReactNode }) {
  return (
    <ButtonGroup className="absolute bottom-3 right-3">{children}</ButtonGroup>
  );
}

/**
 * Something in the view that is either shown or hidden.
 *
 * Both titles are asked for rather than one, because a toggle that says the same
 * thing in both states cannot tell you which way pressing it will go.
 */
export function ViewToggle({
  icon: Icon,
  on,
  onChange,
  hideTitle,
  showTitle,
}: {
  icon: LucideIcon;
  on: boolean;
  onChange: (on: boolean) => void;
  /** What the button does while the thing is shown. */
  hideTitle: string;
  /** What it does while the thing is hidden. */
  showTitle: string;
}) {
  const title = on ? hideTitle : showTitle;
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={title}
      aria-label={title}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/**
 * Something the view does once when pressed.
 *
 * Takes its icon as children rather than as a prop, so a button whose face is
 * drawn rather than picked - the unit builder's compass, which is a live drawing
 * of where the camera is - is still one of these.
 */
export function ViewButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </Button>
  );
}

/**
 * Hide the ground grid.
 *
 * `showTitle` says what the grid is on this surface, because a grid ruled in
 * footprint steps and a grid ruled in build squares are not the same grid.
 */
export function GridToggle({
  on,
  onChange,
  showTitle,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  showTitle: string;
}) {
  return (
    <ViewToggle
      icon={Grid3x3}
      on={on}
      onChange={onChange}
      hideTitle="Hide the ground grid"
      showTitle={showTitle}
    />
  );
}

/**
 * Put the camera back where the whole of what is being edited is in shot.
 *
 * The one control every 3D editor needs, because there is no way to drag your
 * way out of an angle you cannot see anything from. `onClick` is expected to
 * frame what is there rather than restore a fixed position: a canned distance
 * leaves a big thing cut off and a small one a speck, which is the state this
 * button exists to get somebody out of.
 */
export function ResetViewButton({
  onClick,
  title = "Reset the view",
}: {
  onClick: () => void;
  /** Overridden where the surface can say what is being framed, such as "Frame
   *  the map". */
  title?: string;
}) {
  return (
    <ViewButton title={title} onClick={onClick}>
      <Frame className="size-4" />
    </ViewButton>
  );
}
