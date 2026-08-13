/**
 * A layout as a small picture, for a card in the library (issue #1415).
 *
 * The drawing is `../../LayoutPlan.tsx` and the arithmetic behind it is
 * `blueprintShape` in `@/hub/preview`, so a base looks the same on its card here
 * as it does on the page somebody else finds it on. All this adds is the size it
 * is drawn at, and the decision not to draw it.
 *
 * Nothing is drawn for a layout with no buildings in it. An empty box reads as
 * broken where an absence reads as a layout nobody has drawn yet.
 */

import { blueprintShape } from "@/hub/preview";
import { LayoutPlan } from "../../LayoutPlan";
import type { BlueprintPayload } from "../../payload";

export function LayoutThumb({ layout }: { layout: BlueprintPayload }) {
  const shape = blueprintShape(layout);
  if (!shape) return null;

  // The whole of whatever box it was put in, because the plan is a sheet now and
  // a sheet fills the space it is given (issue #1508).
  return <LayoutPlan shape={shape} className="size-full" />;
}
