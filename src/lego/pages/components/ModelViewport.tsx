/**
 * The unit as it is being assembled.
 *
 * The scene graph mirrors the piece hierarchy one to one: a `Group` per piece,
 * carrying a `Mesh` when the piece has a part. While editing, each group holds
 * the piece's own position, rotation and scale, which is what the gizmo writes
 * back to and what reparenting moves.
 *
 * Playback swaps that for the baked form the format actually stores: rotation
 * and scale folded into each piece's vertices, groups carrying a translation
 * and nothing else. See `showBaked`. That is the only shape in which animation
 * behaves as the engine's does.
 *
 * Lifecycle follows MapPreview3D: build once, mutate in place, render on
 * demand, and dispose everything. Rebuilding on every edit would throw away the
 * shared geometry cache and the camera position with it.
 */

import { Button } from "@picoframe/frame";
import { Move, RotateCw, Scaling } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useReduceMotion } from "../../../general/display";
import { type AnimPreset, presetById } from "../../animPresets";
import { addStandardLights, partMaterial } from "../../geometry";
import { descendantIds, type LegoPiece, type LegoProject } from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import { type BakedPiece, bakedPieces } from "../../s3oBuild";
import {
  localAnchors,
  nearestSnap,
  snapRotation,
  type Vec3,
} from "../../snapping";

export type GizmoMode = "translate" | "rotate" | "scale";

/** Buttons as well as keys, so turning a piece is not a keyboard secret. */
const MODES: {
  id: GizmoMode;
  label: string;
  key: string;
  Icon: typeof Move;
}[] = [
  { id: "translate", label: "Move", key: "G", Icon: Move },
  { id: "rotate", label: "Turn", key: "R", Icon: RotateCw },
  { id: "scale", label: "Scale", key: "S", Icon: Scaling },
];

/**
 * The dots drawn on a selected piece.
 *
 * The origin is a different colour from the snap anchors because it means
 * something else: it is where the piece turns and where its children hang,
 * while the anchors are where it seats against its neighbours.
 */
const ORIGIN_COLOUR = 0x8b5cf6;
const FACE_COLOUR = 0x38bdf8;
const CORNER_COLOUR = 0xfbbf24;
/**
 * Dot sizes in CSS pixels, constant however far the camera is.
 *
 * Small: a part can carry fifteen of these and they have to sit on the model
 * rather than cover it. The origin is drawn larger because there is one of it
 * and it is the one you go looking for.
 */
const ANCHOR_DOT = 4;
const ORIGIN_DOT = 9;

/** How close two anchors must be before a piece seats against another. */
const SNAP_DISTANCE = 0.45;
/** Rotation lands on 15 degree steps unless snapping is held off. */
const ROTATION_STEP = Math.PI / 12;

interface Props {
  pack: LoadedPack;
  project: LegoProject;
  selectedId: string | null;
  onSelect: (pieceId: string | null) => void;
  /** Committed when a drag ends, not on every frame of it. */
  onTransform: (pieceId: string, change: Partial<LegoPiece>) => void;
  /** Handed the canvas so the page can save a thumbnail from it. */
  onReady?: (canvas: HTMLCanvasElement) => void;
  /** Runs the applied presets. Nothing is written: stopping restores the rest
   *  pose exactly, because it comes back from the document. */
  playing?: boolean;
  /** Scale handles keep the piece's proportions. */
  uniformScale?: boolean;
}

export function ModelViewport({
  pack,
  project,
  selectedId,
  onSelect,
  onTransform,
  onReady,
  playing = false,
  uniformScale = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const reduceMotion = useReduceMotion();
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [snapped, setSnapped] = useState(false);

  // The scene is built once and never rebuilt on a prop change, because that
  // would reset the camera mid-edit. Callbacks therefore go through refs rather
  // than being captured, or the handler would keep calling the first ones it saw.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;
  // The gizmo reads the document every frame of a drag to find what to snap
  // against, and a stale copy would snap to where pieces used to be.
  const projectRef = useRef(project);
  projectRef.current = project;
  const packRef = useRef(pack);
  packRef.current = pack;

  // Built once. Everything after this mutates the scene rather than remaking it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    addStandardLights(scene);

    // Units stand on y = 0, so the grid is the ground the engine will use.
    const grid = new THREE.GridHelper(40, 40, 0x556070, 0x2c333f);
    scene.add(grid);

    const root = new THREE.Group();
    scene.add(root);

    const outline = new THREE.BoxHelper(root, 0x8b5cf6);
    outline.visible = false;
    scene.add(outline);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
    camera.position.set(9, 7, 11);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduceMotion;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 1;
    controls.maxDistance = 120;

    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSpace("local");
    scene.add(gizmo.getHelper());

    const state: SceneState = {
      renderer,
      scene,
      camera,
      controls,
      gizmo,
      root,
      outline,
      groups: new Map(),
      baked: [],
      rest: new Map(),
      uniformScale: false,
      anchors: null,
      dots: dotMaterial(ANCHOR_DOT, renderer.getPixelRatio(), true),
      originDot: dotMaterial(ORIGIN_DOT, renderer.getPixelRatio(), false),
      render,
      snapping: true,
      onSnapChange: () => {},
      projectRef,
      packRef,
      onTransformRef,
    };
    sceneRef.current = state;

    // `mouseDown` and `mouseUp`, not `dragging-changed`: this version of
    // TransformControls does not dispatch that one, so listening for it left
    // orbit running during a drag, and never wrote the moved transform back.
    // The next edit then resynced the scene from a document that still had
    // every piece at the origin.
    gizmo.addEventListener("mouseDown", () => {
      controls.enabled = false;
    });
    gizmo.addEventListener("mouseUp", () => {
      controls.enabled = true;
      commitGizmo(state);
    });

    gizmo.addEventListener("objectChange", () => {
      forceUniformScale(state);
      applySnap(state);
      state.outline.setFromObject(gizmo.object ?? root);
      render();
    });

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    if (!reduceMotion) {
      const tick = () => {
        controls.update();
        render();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    // Selection happens on release, not on press, and only when the pointer
    // barely moved. Selecting on press meant a click that missed a gizmo handle
    // by a pixel cleared the selection and detached the gizmo before the drag
    // could start, and dragging empty space to orbit cleared it too.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pressedAt: { x: number; y: number } | null = null;
    let pressedOnGizmo = false;

    const onPointerDown = (event: PointerEvent) => {
      pressedAt = { x: event.clientX, y: event.clientY };
      // Whether a handle was grabbed has to be read now rather than on release.
      // TransformControls registered its listeners on this canvas first, so its
      // pointerdown has already set these, and its pointerup clears them again
      // before this handler's pointerup would ever see them.
      pressedOnGizmo = gizmo.dragging || gizmo.axis !== null;
    };
    const onPointerUp = (event: PointerEvent) => {
      const from = pressedAt;
      const onGizmo = pressedOnGizmo;
      pressedAt = null;
      pressedOnGizmo = false;
      if (!from || onGizmo) return;
      // Anything past a few pixels was an orbit or a drag, not a click.
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4)
        return;

      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(root, true)[0];
      onSelectRef.current(pieceIdOf(hit?.object ?? null));
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    onReadyRef.current?.(renderer.domElement);

    return () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
      gizmo.dispose();
      clearAnchors(state);
      state.dots.dispose();
      state.originDot.dispose();
      disposeBaked(state);
      grid.dispose();
      outline.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [reduceMotion]);

  // Structure and transforms both land here, because a piece added and a piece
  // moved are the same operation on the same map. While playing, the bake goes
  // back over the top: changing an animation's parameters must not drop the
  // scene back to its unbaked form mid-cycle.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    syncScene(state, pack, project);
    if (playing && !reduceMotion) showBaked(state, pack, project);
    state.render();
  }, [pack, project, playing, reduceMotion]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const group = selectedId ? state.groups.get(selectedId) : undefined;
    if (group) {
      state.outline.setFromObject(group);
      state.outline.visible = true;
      // The root has nothing to move relative to, so it gets no handles.
      if (selectedId === projectRef.current.rootPieceId) {
        state.gizmo.detach();
      } else {
        state.gizmo.attach(group);
      }
    } else {
      state.outline.visible = false;
      state.gizmo.detach();
    }
    state.render();
  }, [selectedId]);

  // Declared after the scene sync, so the group a new piece needs already
  // exists by the time this looks for it. Playback clears them: the baked scene
  // has no pivot left to point at.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showAnchors(state, pack, project, playing ? null : selectedId);
    state.render();
  }, [pack, project, selectedId, playing]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.gizmo.setMode(mode);
    state.render();
  }, [mode]);

  useEffect(() => {
    const state = sceneRef.current;
    if (state) state.uniformScale = uniformScale;
  }, [uniformScale]);

  // Playback. The gizmo comes off first: it would be dragging a transform that
  // is overwritten on the next frame. Stopping puts the scene back from the
  // document, which is the rest pose by definition.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !playing || reduceMotion) return;

    state.gizmo.detach();
    showBaked(state, packRef.current, projectRef.current);
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      applyAnimation(state, projectRef.current, (now - started) / 1000);
      state.render();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      const current = sceneRef.current;
      if (!current) return;
      disposeBaked(current);
      syncScene(current, packRef.current, projectRef.current);
      const group = selectedId ? current.groups.get(selectedId) : undefined;
      if (group && selectedId !== projectRef.current.rootPieceId) {
        current.gizmo.attach(group);
      }
      current.render();
    };
  }, [playing, reduceMotion, selectedId]);

  useEffect(() => {
    const state = sceneRef.current;
    if (state) state.onSnapChange = setSnapped;
  }, []);

  // Held rather than toggled: snapping is on, and letting go of it is a
  // deliberate act for the one piece that has to sit off the grid.
  useEffect(() => {
    const setSnapping = (on: boolean) => {
      const state = sceneRef.current;
      if (state) state.snapping = on;
    };
    const down = (event: KeyboardEvent) => {
      if (event.altKey) setSnapping(false);
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "g") setMode("translate");
      if (event.key === "r") setMode("rotate");
      if (event.key === "s") setMode("scale");
    };
    const up = (event: KeyboardEvent) => {
      if (!event.altKey) setSnapping(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    // Darker than the page behind it, so the unit reads as being in its own
    // space and pale parts have something to sit against. A translucent tint
    // rather than a fixed colour, so it deepens whatever the theme is.
    <div className="relative h-full w-full bg-black/30">
      <div ref={containerRef} className="h-full w-full" />

      {/* Down the left edge and vertically centred, out of the way of the
          unit's own chrome at the top of the view. */}
      <TooltipProvider delayDuration={300}>
        <ButtonGroup
          orientation="vertical"
          className="absolute left-3 top-1/2 -translate-y-1/2"
        >
          {MODES.map(({ id, label, key, Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant={mode === id ? "default" : "outline"}
                  onClick={() => setMode(id)}
                  aria-label={label}
                  aria-pressed={mode === id}
                >
                  <Icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {label} ({key})
              </TooltipContent>
            </Tooltip>
          ))}
        </ButtonGroup>
      </TooltipProvider>

      {/* Notes and the key sit at the bottom, where they can be read when
          wanted and ignored when not. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-xs text-muted-foreground">
        {selectedId && !playing ? (
          <div className="flex gap-3">
            <Dot colour="#8b5cf6" label="Turns here" />
            <Dot colour="#38bdf8" label="Faces" />
            <Dot colour="#fbbf24" label="Corners" />
          </div>
        ) : null}
        <span>
          {snapped
            ? "Snapped. Hold Alt to place freely"
            : "Hold Alt to place freely"}
        </span>
      </div>
    </div>
  );
}

/** A key to the dots drawn on the selected piece. */
function Dot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  root: THREE.Group;
  outline: THREE.BoxHelper;
  /** Piece id to the group holding it, so selection and edits can find it. */
  groups: Map<string, THREE.Group>;
  /** Geometry built for playback, which this owns and must free. The shared
   *  part cache is not ours to dispose. */
  baked: THREE.BufferGeometry[];
  /** Read during a drag, so the lock can be toggled mid-session. */
  uniformScale: boolean;
  /** The selected piece's origin and anchors, or nothing when none is. */
  anchors: THREE.Group | null;
  /** Small dots for the snap anchors, coloured per vertex by kind. */
  dots: THREE.PointsMaterial;
  /** A larger dot for the origin, which is one point and a different idea. */
  originDot: THREE.PointsMaterial;
  /** Each piece's baked offset while playing, the pose deltas are added to. */
  rest: Map<string, [number, number, number]>;
  render: () => void;
  snapping: boolean;
  onSnapChange: (snapped: boolean) => void;
  /** Read during a drag, so the helpers see the current document, not the one
   *  the scene was built with. */
  projectRef: { current: LegoProject };
  packRef: { current: LoadedPack };
  onTransformRef: {
    current: (pieceId: string, change: Partial<LegoPiece>) => void;
  };
}

/**
 * Every anchor of a piece, in world space.
 *
 * A piece with no part has only its own origin, which is what makes an empty
 * piece something you can still seat against a corner.
 */
function worldAnchors(
  state: SceneState,
  pack: LoadedPack,
  piece: LegoPiece,
): Vec3[] {
  const group = state.groups.get(piece.id);
  if (!group) return [];
  group.updateWorldMatrix(true, false);

  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  // Anchors come from the part's bounding box, which is in part space, so they
  // shift with the pivot exactly as the geometry does.
  const pivot = piece.pivot ?? [0, 0, 0];
  const local = part
    ? localAnchors(part.bbox).map(
        (anchor) =>
          [
            anchor.position[0] - pivot[0],
            anchor.position[1] - pivot[1],
            anchor.position[2] - pivot[2],
          ] as Vec3,
      )
    : [[0, 0, 0] as Vec3];

  const point = new THREE.Vector3();
  return local.map((position) => {
    point
      .set(position[0], position[1], position[2])
      .applyMatrix4(group.matrixWorld);
    return [point.x, point.y, point.z] as Vec3;
  });
}

/**
 * Hold a piece's proportions while a scale handle is dragged.
 *
 * `TransformControls` scales one axis per handle. With the lock on, the axis
 * the pointer actually moved sets a ratio and all three follow it, so a part
 * keeps its shape and only its size changes.
 */
function forceUniformScale(state: SceneState) {
  if (!state.uniformScale || state.gizmo.getMode() !== "scale") return;
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  const piece = state.projectRef.current.pieces.find((p) => p.id === pieceId);
  if (!piece) return;

  // The axis furthest from unchanged is the one being dragged.
  let ratio = 1;
  for (let axis = 0; axis < 3; axis++) {
    const from = piece.scale[axis] || 1;
    const candidate = group.scale.getComponent(axis) / from;
    if (Math.abs(candidate - 1) > Math.abs(ratio - 1)) ratio = candidate;
  }
  group.scale.set(
    piece.scale[0] * ratio,
    piece.scale[1] * ratio,
    piece.scale[2] * ratio,
  );
}

/**
 * Seat the dragged piece against the nearest anchor of any other piece.
 *
 * Applied live rather than on release, so the piece visibly clicks into place
 * and there is no jump at the end of a drag. Rotation lands on 15 degree steps
 * for the same reason.
 */
function applySnap(state: SceneState) {
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  const project = state.projectRef.current;
  const pack = state.packRef.current;
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece) return;

  if (!state.snapping) {
    state.onSnapChange(false);
    return;
  }

  if (state.gizmo.getMode() === "rotate") {
    const snappedRotation = snapRotation(
      [group.rotation.x, group.rotation.y, group.rotation.z],
      ROTATION_STEP,
    );
    group.rotation.set(...snappedRotation);
    state.onSnapChange(true);
    return;
  }
  if (state.gizmo.getMode() !== "translate") {
    state.onSnapChange(false);
    return;
  }

  // A piece never snaps to itself or to anything hanging off it, or dragging a
  // parent would try to seat it against the children it is carrying.
  const own = new Set(descendantIds(project, pieceId));
  const targets: Vec3[] = [];
  for (const other of project.pieces) {
    if (own.has(other.id)) continue;
    targets.push(...worldAnchors(state, pack, other));
  }

  const snap = nearestSnap(
    worldAnchors(state, pack, piece),
    targets,
    SNAP_DISTANCE,
  );
  state.onSnapChange(snap !== null);
  if (!snap) return;

  // The delta is in world space and the group's position is relative to its
  // parent, so it has to be rotated into the parent's frame before it is added.
  const delta = new THREE.Vector3(...snap.delta);
  const parent = group.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix3()
      .setFromMatrix4(parent.matrixWorld)
      .invert();
    delta.applyMatrix3(inverse);
  }
  group.position.add(delta);
}

/**
 * Rebuild the scene as the format stores it: rigid geometry at a translation.
 *
 * A piece's rotation and scale go into its own vertices, exactly as the s3o
 * writer does and as Upspring does on save. Nothing is left for a child to
 * inherit, so turning a piece turns it and its children rigidly, which is all
 * the engine can do. Animating the unbaked document instead re-applies an
 * ancestor's scale to a turning child every frame, which pulls the mesh about.
 *
 * Only used for playback. Editing keeps the document's own transforms on the
 * groups, because that is what the gizmo writes back to.
 */
function showBaked(state: SceneState, pack: LoadedPack, project: LegoProject) {
  // Baking again on every change to the document, so freeing what the last
  // bake built belongs here rather than only at the end of playback.
  disposeBaked(state);
  const { pieces } = bakedPieces(project, pack);

  for (const [pieceId, baked] of pieces) {
    const group = state.groups.get(pieceId);
    if (!group) continue;

    group.position.set(...baked.offset);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    state.rest.set(pieceId, baked.offset);

    const mesh = group.children.find((child) => child instanceof THREE.Mesh) as
      | THREE.Mesh
      | undefined;
    if (baked.vertices.length === 0) {
      mesh?.removeFromParent();
      continue;
    }

    const geometry = bakedGeometry(baked);
    state.baked.push(geometry);
    if (mesh) {
      mesh.geometry = geometry;
      // Baked vertices already sit around the origin, so the offset the
      // editing scene puts on the mesh has to come back off.
      mesh.position.set(0, 0, 0);
    } else {
      const added = new THREE.Mesh(geometry, partMaterial(pack.manifest));
      added.userData.pieceId = pieceId;
      group.add(added);
    }
  }
}

function bakedGeometry(baked: BakedPiece): THREE.BufferGeometry {
  const positions = new Float32Array(baked.vertices.length * 3);
  const normals = new Float32Array(baked.vertices.length * 3);
  const uvs = new Float32Array(baked.vertices.length * 2);
  baked.vertices.forEach((vertex, i) => {
    positions.set(vertex.pos, i * 3);
    normals.set(vertex.normal, i * 3);
    uvs.set(vertex.uv, i * 2);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(baked.indices), 1),
  );
  return geometry;
}

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

function dotMaterial(
  size: number,
  pixelRatio: number,
  vertexColours: boolean,
): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    // `gl_PointSize` is in device pixels, so the ratio has to come back out or
    // the dots halve on a retina display.
    size: size * pixelRatio,
    sizeAttenuation: false,
    vertexColors: vertexColours,
    color: vertexColours ? 0xffffff : ORIGIN_COLOUR,
    map: circleSprite(),
    alphaTest: 0.5,
    depthTest: false,
    transparent: true,
  });
}

/**
 * Draw the selected piece's origin and its snap anchors.
 *
 * The dots are a child of the piece's group, so they follow it without being
 * repositioned, and they sit in part space alongside the mesh, which is why
 * the pivot comes off them exactly as it comes off the geometry.
 *
 * `depthTest` is off: the origin is usually inside the part, and a marker you
 * cannot see is no marker at all.
 */
function showAnchors(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string | null,
) {
  clearAnchors(state);
  if (!pieceId) return;

  const piece = project.pieces.find((p) => p.id === pieceId);
  const group = state.groups.get(pieceId);
  if (!piece || !group) return;

  const pivot = piece.pivot ?? [0, 0, 0];
  const marks = new THREE.Group();

  // The origin is its own object, drawn larger. There is one of it, and it is
  // the one you go looking for.
  marks.add(points([0, 0, 0], null, state.originDot));

  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  if (part) {
    const positions: number[] = [];
    const colours: number[] = [];
    for (const anchor of localAnchors(part.bbox)) {
      if (anchor.kind === "centre" && pivot.every((value) => value === 0)) {
        // The middle and the origin coincide, and two dots in one place read
        // as one dot of the wrong colour.
        continue;
      }
      positions.push(
        anchor.position[0] - pivot[0],
        anchor.position[1] - pivot[1],
        anchor.position[2] - pivot[2],
      );
      const colour = new THREE.Color(
        anchor.kind === "corner" ? CORNER_COLOUR : FACE_COLOUR,
      );
      colours.push(colour.r, colour.g, colour.b);
    }
    marks.add(points(positions, colours, state.dots));
  }

  group.add(marks);
  state.anchors = marks;
}

function points(
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

function clearAnchors(state: SceneState) {
  state.anchors?.traverse((object) => {
    if (object instanceof THREE.Points) object.geometry.dispose();
  });
  state.anchors?.removeFromParent();
  state.anchors = null;
}

/** Free the geometry playback built. The shared part cache is untouched. */
function disposeBaked(state: SceneState) {
  for (const geometry of state.baked) geometry.dispose();
  state.baked = [];
  state.rest = new Map();
}

/**
 * Pose every animated piece for one moment in time.
 *
 * Each piece sits at its baked offset and takes the sum of every applied
 * preset's delta as a rotation about its own origin, so two presets touching
 * the same piece add up rather than one winning.
 */
function applyAnimation(state: SceneState, project: LegoProject, t: number) {
  const applied = (project.animations ?? [])
    .map((entry) => ({
      preset: presetById(entry.presetId),
      params: entry.params,
    }))
    .filter(
      (
        entry,
      ): entry is { preset: AnimPreset; params: Record<string, number> } =>
        entry.preset !== undefined,
    );
  if (applied.length === 0) return;

  for (const piece of project.pieces) {
    if (!piece.role) continue;
    const group = state.groups.get(piece.id);
    const offset = state.rest.get(piece.id);
    if (!group || !offset) continue;

    // From the baked pose, not the document's: the geometry already carries
    // the piece's own rotation and scale, so a delta is a plain turn about
    // its origin, which is the only thing the engine does.
    const position: Vec3 = [...offset];
    const rotation: Vec3 = [0, 0, 0];
    for (const { preset, params } of applied) {
      const delta = preset.track(t, params, piece.role);
      if (!delta) continue;
      for (let axis = 0; axis < 3; axis++) {
        position[axis] += delta.position?.[axis] ?? 0;
        rotation[axis] += delta.rotation?.[axis] ?? 0;
      }
    }
    group.position.set(...position);
    group.rotation.set(...rotation);
  }
}

/** Write the dragged transform back to the document, once the drag is over. */
function commitGizmo(state: SceneState) {
  const group = state.gizmo.object;
  const pieceId = group ? pieceIdOf(group) : null;
  if (!group || !pieceId) return;

  state.onTransformRef.current(pieceId, {
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  });
  state.onSnapChange(false);
}

/** Walk up until something claims a piece, since a hit lands on the mesh. */
function pieceIdOf(object: THREE.Object3D | null): string | null {
  let at: THREE.Object3D | null = object;
  while (at) {
    const id = at.userData.pieceId;
    if (typeof id === "string") return id;
    at = at.parent;
  }
  return null;
}

/**
 * Make the scene match the document.
 *
 * Groups are reused across edits, so moving a piece does not rebuild its
 * geometry and the renderer keeps its uploaded buffers.
 */
function syncScene(state: SceneState, pack: LoadedPack, project: LegoProject) {
  const wanted = new Set(project.pieces.map((piece) => piece.id));

  for (const [id, group] of state.groups) {
    if (wanted.has(id)) continue;
    group.removeFromParent();
    state.groups.delete(id);
  }

  // Every group first, then the parenting. The document does not promise that
  // a parent comes before its children, and reparenting a piece leaves it
  // wherever it already was in the array. Doing both in one pass hung any
  // piece whose parent came later off the scene root instead, until some
  // later edit happened to sync again.
  for (const piece of project.pieces) {
    if (state.groups.has(piece.id)) continue;
    const group = new THREE.Group();
    group.userData.pieceId = piece.id;
    state.groups.set(piece.id, group);
  }

  for (const piece of project.pieces) {
    const group = state.groups.get(piece.id) as THREE.Group;

    // Reparent before transforming, so a piece that moved branch and position
    // in one edit ends up in the right place.
    const parent = piece.parentId
      ? state.groups.get(piece.parentId)
      : undefined;
    const target = parent ?? state.root;
    if (group.parent !== target) target.add(group);

    group.position.set(...piece.position);
    group.rotation.set(...piece.rotation);
    group.scale.set(...piece.scale);
    group.visible = piece.hidden !== true;

    const geometry = piece.partId ? getPartGeometry(pack, piece.partId) : null;
    const mesh = group.children.find((child) => child instanceof THREE.Mesh) as
      | THREE.Mesh
      | undefined;

    if (!geometry) {
      // An empty piece: a hierarchy node, a flare, an aim point. It has no
      // geometry by design, and still carries its children.
      mesh?.removeFromParent();
      continue;
    }
    // The mesh sits back from the piece's origin by its pivot, so the origin
    // is the point the piece turns about rather than the part's middle.
    const pivot = piece.pivot ?? [0, 0, 0];
    if (mesh) {
      mesh.geometry = geometry;
      mesh.position.set(-pivot[0], -pivot[1], -pivot[2]);
    } else {
      const added = new THREE.Mesh(geometry, partMaterial(pack.manifest));
      added.userData.pieceId = piece.id;
      added.position.set(-pivot[0], -pivot[1], -pivot[2]);
      group.add(added);
    }
  }
}
