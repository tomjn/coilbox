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

/**
 * A face's own square and a corner's own cube, rather than a dot at each.
 *
 * A dot says where an anchor is and nothing about what it is. A square lying
 * in the face it marks, and a cube with one corner on the corner it marks,
 * say which surface a piece will seat against before anything is dragged.
 *
 * Both hold a size on screen rather than in the world, as the dots do. Sized
 * against the piece instead, a commander gets markers the size of its arms
 * while a bolt gets ones nobody can see, and neither is easier to aim at for
 * being drawn to scale.
 *
 * Shared and never disposed, like the dot sprite. There is one of each, and
 * `clearAnchors` takes the instances rather than these.
 */
const unitSquare = new THREE.PlaneGeometry(1, 1);
const unitCube = new THREE.BoxGeometry(1, 1, 1);
const unitCubeEdges = new THREE.EdgesGeometry(unitCube);

/** The +Z a `PlaneGeometry` faces before it is turned to face the axis it
 *  marks. */
const PLANE_FACES = new THREE.Vector3(0, 0, 1);

const markMaterials = new Map<number, THREE.MeshBasicMaterial>();

function markMaterial(colour: number): THREE.MeshBasicMaterial {
  const existing = markMaterials.get(colour);
  if (existing) return existing;
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    side: THREE.DoubleSide,
    // Through the piece, as the dots are: these are guides to aim at, and one
    // hidden inside the model is one nobody can use.
    depthTest: false,
    depthWrite: false,
  });
  markMaterials.set(colour, material);
  return material;
}

/** The dark outline that makes a cube read as a cube rather than a blob, the
 *  same rim the dot sprite draws for the same reason. */
let edgeMaterial: THREE.LineBasicMaterial | null = null;

function markEdges(): THREE.LineBasicMaterial {
  edgeMaterial ??= new THREE.LineBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.65,
    depthTest: false,
    depthWrite: false,
  });
  return edgeMaterial;
}

const markWorld = new THREE.Vector3();
const markParentScale = new THREE.Vector3();
const markViewport = new THREE.Vector2();
const markLocal = new THREE.Vector3();

/**
 * Hold `mesh` at `pixels` across however far away the camera is.
 *
 * Set in `onBeforeRender` and the matrix rebuilt by hand, because three reads
 * `matrixWorld` for the model-view matrix straight after this returns. A
 * scale left for the next frame would lag the camera by one.
 *
 * The parent's own scale comes back out per axis, so a marker stays square on
 * a piece someone has stretched, and stays the same size on screen as one on
 * a piece they have not.
 *
 * `place` puts the mesh where the size it has just been given wants it, which
 * is the corner cube stepping inward by half of itself. It is handed that
 * half in the piece's own units, since that is the frame the position is in.
 */
function screenSized(
  mesh: THREE.Mesh,
  pixels: number,
  place: (half: THREE.Vector3) => void,
) {
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    markWorld.setFromMatrixPosition(mesh.matrixWorld);
    const distance = camera.position.distanceTo(markWorld);
    const height = Math.max(renderer.getSize(markViewport).y, 1);
    const world =
      (pixels * (2 * distance * Math.tan((camera.fov * Math.PI) / 360))) /
      height;

    mesh.parent?.getWorldScale(markParentScale);
    markLocal.set(
      world / (markParentScale.x || 1),
      world / (markParentScale.y || 1),
      world / (markParentScale.z || 1),
    );
    mesh.scale.copy(markLocal);
    place(markLocal.multiplyScalar(0.5));
    mesh.updateMatrixWorld(true);
  };
}

/** How wide each marker is drawn on screen. A square is flat, so it needs the
 *  larger figure to read as firmly as a cube of the same width. */
const FACE_PIXELS = 16;
const CORNER_PIXELS = 9;

/** A square lying in the plane of the face at `position`, whose outward normal
 *  is `out`. */
export function faceMark(
  position: THREE.Vector3Like,
  out: THREE.Vector3Like,
  colour: number,
): THREE.Object3D {
  const mesh = new THREE.Mesh(unitSquare, markMaterial(colour));
  mesh.position.set(position.x, position.y, position.z);
  mesh.quaternion.setFromUnitVectors(
    PLANE_FACES,
    new THREE.Vector3(out.x, out.y, out.z).normalize(),
  );
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  screenSized(mesh, FACE_PIXELS, () => {});
  return mesh;
}

/** A cube with one of its own corners on the corner at `position`, sitting
 *  inside the box rather than hanging off it: `out` is the way the corner
 *  points, so the cube goes the other way. */
export function cornerMark(
  position: THREE.Vector3Like,
  out: THREE.Vector3Like,
  colour: number,
): THREE.Object3D {
  const mesh = new THREE.Mesh(unitCube, markMaterial(colour));
  const step = {
    x: Math.sign(out.x),
    y: Math.sign(out.y),
    z: Math.sign(out.z),
  };
  mesh.position.set(position.x, position.y, position.z);
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  screenSized(mesh, CORNER_PIXELS, (half) => {
    mesh.position.set(
      position.x - step.x * half.x,
      position.y - step.y * half.y,
      position.z - step.z * half.z,
    );
  });

  const edges = new THREE.LineSegments(unitCubeEdges, markEdges());
  edges.renderOrder = 3;
  edges.raycast = () => {};
  mesh.add(edges);
  return mesh;
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
