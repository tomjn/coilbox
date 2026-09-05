/**
 * Wiring the ground a base's buildings stand on into the map scene.
 *
 * The same lifecycle as the start positions: built once per scene and per map,
 * redrawn when the footprints, or the relief they lie on, change. Nothing is
 * returned, because nothing points at this layer. It is not pickable.
 */

import { useEffect, useRef, useState } from "react";

import type { FootprintMark } from "@/blueprint/footprint";
import { useReduceMotion } from "@/general/display";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import {
  createFootprintsLayer,
  type FootprintsLayer,
  type MarkAs,
} from "./footprintsLayer";

export function useScenarioFootprints(
  handle: MapScene3D | null,
  marks: FootprintMark[],
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
  /** What these marks are about. A second layer drawn `"offered"` is where a
   *  turn would put the selected building (issue #1541). */
  as: MarkAs = "standing",
  /** Which of them the author has selected, whose square says so (issue
   *  #1716). Only the document's own squares have one. */
  selected: string | null = null,
): void {
  const { worldWidth, worldHeight } = map;
  // Behind a ref for the same reason the starts' reader is: the heightmap
  // arrives after the scene does, and rebuilding the layer every time the reader
  // changes identity would flicker the squares.
  const ground = useRef(groundAt);
  ground.current = groundAt;
  // Read through a ref too: a preference changed while the editor is open is a
  // reason to stop moving, not a reason to rebuild the layer.
  const still = useRef(false);
  still.current = useReduceMotion();

  const [layer, setLayer] = useState<FootprintsLayer | null>(null);
  useEffect(() => {
    if (!handle) return;
    const built = createFootprintsLayer({
      handle,
      worldWidth,
      worldHeight,
      groundAt: (pos) => ground.current(pos),
      // The document's own squares fade in as a building is put down and out as
      // one is deleted (issue #1716). A spot being offered does not: it is
      // drawn while a button is under the pointer and taken down when it is
      // not, and it has to keep up with that rather than trail behind it.
      arriving: as === "standing",
      motion: () => !still.current,
    });
    setLayer(built);
    return () => {
      built.dispose();
      setLayer(null);
      handle.render();
    };
  }, [handle, worldWidth, worldHeight, as]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `groundAt` is not read here, it is the signal that the relief the footprints lie on has arrived
  useEffect(() => {
    layer?.draw(marks, as, selected);
  }, [layer, marks, as, selected, groundAt]);
}
