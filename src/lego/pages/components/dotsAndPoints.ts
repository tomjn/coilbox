import * as THREE from "three";

import { ORIGIN_COLOUR } from "./ModelViewport";

/**
 * A round dot rather than the square a point sprite draws by default.
 *
 * Squares read as blocks of the model at this size, and a grid of them on a
 * boxy part is unreadable. One canvas, drawn once, shared by every dot.
 */
let dotSprite: THREE.Texture | null = null;

function circleSprite(): THREE.Texture {
  if (dotSprite) return dotSprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    context.fillStyle = "#fff";
    context.fill();
    // A dark rim, so a pale dot still reads against a pale part.
    context.lineWidth = 4;
    context.strokeStyle = "rgba(0,0,0,0.65)";
    context.stroke();
  }
  dotSprite = new THREE.CanvasTexture(canvas);
  return dotSprite;
}

export function dotMaterial(
  size: number,
  pixelRatio: number,
  vertexColours: boolean,
  colour: number = ORIGIN_COLOUR,
): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    // `gl_PointSize` is in device pixels, so the ratio has to come back out or
    // the dots halve on a retina display.
    size: size * pixelRatio,
    sizeAttenuation: false,
    vertexColors: vertexColours,
    color: vertexColours ? 0xffffff : colour,
    map: circleSprite(),
    alphaTest: 0.5,
    depthTest: false,
    transparent: true,
  });
}

export function points(
  positions: number[],
  colours: number[] | null,
  material: THREE.PointsMaterial,
): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (colours) {
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colours, 3),
    );
  }
  const object = new THREE.Points(geometry, material);
  object.renderOrder = 2;
  // Not selectable: a click has to fall through to the piece behind it.
  object.raycast = () => {};
  return object;
}
