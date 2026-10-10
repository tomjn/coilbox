/**
 * Wiring a density field into a map scene (issue #1151).
 *
 * The same lifecycle as the scenario editor's layers: built once per scene,
 * redrawn when the field changes, disposed when the scene goes. Pass the
 * handle `MapPreview3D` gives `onScene`, and a field from `buildHeatField`.
 * A null field draws nothing, which is how a layer is switched off.
 *
 * Keep the field in a memo. A new field object is a new texture.
 */

import { useEffect, useState } from "react";

import type { HeatField } from "./heatField";
import { createHeatmapLayer, type HeatmapLayer } from "./heatmapLayer";
import type { HeatKind } from "./heatRamp";
import type { MapScene3D } from "./mapScene";

export function useHeatmapLayer(
  handle: MapScene3D | null,
  field: HeatField | null,
  /** Whose ramp the layer is drawn in. */
  kind: HeatKind,
  /** Fraction of the peak below which nothing is drawn. See `heatRamp.ts`. */
  threshold?: number,
): void {
  const [layer, setLayer] = useState<HeatmapLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createHeatmapLayer(handle);
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle]);

  useEffect(() => {
    layer?.draw(
      field,
      threshold === undefined ? { kind } : { kind, threshold },
    );
  }, [layer, field, kind, threshold]);
}
