/**
 * Wiring a scenario's order paths into the map scene.
 *
 * The same lifecycle the zones have, for the same reason: the layer is built
 * once per scene and per map, and redrawn whenever the paths, the selection or
 * the map's relief change. A path is a handful of generated points, so redrawing
 * it costs nothing.
 */

import { useEffect, useRef, useState } from "react";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point } from "../../model";
import type { PathSource } from "./orderPaths";
import { createPathsLayer, type PathsLayer } from "./pathsLayer";

export function useScenarioPaths(
  handle: MapScene3D | null,
  sources: PathSource[],
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
  /** The path being worked on, which is the one that gets waypoint knobs. */
  activeId: string | null,
  /** The one waypoint that is the selection, drawn as such. */
  selectedKey: string | null,
): PathsLayer | null {
  const { worldWidth, worldHeight } = map;
  // Behind a ref: the heightmap arrives after the scene does, and rebuilding the
  // layer every time the reader changes identity would flicker the paths.
  const ground = useRef(groundAt);
  ground.current = groundAt;

  const [layer, setLayer] = useState<PathsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createPathsLayer({
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `groundAt` is not read here, it is the signal that the relief the lines follow has arrived
  useEffect(() => {
    layer?.draw(sources, activeId, selectedKey);
  }, [layer, sources, activeId, selectedKey, groundAt]);

  return layer;
}
