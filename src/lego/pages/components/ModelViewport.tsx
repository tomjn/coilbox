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

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { useReduceMotion } from "../../../general/display";
import { addStandardLights, partMaterial } from "../../geometry";
import type { LegoProject } from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";

interface Props {
  pack: LoadedPack;
  project: LegoProject;
  selectedId: string | null;
  onSelect: (pieceId: string | null) => void;
  /** Handed the canvas so the page can save a thumbnail from it. */
  onReady?: (canvas: HTMLCanvasElement) => void;
}

export function ModelViewport({
  pack,
  project,
  selectedId,
  onSelect,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const reduceMotion = useReduceMotion();

  // The scene is built once and never rebuilt on a prop change, because that
  // would reset the camera mid-edit. Callbacks therefore go through refs rather
  // than being captured, or the handler would keep calling the first ones it saw.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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

    const state: SceneState = {
      renderer,
      scene,
      camera,
      controls,
      root,
      outline,
      groups: new Map(),
      render,
    };
    sceneRef.current = state;

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
    } else {
      state.outline.visible = false;
    }
    state.render();
  }, [selectedId]);

  return <div ref={containerRef} className="h-full w-full" />;
}

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Group;
  outline: THREE.BoxHelper;
  /** Piece id to the group holding it, so selection and edits can find it. */
  groups: Map<string, THREE.Group>;
  render: () => void;
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
