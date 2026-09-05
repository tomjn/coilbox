/**
 * The map's own camera.
 *
 * `useMapCamera` is the scene once `PlacementSurface` has built it, which
 * every other layer on the map is built from, so it has to exist before any
 * of them do. `useCameraMovement` is the two ways of moving the view that are
 * not a drag, kept apart because both need `groundAt`, and that only exists
 * once the units layer has been built from the scene this hook hands out -
 * later in the render than the scene itself. `sceneRef` threads the two
 * together the same way `selection.ts` threads a ref between the factories
 * that share one.
 */

import { type RefObject, useCallback, useRef, useState } from "react";

import type { MapScene3D } from "@/lib/mapScene";
import { clampToMap } from "@/placement/pointer";
import {
  focusCamera,
  focusDistance,
  sceneToWorld,
  worldToScene,
} from "@/placement/scene";
import type { Point } from "../../model";
import type { MapCursor } from "./useMapKeyboard";

export interface MapCamera {
  sceneRef: RefObject<MapScene3D | null>;
  handle: MapScene3D | null;
  onScene: (handle: MapScene3D | null) => void;
}

export function useMapCamera(): MapCamera {
  const sceneRef = useRef<MapScene3D | null>(null);
  // Also held in state, because the units layer is built from it and a ref
  // does not re-render the hook that owns that layer.
  const [handle, setHandle] = useState<MapScene3D | null>(null);

  const onScene = useCallback((handle: MapScene3D | null) => {
    sceneRef.current = handle;
    setHandle(handle);
  }, []);

  return { sceneRef, handle, onScene };
}

export interface CameraMovement {
  /**
   * Look closely at a point on the map.
   *
   * The camera is put where it would be if the author had zoomed in on the
   * place themselves, rather than moved along a path: what matters is
   * arriving, and a scene this heavy is not one to animate a flight across.
   */
  focusOn: (pos: Point, span: number) => void;
  /**
   * The point the view is looking at, which is what the keyboard aims with
   * (issue #2269).
   *
   * The camera's own target rather than a cursor of its own: it is already on
   * screen, already held over the map by the surface, and already the thing
   * the Frame button and the contents list move. One cursor, moved by
   * everything that moves the view.
   */
  cursorAt: () => MapCursor | null;
  /** Move that point, camera and all, and draw the one frame it needs. The
   *  surface's own clamp catches the edges of the map, off the change the
   *  controls fire. */
  panBy: (delta: Point) => void;
}

export function useCameraMovement(
  sceneRef: RefObject<MapScene3D | null>,
  map: { worldWidth: number; worldHeight: number },
  groundAt: (pos: Point) => number,
): CameraMovement {
  const { worldWidth, worldHeight } = map;

  const focusOn = useCallback(
    (pos: Point, span: number) => {
      const handle = sceneRef.current;
      if (!handle) return;
      const { camera, controls, render, scale } = handle;
      const at = worldToScene(pos, worldWidth, worldHeight, scale);
      const distance = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, focusDistance(span) * scale),
      );
      // Looked at where it stands rather than at sea level, or a thing on a
      // ridge would arrive at the top of the view and one in a valley below it.
      const height = groundAt(pos) * scale;
      const stand = focusCamera(at, distance);
      controls.target.set(at.x, height, at.z);
      camera.position.set(stand.x, height + stand.y, stand.z);
      controls.update();
      render();
    },
    [sceneRef, worldWidth, worldHeight, groundAt],
  );

  const cursorAt = useCallback((): MapCursor | null => {
    const handle = sceneRef.current;
    if (!handle) return null;
    const { target } = handle.controls;
    const pos = clampToMap(
      sceneToWorld(
        { x: target.x, z: target.z },
        worldWidth,
        worldHeight,
        handle.scale,
      ),
      worldWidth,
      worldHeight,
    );
    return { pos, height: groundAt(pos) };
  }, [sceneRef, worldWidth, worldHeight, groundAt]);

  const panBy = useCallback(
    (delta: Point) => {
      const handle = sceneRef.current;
      if (!handle) return;
      const { camera, controls, render, scale } = handle;
      const step = { x: delta.x * scale, z: delta.z * scale };
      controls.target.x += step.x;
      controls.target.z += step.z;
      camera.position.x += step.x;
      camera.position.z += step.z;
      controls.update();
      render();
    },
    [sceneRef],
  );

  return { focusOn, cursorAt, panBy };
}
