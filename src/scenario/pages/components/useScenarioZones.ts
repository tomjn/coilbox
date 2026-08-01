/**
 * Wiring a scenario's zones into the map scene.
 *
 * Kept out of the scene component for the same reason the units are: it is all
 * lifecycle. The layer is built once per scene and per map, and redrawn whenever
 * the zones, the selection or the map's relief change. Redrawing is cheap here,
 * unlike the units, because a zone is geometry the editor generates rather than
 * a model it has to read out of a game archive.
 */

import { useEffect, useRef, useState } from "react";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point, ScenarioZone } from "../../model";
import { createZonesLayer, type ZonesLayer } from "./zonesLayer";

export function useScenarioZones(
  handle: MapScene3D | null,
  zones: ScenarioZone[],
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
  /** The zone that is selected, which is the one that gets resize handles. */
  selectedId: string | null,
): ZonesLayer | null {
  const { worldWidth, worldHeight } = map;
  // Behind a ref: the heightmap arrives after the scene does, and rebuilding
  // the layer every time the reader changes identity would flicker the zones.
  const ground = useRef(groundAt);
  ground.current = groundAt;

  const [layer, setLayer] = useState<ZonesLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createZonesLayer({
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `groundAt` is not read here, it is the signal that the relief the drape follows has arrived
  useEffect(() => {
    layer?.draw(zones, selectedId);
  }, [layer, zones, selectedId, groundAt]);

  return layer;
}
