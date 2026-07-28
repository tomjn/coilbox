/**
 * The unit as it is being assembled.
 *
 * The scene graph mirrors the piece hierarchy one to one: a `Group` per piece,
 * carrying a `Mesh` when the piece has a part. That means a piece's transform is
 * applied by three exactly as the engine will apply it, so what is on screen is
 * what gets exported, and reparenting is a `Group` move rather than maths.
 *
 * Lifecycle follows MapPreview3D: build once, mutate in place, render on
 * demand, and dispose everything. Rebuilding on every edit would throw away the
 * shared geometry cache and the camera position with it.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

import { useReduceMotion } from "../../../general/display";
import { addStandardLights, partMaterial } from "../../geometry";
import { descendantIds, type LegoPiece, type LegoProject } from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import {
  localAnchors,
  nearestSnap,
  snapRotation,
  type Vec3,
} from "../../snapping";

export type GizmoMode = "translate" | "rotate" | "scale";

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
}

export function ModelViewport({
  pack,
  project,
  selectedId,
  onSelect,
  onTransform,
  onReady,
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
      render,
      snapping: true,
      onSnapChange: () => {},
      projectRef,
      packRef,
      onTransformRef,
    };
    sceneRef.current = state;

    // Orbiting while dragging a handle would fight the drag.
    gizmo.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
      if (!event.value) commitGizmo(state);
    });

    gizmo.addEventListener("objectChange", () => {
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

    // Clicking empty space clears the selection, which is how you get back to
    // editing the unit as a whole.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      // The gizmo shares this canvas, so a click on one of its handles would
      // otherwise select whatever happens to be behind it and abandon the drag.
      if (gizmo.dragging || gizmo.axis !== null) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(root, true)[0];
      onSelectRef.current(pieceIdOf(hit?.object ?? null));
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    onReadyRef.current?.(renderer.domElement);

    return () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      gizmo.detach();
      gizmo.getHelper().removeFromParent();
      gizmo.dispose();
      grid.dispose();
      outline.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [reduceMotion]);

  // Structure and transforms both land here, because a piece added and a piece
  // moved are the same operation on the same map.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    syncScene(state, pack, project);
    state.render();
  }, [pack, project]);

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

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.gizmo.setMode(mode);
    state.render();
  }, [mode]);

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
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          {mode === "translate" ? "Move" : mode === "rotate" ? "Turn" : "Scale"}
          {" · G, R, S"}
        </span>
        <span>
          {snapped
            ? "Snapped, hold Alt to place freely"
            : "Hold Alt to place freely"}
        </span>
      </div>
    </div>
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
  const local = part
    ? localAnchors(part.bbox).map((anchor) => anchor.position)
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

  for (const piece of project.pieces) {
    let group = state.groups.get(piece.id);
    if (!group) {
      group = new THREE.Group();
      group.userData.pieceId = piece.id;
      state.groups.set(piece.id, group);
    }

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
    if (mesh) {
      mesh.geometry = geometry;
    } else {
      const added = new THREE.Mesh(geometry, partMaterial(pack.manifest));
      added.userData.pieceId = piece.id;
      group.add(added);
    }
  }
}
