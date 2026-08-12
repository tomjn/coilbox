/**
 * The map's start positions, drawn on the editor's map.
 *
 * An author placing units on bare terrain has nothing to measure against. The
 * start positions are the one fixed thing every map carries, so they are drawn
 * as a ring on the ground with a post and a label above it, tall enough to be
 * found from the framing zoom and drawn through the terrain so one behind a
 * ridge is still readable.
 *
 * Nothing here carries a `placementKey` and this layer is not handed to
 * `useMapEditing` as an overlay, so a start position cannot be clicked. That is
 * deliberate: it belongs to the map rather than to the document, and a marker
 * that swallowed clicks would be a patch of map nothing could be placed on.
 *
 * Which participant is on which position is `startPositions.ts`, which is
 * tested. This file is the drawing.
 */

import * as THREE from "three";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { worldToScene } from "@/placement/scene";
import type { Point } from "../../model";
import { markerLabel, type StartMarker } from "./startPositions";

/** What the start positions are drawn under, so they can be found and removed
 *  as one thing. */
const ROOT_NAME = "scenario-start-positions";

/** How wide the ring on the ground is, in elmos. Wide enough to read as a place
 *  rather than a point at the zoom the whole map is framed at. */
const RING_ELMOS = 170;

/** How tall the post is, in elmos. A commander is about 60 elmos across, so
 *  this stands well clear of anything an author puts beside it. */
const POST_ELMOS = 420;

/** How tall the label is drawn, in elmos. */
const LABEL_ELMOS = 190;

/** A position nobody spawns on. Deliberately colourless: every coloured marker
 *  on the map is a participant. */
const BARE_COLOR = "#e2e8f0";

/** How high the ring floats above the ground, in elmos, so it clears the relief
 *  the shader draws rather than sinking into it. */
const LIFT_ELMOS = 6;

export interface StartsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's ground height in elmos at an engine position. */
  groundAt: (pos: Point) => number;
}

export interface StartsLayer {
  root: THREE.Group;
  /** Draw this list, replacing whatever was drawn before. */
  draw: (markers: StartMarker[]) => void;
  dispose: () => void;
}

/** A label as a texture, with the aspect it should be drawn at. Canvas text is
 *  the only text three.js draws without a font loader. */
function labelTexture(
  text: string,
  colour: string,
): { texture: THREE.CanvasTexture; aspect: number } {
  const size = 64;
  const pad = size * 0.4;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { texture: new THREE.CanvasTexture(canvas), aspect: 1 };

  const font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width + pad * 2);
  const height = Math.ceil(size + pad * 2);
  canvas.width = width;
  canvas.height = height;

  // Sizing the canvas resets the context, so everything is set again here.
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(9, 13, 22, 0.72)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colour;
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}

export function createStartsLayer(deps: StartsLayerDeps): StartsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** Everything one pass allocated, so the next pass can free it. */
  let owned: { dispose: () => void }[] = [];

  const buildMarker = (marker: StartMarker): THREE.Group => {
    const colour = marker.spawn?.colorHex ?? BARE_COLOR;
    const group = new THREE.Group();
    const at = worldToScene(
      marker.pos,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    group.position.set(
      at.x,
      (deps.groundAt(marker.pos) + LIFT_ELMOS) * handle.scale,
      at.z,
    );
    // Everything below is in elmos, so the whole marker takes the elmo scale.
    group.scale.setScalar(handle.scale);

    const ringGeometry = new THREE.RingGeometry(
      RING_ELMOS * 0.72,
      RING_ELMOS,
      40,
    );
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: colour,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.renderOrder = 3;
    group.add(ring);

    const postGeometry = new THREE.CylinderGeometry(6, 6, POST_ELMOS, 6);
    const postMaterial = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.y = POST_ELMOS / 2;
    post.renderOrder = 3;
    group.add(post);

    const { texture, aspect } = labelTexture(markerLabel(marker), colour);
    const labelMaterial = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(LABEL_ELMOS * aspect, LABEL_ELMOS, 1);
    label.position.y = POST_ELMOS + LABEL_ELMOS * 0.6;
    label.renderOrder = 4;
    group.add(label);

    owned.push(
      ringGeometry,
      ringMaterial,
      postGeometry,
      postMaterial,
      texture,
      labelMaterial,
    );
    return group;
  };

  const clear = () => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
  };

  return {
    root,
    draw: (markers) => {
      clear();
      for (const marker of markers) root.add(buildMarker(marker));
      handle.render();
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
