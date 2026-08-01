/**
 * The paths a group's orders draw on the editor's map.
 *
 * A move, a patrol or a fight order is a list of points and nothing else, so it
 * is drawn as a line from where the group stands through the points in turn,
 * following the ground under it. A patrol is drawn as a loop, because that is
 * what the engine does with one: the first patrol point given to a standing unit
 * closes the circuit back to where it is standing, so a patrol runs between the
 * group's position and the points the author drew.
 *
 * Every group's paths are drawn, the selected group's brighter and with a knob
 * on each waypoint. Only those knobs carry a `placementKey`, so a line an author
 * is not working on cannot be grabbed by accident, and the shared picking in
 * `useMapEditing` sees the knobs the same way it sees units and zone handles.
 *
 * The arithmetic, what a drag does to a waypoint, is in `groups.ts`.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Point, ScenarioGroup } from "../../model";
import { drapePoints, orderWaypoints, parsePathKey, pathKey } from "./groups";
import { worldToScene } from "./scene";

/** What a scenario's paths are drawn under, so the layer can be found and
 *  removed as one thing. */
const ROOT_NAME = "scenario-paths";

/** How far above the ground a path is drawn, in elmos. Clear of the terrain the
 *  shader draws, which this only samples. */
const LIFT_ELMOS = 10;

/** How far apart a line is sampled onto the terrain, in elmos. About a screen's
 *  worth of detail on a 4km map framed whole, and cheap: a path is a handful of
 *  points, not a mesh. */
const SAMPLE_ELMOS = 96;

/** How wide a waypoint knob is drawn, in elmos. The same size as a zone's resize
 *  handle, so both are grabbable at the zoom the whole map is framed at. */
const HANDLE_ELMOS = 88;

/** What a path is drawn in: bright for the group being worked on, muted for the
 *  rest, so a map full of groups still reads. */
const PATH_COLOR = 0x86efac;
const IDLE_COLOR = 0x94a3b8;
const SELECTED_COLOR = 0xfacc15;

export interface PathsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
}

export interface PathsLayer {
  /** The group every drawn path hangs off, for raycasting against. */
  root: THREE.Group;
  /** Whether this layer owns a picked key, which is what tells the pointer layer
   *  that a hit was a waypoint rather than a unit. */
  has: (key: string) => boolean;
  /**
   * Draw these groups' paths, replacing whatever was drawn before.
   * `selectedGroupId` gets the brighter line and the waypoint knobs, and
   * `selectedKey` is the one knob drawn as the selection.
   */
  draw: (
    groups: ScenarioGroup[],
    selectedGroupId: string | null,
    selectedKey: string | null,
  ) => void;
  /** Show a drag in progress: the waypoint this key names, moved by `delta`,
   *  without touching the document. Undone by the next `draw`. */
  drag: (key: string, delta: Point) => void;
  dispose: () => void;
}

export function createPathsLayer(deps: PathsLayerDeps): PathsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** What is on screen, so a drag can redraw one waypoint against what it
   *  started as rather than accumulating. */
  let drawn: ScenarioGroup[] = [];
  let selectedGroupId: string | null = null;
  let selectedKey: string | null = null;
  const keys = new Set<string>();
  /** Everything one pass allocated, so the next pass can free it. */
  let owned: { dispose: () => void }[] = [];

  /** An engine position as a point in the scene, lifted onto the ground. */
  const at = (pos: Point): THREE.Vector3 => {
    const scene = worldToScene(
      pos,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    return new THREE.Vector3(
      scene.x,
      (deps.groundAt(pos) + LIFT_ELMOS) * handle.scale,
      scene.z,
    );
  };

  /** One order's path: the line, and a knob per waypoint when the group it
   *  belongs to is the one being worked on. */
  const buildPath = (
    group: ScenarioGroup,
    order: number,
    waypoints: Point[],
    loop: boolean,
    selected: boolean,
  ): THREE.Group | null => {
    if (waypoints.length === 0) return null;
    const out = new THREE.Group();
    const colour = selected ? PATH_COLOR : IDLE_COLOR;

    const points = drapePoints(
      [group.pos, ...waypoints],
      SAMPLE_ELMOS,
      loop,
    ).map(at);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: colour,
      transparent: true,
      // Depth is ignored so a path behind a ridge is still followable, which is
      // the whole reason for drawing it.
      depthTest: false,
      opacity: selected ? 0.95 : 0.45,
    });
    const line = loop
      ? new THREE.LineLoop(lineGeometry, lineMaterial)
      : new THREE.Line(lineGeometry, lineMaterial);
    line.renderOrder = 3;
    out.add(line);
    owned.push(lineGeometry, lineMaterial);

    if (selected) {
      const knobGeometry = new THREE.SphereGeometry(
        (HANDLE_ELMOS / 2) * handle.scale,
        12,
        8,
      );
      const knobMaterial = new THREE.MeshBasicMaterial({
        color: PATH_COLOR,
        depthTest: false,
      });
      const pickedMaterial = new THREE.MeshBasicMaterial({
        color: SELECTED_COLOR,
        depthTest: false,
      });
      owned.push(knobGeometry, knobMaterial, pickedMaterial);
      waypoints.forEach((waypoint, index) => {
        const key = pathKey(group.id, order, index);
        const knob = new THREE.Mesh(
          knobGeometry,
          key === selectedKey ? pickedMaterial : knobMaterial,
        );
        knob.position.copy(at(waypoint));
        knob.renderOrder = 4;
        knob.userData = { placementKey: key };
        out.add(knob);
        keys.add(key);
      });
    }

    return out;
  };

  const render = (groups: ScenarioGroup[], selectedId: string | null) => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
    keys.clear();
    for (const group of groups) {
      group.orders.forEach((order, index) => {
        const waypoints = orderWaypoints(order);
        if (!waypoints) return;
        const path = buildPath(
          group,
          index,
          waypoints,
          order.kind === "patrol",
          group.id === selectedId,
        );
        if (path) root.add(path);
      });
    }
    handle.render();
  };

  return {
    root,
    has: (key: string) => keys.has(key),
    draw: (groups, groupId, key) => {
      drawn = groups;
      selectedGroupId = groupId;
      selectedKey = key;
      render(groups, groupId);
    },
    drag: (key, delta) => {
      const ref = parsePathKey(key);
      if (!ref) return;
      render(
        drawn.map((group) => {
          if (group.id !== ref.groupId) return group;
          const order = group.orders[ref.order];
          if (!order || !("waypoints" in order)) return group;
          const moved = order.waypoints.map((point, i) =>
            i === ref.waypoint
              ? { x: point.x + delta.x, z: point.z + delta.z }
              : point,
          );
          const orders = group.orders.slice();
          orders[ref.order] = { ...order, waypoints: moved };
          return { ...group, orders };
        }),
        selectedGroupId,
      );
    },
    dispose: () => {
      root.clear();
      for (const spent of owned) spent.dispose();
      owned = [];
      keys.clear();
      root.removeFromParent();
    },
  };
}
