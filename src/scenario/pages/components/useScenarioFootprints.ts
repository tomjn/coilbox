/**
 * Wiring the ground a base's buildings stand on into the map scene.
 *
 * The same lifecycle as the start positions: built once per scene and per map,
 * redrawn when the footprints, or the relief they lie on, change. Nothing is
 * returned, because nothing points at this layer. It is not pickable.
 */

import { useEffect, useRef, useState } from "react";

import type { FootprintMark } from "@/blueprint/footprint";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "../../model";
import { createFootprintsLayer, type FootprintsLayer } from "./footprintsLayer";

export function useScenarioFootprints(
  handle: MapScene3D | null,
  marks: FootprintMark[],
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
): void {
  const { worldWidth, worldHeight } = map;
  // Behind a ref for the same reason the starts' reader is: the heightmap
  // arrives after the scene does, and rebuilding the layer every time the reader
  // changes identity would flicker the squares.
  const ground = useRef(groundAt);
  ground.current = groundAt;

  const [layer, setLayer] = useState<FootprintsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createFootprintsLayer({
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `groundAt` is not read here, it is the signal that the relief the footprints lie on has arrived
  useEffect(() => {
    layer?.draw(marks);
  }, [layer, marks, groundAt]);
}
