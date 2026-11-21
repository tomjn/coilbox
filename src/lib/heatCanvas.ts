import type { HeatField } from "./heatField";
import { type HeatKind, paintHeatField } from "./heatRamp";

/**
 * The class for a canvas a field is painted on over a map. It puts a dark edge
 * round whatever is drawn, as a mark has, so a cell in a pale end of a ramp
 * still shows on ground of about the same colour, such as amber heat on a tan
 * desert. The edge follows the drawn cells and so adds nothing where there are
 * none.
 */
export const HEAT_EDGE_CLASS =
  "[filter:drop-shadow(0_0_1px_rgb(0_0_0/0.85))_drop-shadow(0_0_1px_rgb(0_0_0/0.85))]";

/**
 * Paint a field onto a canvas, one pixel a cell. The page stretches the canvas
 * over the map's box, which is what smooths it. `kind` picks the layer's ramp.
 */
export function drawHeatField(
  canvas: HTMLCanvasElement,
  field: HeatField,
  kind: HeatKind,
) {
  canvas.width = field.width;
  canvas.height = field.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(field.width, field.height);
  image.data.set(paintHeatField(field, { kind }));
  ctx.putImageData(image, 0, 0);
}
