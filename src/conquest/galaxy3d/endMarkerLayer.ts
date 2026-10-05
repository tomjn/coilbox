import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import {
  BADGE_RADIUS,
  CAPITAL_SCALE,
  markerZoom,
  POLE_RADII,
} from "./cityLayer";
import { endMarkersToDraw, type RunEnd } from "./endMarkers";
import type { PlacedModelsLayer } from "./placedModelsLayer";
import type { TerrainSurface } from "./terrain";

/**
 * The start and the goal of a run across a land map: a pole on the
 * location's anchor, with a pennant for the start and a diamond for the goal.
 * The two differ in shape as well as colour, and stand the same on a
 * province and on a city, where the head flies above the city's badge. Each
 * takes the colour the document gives its location, which for a run is the
 * colour of the start and of the warlord. Like the badges, the markers grow
 * with the camera's distance, so they keep much the same size on screen.
 */

/**
 * How near a placed model must stand to a location's anchor to take the
 * marker's place, in world units: about the middle of a capital's town.
 */
export const END_MARKER_RADIUS = 1.6875;

/**
 * How far the head reaches from the pole, in world units at the closest
 * zoom: a little wider than a capital's badge.
 */
const HEAD_REACH = BADGE_RADIUS * CAPITAL_SCALE * 1.5;

/**
 * The tallest a city's badge reaches at the closest zoom: a selected
 * capital's, which is 1.3 times a capital's, to the edge of its ring, which
 * reaches 1.3 times the badge.
 */
export const BADGE_TOP =
  BADGE_RADIUS * (POLE_RADII + CAPITAL_SCALE * 1.3 * 1.3);

/** The pole's height, so the head clears the tallest badge. */
const POLE_HEIGHT = BADGE_TOP + HEAD_REACH * 0.9;
const POLE_RADIUS = 0.03;
/** The pennant is as long as the head's reach and this share of it tall. */
const PENNANT_HEIGHT = 0.6;
/** The diamond's half width, as a share of the head's reach. */
const DIAMOND_RADIUS = 0.5;

const POLE_COLOR = 0xf4f1e6;

/**
 * How near a placed model must stand to a location's anchor to take the
 * marker's place, in map units: {@link END_MARKER_RADIUS}. A model inside it
 * stands where the marker would be drawn. One outside it stands clear of the
 * marker, so both can show.
 */
export function endMarkerReach(surface: Pick<TerrainSurface, "scale">): number {
  return END_MARKER_RADIUS / surface.scale;
}

export interface EndMarkerLayer {
  /**
   * Keep the markers a readable size at every zoom, as the city badges are
   * kept. `distance` is from the camera to its target.
   */
  fitToCamera: (distance: number) => void;
}

/**
 * Build the markers into `scene`. Returns `undefined`, and adds nothing, when
 * no location is an end, or when every end has a model drawNow on it and
 * there is no model layer to wait on.
 *
 * With a model layer, an end that has a model drawNow on it gets its marker
 * after the models have settled if every model on it failed to load, so the
 * location is never left with neither. `renderRef` redraws when that happens.
 */
export function buildEndMarkerLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: Pick<GalaxyDoc, "nodes" | "models">,
  surface: TerrainSurface,
  ends: ReadonlyMap<string, { end?: RunEnd }>,
  ownerColor: (owner: string | undefined) => THREE.Color,
  placed?: Pick<PlacedModelsLayer, "failed" | "settled">,
  renderRef?: { current: (() => void) | null },
): EndMarkerLayer | undefined {
  const reach = endMarkerReach(surface);
  const markers = endMarkersToDraw(galaxy.nodes, ends, undefined, reach);
  const drawNow = new Set(
    endMarkersToDraw(galaxy.nodes, ends, galaxy.models, reach).map((m) => m.id),
  );
  if (markers.length === 0 || (drawNow.size === 0 && !placed)) {
    return undefined;
  }

  const poleGeo = new THREE.CylinderGeometry(
    POLE_RADIUS,
    POLE_RADIUS,
    POLE_HEIGHT,
    8,
  );
  poleGeo.translate(0, POLE_HEIGHT / 2, 0);
  const poleMat = new THREE.MeshBasicMaterial({ color: POLE_COLOR });
  // A flat triangle flying east from the top of the pole.
  const pennantGeo = new THREE.BufferGeometry();
  const drop = HEAD_REACH * PENNANT_HEIGHT;
  pennantGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0,
        POLE_HEIGHT,
        0,
        0,
        POLE_HEIGHT - drop,
        0,
        HEAD_REACH,
        POLE_HEIGHT - drop / 2,
        0,
      ],
      3,
    ),
  );
  const diamondGeo = new THREE.OctahedronGeometry(HEAD_REACH * DIAMOND_RADIUS);
  diamondGeo.translate(0, POLE_HEIGHT, 0);
  disposables.push(poleGeo, poleMat, pennantGeo, diamondGeo);

  const groups: THREE.Group[] = [];
  const byId = new Map<string, THREE.Group>();
  for (const marker of markers) {
    const headMat = new THREE.MeshBasicMaterial({
      color: ownerColor(galaxy.nodes[marker.nodeIndex].owner),
      side: THREE.DoubleSide,
    });
    disposables.push(headMat);
    const group = new THREE.Group();
    group.name = `end-marker:${marker.end}:${marker.id}`;
    group.position.set(...surface.mapToWorld(marker.pos[0], marker.pos[1]));
    const pole = new THREE.Mesh(poleGeo, poleMat);
    const head = new THREE.Mesh(
      marker.end === "start" ? pennantGeo : diamondGeo,
      headMat,
    );
    // The location under the marker is what the pointer picks.
    pole.raycast = () => {};
    head.raycast = () => {};
    // The marker turns to face the camera as a city's badge does, so its pole
    // runs up the screen and the head flies clear above the badge even when
    // the map is seen from straight above.
    const face: THREE.Object3D["onBeforeRender"] = (_r, _s, camera) => {
      group.quaternion.copy(camera.quaternion);
      group.updateMatrixWorld(true);
    };
    pole.onBeforeRender = face;
    head.onBeforeRender = face;
    group.add(pole, head);
    groups.push(group);
    byId.set(marker.id, group);
    if (drawNow.has(marker.id)) scene.add(group);
  }

  if (placed) {
    let disposed = false;
    disposables.push({
      dispose: () => {
        disposed = true;
      },
    });
    void placed.settled.then(() => {
      if (disposed) return;
      const failed = new Set(placed.failed);
      let added = false;
      for (const m of endMarkersToDraw(
        galaxy.nodes,
        ends,
        galaxy.models,
        reach,
        failed,
      )) {
        const group = byId.get(m.id);
        if (!group || group.parent) continue;
        scene.add(group);
        added = true;
      }
      if (added) renderRef?.current?.();
    });
  }

  let zoom = 1;
  return {
    fitToCamera: (distance) => {
      const next = markerZoom(distance);
      if (Math.abs(next - zoom) < 0.01 * zoom) return;
      zoom = next;
      for (const group of groups) group.scale.setScalar(zoom);
    },
  };
}
