import * as THREE from "three";
import type { GalaxyDoc } from "../model";
import { CAPITAL_SCALE, MARKER_RADIUS } from "./cityLayer";
import { endMarkersToDraw, type RunEnd } from "./endMarkers";
import { GALAXY_MAX_DISTANCE, type TerrainSurface } from "./terrain";

/**
 * The start and the goal of a run across a land map: a pole standing on the
 * location's anchor, with a pennant for the start and a diamond for the goal.
 * The two differ in shape as well as colour, and stand the same on a
 * province and on a city. Each takes the colour the document gives its
 * location, which for a run is the colour of the start and of the warlord.
 *
 * Shapes and sizes are design values chosen without seeing them on screen.
 */

/**
 * How far a marker reaches from its pole, in world units. It is the radius of
 * a capital's block in `cityLayer.ts`, and both ends of a run are capitals, so
 * a marker is as wide as the block it stands on and no wider.
 */
export const END_MARKER_RADIUS = MARKER_RADIUS * CAPITAL_SCALE;

/**
 * The pole's height in world units. The head sits above a capital's block at
 * its largest: two tiers 2.1 high, times 1.25 for a capital, times 1.36 at
 * the top of the selection pulse, is 3.57.
 */
const POLE_HEIGHT = 5.4;
const POLE_RADIUS = 0.09;
/** The pennant is as long as the marker's reach and this share of it tall. */
const PENNANT_HEIGHT = 0.6;
/** The diamond's half width, as a share of the marker's reach. */
const DIAMOND_RADIUS = 0.5;

const POLE_COLOR = 0xf4f1e6;

/**
 * How near a placed model must stand to a location's anchor to take the
 * marker's place, in map units: the marker's own reach. A model inside it
 * stands where the marker would be drawn. One outside it stands clear of the
 * marker, so both can show.
 */
export function endMarkerReach(surface: Pick<TerrainSurface, "scale">): number {
  return END_MARKER_RADIUS / surface.scale;
}

export interface EndMarkerLayer {
  /**
   * Keep the markers a readable size past the galaxy view's furthest zoom, as
   * the city markers are kept. `distance` is from the camera to its target.
   */
  fitToCamera: (distance: number) => void;
}

/**
 * Build the markers into `scene`. Returns `undefined`, and adds nothing, when
 * no location is an end or every end has a model standing on it.
 */
export function buildEndMarkerLayer(
  scene: THREE.Scene,
  disposables: { dispose(): void }[],
  galaxy: Pick<GalaxyDoc, "nodes" | "models">,
  surface: TerrainSurface,
  ends: ReadonlyMap<string, { end?: RunEnd }>,
  ownerColor: (owner: string | undefined) => THREE.Color,
): EndMarkerLayer | undefined {
  const markers = endMarkersToDraw(
    galaxy.nodes,
    ends,
    galaxy.models,
    endMarkerReach(surface),
  );
  if (markers.length === 0) return undefined;

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
  const drop = END_MARKER_RADIUS * PENNANT_HEIGHT;
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
        END_MARKER_RADIUS,
        POLE_HEIGHT - drop / 2,
        0,
      ],
      3,
    ),
  );
  const diamondGeo = new THREE.OctahedronGeometry(
    END_MARKER_RADIUS * DIAMOND_RADIUS,
  );
  diamondGeo.translate(0, POLE_HEIGHT, 0);
  disposables.push(poleGeo, poleMat, pennantGeo, diamondGeo);

  const groups: THREE.Group[] = [];
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
    group.add(pole, head);
    scene.add(group);
    groups.push(group);
  }

  let zoom = 1;
  return {
    fitToCamera: (distance) => {
      const next = Math.max(1, distance / GALAXY_MAX_DISTANCE);
      if (Math.abs(next - zoom) < 0.01) return;
      zoom = next;
      for (const group of groups) group.scale.setScalar(zoom);
    },
  };
}
