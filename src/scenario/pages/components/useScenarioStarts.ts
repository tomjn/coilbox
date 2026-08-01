/**
 * Wiring the map's start positions into the map scene.
 *
 * The same lifecycle as the zones: built once per scene and per map, redrawn
 * when the markers, or the relief they stand on, change. Nothing is returned,
 * because nothing points at this layer. It is not pickable.
 */

import { useEffect, useRef, useState } from "react";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "../../model";
import type { StartMarker } from "./startPositions";
import { createStartsLayer, type StartsLayer } from "./startsLayer";

export function useScenarioStarts(
  handle: MapScene3D | null,
  markers: StartMarker[],
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
): void {
  const { worldWidth, worldHeight } = map;
  // Behind a ref for the same reason the zones' reader is: the heightmap
  // arrives after the scene does, and rebuilding the layer every time the
  // reader changes identity would flicker the markers.
  const ground = useRef(groundAt);
  ground.current = groundAt;

  const [layer, setLayer] = useState<StartsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createStartsLayer({
      handle,
      worldWidth,
      worldHeight,
      groundAt: (pos) => ground.current(pos),
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `groundAt` is not read here, it is the signal that the relief the markers stand on has arrived
  useEffect(() => {
    layer?.draw(markers);
  }, [layer, markers, groundAt]);
}
