import type { HeatField } from "./heatField";
import { type HeatKind, paintHeatField } from "./heatRamp";

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
