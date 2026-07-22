/** Which terrain infomap is drawn over a map's minimap. */
export type MapOverlayLayer = "off" | "metal" | "height";

/**
 * Pick the overlay data URL for the active layer. Pure so the layer-to-URL
 * mapping can be unit-tested without pulling in the React hooks; returns
 * `undefined` when the layer is off or its render hasn't resolved yet.
 */
export function overlayUrlFor(
  layer: MapOverlayLayer,
  heightUrl: string | null | undefined,
  metalUrl: string | null | undefined,
): string | undefined {
  if (layer === "height") return heightUrl ?? undefined;
  if (layer === "metal") return metalUrl ?? undefined;
  return undefined;
}
