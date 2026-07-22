import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUnitsyncHeightmap, useUnitsyncMetalmap } from "@/content/config";
import { type MapOverlayLayer, overlayUrlFor } from "./overlayLayer";

export type { MapOverlayLayer } from "./overlayLayer";

/**
 * Shared metal/height overlay state for a map minimap. Each render is fetched
 * lazily (only while its layer is active) and cached by the underlying hooks, so
 * the common minimap-only view stays as cheap as before. Extracted from the
 * battle room so the skirmish picker and content map detail share one
 * implementation.
 */
export function useMapOverlayLayer(
  enginePath: string | undefined,
  dataDir: string | undefined,
  mapName: string | undefined,
) {
  const [layer, setLayer] = useState<MapOverlayLayer>("off");
  const heightmap = useUnitsyncHeightmap(
    enginePath,
    dataDir,
    layer === "height" ? mapName : undefined,
  );
  const metalmap = useUnitsyncMetalmap(
    enginePath,
    dataDir,
    layer === "metal" ? mapName : undefined,
  );
  const overlayUrl = overlayUrlFor(
    layer,
    heightmap.data?.dataUrl,
    metalmap.data?.dataUrl,
  );
  return { layer, setLayer, overlayUrl };
}

/**
 * The metal/height infomap drawn over the minimap image. Pointer-transparent and
 * pinned to the image box so it never intercepts clicks (e.g. the picker button
 * or a start-box editor beneath it).
 */
export function MapOverlayImage({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full object-fill opacity-95"
    />
  );
}

/**
 * The off / metal / height layer control. Same picoframe ToggleGroup across the
 * battle room, skirmish picker, and map detail so the three surfaces read alike.
 */
export function MapLayerToggle({
  layer,
  onChange,
}: {
  layer: MapOverlayLayer;
  onChange: (layer: MapOverlayLayer) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">Overlay</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={layer}
        onValueChange={(v) => onChange((v as MapOverlayLayer) || "off")}
      >
        <ToggleGroupItem value="off">Map</ToggleGroupItem>
        <ToggleGroupItem value="metal">Metal</ToggleGroupItem>
        <ToggleGroupItem value="height">Height</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
