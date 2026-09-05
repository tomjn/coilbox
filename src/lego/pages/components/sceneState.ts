import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { unitAtlas } from "../../atlas";
import {
  type BackdropId,
  backdropById,
  buildTerrain,
  type GroundId,
  skyTexture,
} from "../../environment";
import { importedMaterial, partMaterial } from "../../geometry";
import type { PieceTransform } from "../../groupTransform";
import type { LegoCollisionVolume, LegoPiece, LegoProject } from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import { seatPieceMesh } from "../../pivot";
import { getMeshGeometry, type RawGeometry } from "../../rawGeometry";
import type { Vec3 } from "../../snapping";
import type { CollisionFaceDrag } from "./collisionHandles";

export interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  root: THREE.Group;
  /** What the gizmo drags for a set: an empty object at the set's midpoint.
   *  Never in the document, never exported. */
  groupPivot: THREE.Object3D;
  /** Where that pivot was put when the set was selected, which is the point a
   *  group drag is measured from and turns about. */
  groupPivotAt: Vec3;
  /** The pieces a group drag writes to: the selection's own roots. */
  groupIds: string[];
  /** What the drag in progress has worked out for them, ready to commit. */
  groupChanges: Map<string, PieceTransform>;
  /** The hovered piece's outline and face wash, drawn the same way as a
   *  selected piece's but in a different colour and never both on one piece. */
  hoverOutline: THREE.BoxHelper;
  hoverOverlay: THREE.Mesh;
  /** A violet box and face wash per selected piece. Pooled rather than made
   *  per selection: a set is selected and cleared constantly, and a fresh
   *  BoxHelper each time would leak its geometry. */
  selectOutlines: THREE.BoxHelper[];
  selectOverlays: THREE.Mesh[];
  selectOverlayMaterial: THREE.MeshBasicMaterial;
  /** The groups those outlines are on, so a drag can refresh them without
   *  looking the selection up again. */
  selectedGroups: THREE.Group[];
  /** The piece currently under the pointer, in this view or the sidebar tree.
   *  Never a hidden piece, and never the selected piece: see `applyHoverVisual`. */
  hoveredId: string | null;
  /** The ground and the compass, both of which can be switched off. The ground
   *  is replaced when it has to reach further, so it is held here rather than
   *  captured. */
  grid: THREE.Group;
  /** How many footprint steps that ground reaches each way, so it is only
   *  rebuilt when the answer actually changes. */
  groundSteps: number;
  axes: THREE.AxesHelper;
  /** A scale figure beside the build, switched off by default. A view aid
   *  like `grid` and `axes`: never part of the project, never exported.
   *  Replaced wholesale when the figure changes, since a unit read out of a
   *  game is a different object with different materials. */
  reference: THREE.Group;
  /** Frees whichever figure `reference` currently is. */
  disposeReference: () => void;
  /** The collision volume's wireframe, while it is being shown. Rebuilt on
   *  every change rather than rescaled, because the shape itself changes with
   *  the volume's type, and null the rest of the time. */
  collision: THREE.LineSegments | null;
  collisionMaterial: THREE.LineBasicMaterial;
  /** Whether the gizmo is on the volume rather than on the selected piece. */
  editCollision: boolean;
  /** A grab plate on each of the six faces, which is how a volume is sized.
   *  Built with the scene and moved onto whichever box is being edited, the
   *  unit's own or one piece's. */
  collisionHandles: THREE.Group;
  collisionHandleMaterial: THREE.MeshBasicMaterial;
  /** The same plate under the pointer, or being dragged. */
  collisionHandleHotMaterial: THREE.MeshBasicMaterial;
  /** The same pair again in the piece boxes' colour, so the plates say which
   *  of the two shapes they are about to size. */
  pieceHandleMaterial: THREE.MeshBasicMaterial;
  pieceHandleHotMaterial: THREE.MeshBasicMaterial;
  /** The face drag in progress, or null while nothing is being sized. */
  collisionDrag: CollisionFaceDrag | null;
  onCollisionChangeRef: {
    current: ((volume: LegoCollisionVolume) => void) | undefined;
  };
  /** A box per piece, while the unit is hit piece by piece and the volume is
   *  being shown. Null the rest of the time, including for a unit that leaves
   *  piece collision off. */
  pieceCollision: THREE.Group | null;
  pieceCollisionMaterial: THREE.LineBasicMaterial;
  /** The wide-line material the edited piece's box draws with. */
  pieceEditMaterial: LineMaterial;
  /** Each drawn piece box by piece id, so the handles and the gizmo can find
   *  the one being edited without walking the group. A piece switched out of
   *  the hit test draws nothing and is absent here. */
  pieceCollisionBoxes: Map<string, THREE.Object3D>;
  /** The piece whose box has the handles, or null when the unit's own volume
   *  has them. Set by the panel, so it never outlives the fields explaining it. */
  editPieceId: string | null;
  onPieceVolumeChangeRef: {
    current:
      | ((pieceId: string, volume: LegoCollisionVolume) => void)
      | undefined;
  };
  /** Whether the gizmo is on the aim point, which the aim panel decides. */
  editAim: boolean;
  onAimChangeRef: {
    current: ((mid: [number, number, number]) => void) | undefined;
  };
  /** The dot on the unit's aim point. Built with the scene and moved, since it
   *  is one point wherever it is and there is nothing to rebuild. */
  aimMark: THREE.Points;
  /** The sky now drawn, and which backdrop built it, so going back to one
   *  already seen does not draw its gradient again. Null while the plain
   *  backdrop shows, which is what the canvas does with no background at all. */
  sky: { id: BackdropId; texture: THREE.Texture } | null;
  /** The solid ground, built the first time it is asked for and kept after
   *  that. A view aid like the grid. */
  terrain: THREE.Mesh | null;
  /** Piece id to the group holding it, so selection and edits can find it. */
  groups: Map<string, THREE.Group>;
  /** Geometry built for playback, which this owns and must free. The shared
   *  part cache is not ours to dispose. */
  baked: THREE.BufferGeometry[];
  /** The material an imported unit draws with, and the key of the textures it
   *  was built from, so a refreshed texture is noticed and the version before
   *  it is freed. Owned here rather than cached globally: only this view draws
   *  one, and a content-addressed store mints a new key on every refresh. */
  imported: {
    key: string;
    material: THREE.MeshStandardMaterial;
    dispose: () => void;
  } | null;
  /** Read during a drag, so the lock can be toggled mid-session. */
  uniformScale: boolean;
  /** The selected piece's origin and anchors, or nothing when none is. */
  anchors: THREE.Group | null;
  /** Every other piece's anchors, shown only while something is being dragged. */
  targetAnchors: THREE.Points | null;
  /** A dot on the pair that seated, and a box round the piece it seated to. */
  seatMark: THREE.Points;
  seatOutline: THREE.BoxHelper;
  /** Small dots for the snap anchors, coloured per vertex by kind. */
  dots: THREE.PointsMaterial;
  /** A larger dot for the origin, which is one point and a different idea. */
  originDot: THREE.PointsMaterial;
  /** Each piece's baked offset while playing, the pose deltas are added to. */
  rest: Map<string, [number, number, number]>;
  render: () => void;
  /** Whether the whole unit has already been framed once for this scene, so
   *  the builder opens with the unit in view but a later edit never fights a
   *  camera the user has since moved. Fresh per scene build (a unit switch
   *  remounts the page, and the reduce-motion toggle rebuilds this state too),
   *  so each one gets its own opening frame. */
  framed: boolean;
  snapping: boolean;
  /** Both plain values rather than one object: this fires on every frame of a
   *  drag, and an object would be a fresh identity each time and a re-render
   *  with it. */
  onSnapChange: (snapped: boolean, anchorName?: string) => void;
  /** Read during a drag, so the helpers see the current document, not the one
   *  the scene was built with. */
  projectRef: { current: LegoProject };
  packRef: { current: LoadedPack };
  rawRef: { current: RawGeometry | null };
  /** Whether the next click on the model drops an anchor rather than selecting,
   *  and what to do when it does. Read from the pointer handler, which is
   *  registered once and would otherwise only ever see the first values. */
  placingAnchorRef: { current: boolean };
  onPlaceAnchorRef: {
    current: ((pieceId: string, position: Vec3) => void) | undefined;
  };
  onCancelAnchorRef: { current: (() => void) | undefined };
  onTransformRef: {
    current: (pieceId: string, change: Partial<LegoPiece>) => void;
  };
  onTransformManyRef: {
    current: (changes: Map<string, PieceTransform>) => void;
  };
  /** The latest selection, so hover code can skip a piece that is already
   *  selected without waiting for a render to see the new prop. */
  selectedIdsRef: { current: string[] };
  onHoverRef: { current: ((pieceId: string | null) => void) | undefined };
}

/**
 * Put the chosen sky behind the scene, or take it away again.
 *
 * The plain backdrop leaves the scene with no background at all, so the canvas
 * stays transparent and the panel's own tint shows through, which is what the
 * builder has always looked like.
 */
export function applyBackdrop(state: SceneState, id: BackdropId) {
  if (state.sky?.id === id) return;
  state.sky?.texture.dispose();
  state.sky = null;

  const texture = skyTexture(backdropById(id));
  state.scene.background = texture;
  if (texture) state.sky = { id, texture };
}

/** Put the solid ground under the markings, or take it away again. */
export function applyGround(state: SceneState, id: GroundId) {
  if (id !== "terrain") {
    state.terrain?.removeFromParent();
    return;
  }
  if (!state.terrain) state.terrain = buildTerrain();
  state.scene.add(state.terrain);
}

/**
 * The material the whole unit draws with.
 *
 * One material for every piece, either way. A unit built out of parts samples
 * the atlas it names, shared with the pickers. A unit imported from somebody
 * else's model samples its own texture, which only this view draws, so this
 * owns it and frees the one before it when the textures change. That is what
 * makes refreshing a texture edited outside coilbox show up: the key is the
 * content, so new bytes are a new key and a new material.
 */
export function unitMaterial(
  state: Pick<SceneState, "imported">,
  pack: LoadedPack,
  project: LegoProject,
): THREE.MeshStandardMaterial {
  const imported = project.imported;
  if (!imported) {
    return partMaterial(unitAtlas(project, pack.library.atlases).drawWith);
  }
  const key = `${imported.texture?.key ?? ""}|${imported.texture2?.key ?? ""}`;
  if (state.imported?.key === key) return state.imported.material;
  state.imported?.dispose();
  state.imported = { key, ...importedMaterial(imported) };
  return state.imported.material;
}

/** The geometry a piece draws, out of the pack or out of an imported model. */
function pieceGeometry(
  pack: LoadedPack,
  raw: RawGeometry | null,
  piece: LegoPiece,
): THREE.BufferGeometry | null {
  if (raw && piece.meshId) return getMeshGeometry(raw, piece.meshId);
  return piece.partId ? getPartGeometry(pack, piece.partId) : null;
}

/**
 * The whole of the scene that mirroring the document reaches for.
 *
 * Named and exported because none of it is drawing: the hierarchy this builds
 * is the same with or without a WebGL context behind it, so it can be checked
 * without one. See `ModelViewport.dom.test.tsx`.
 */
export type SceneGraph = Pick<
  SceneState,
  "root" | "groups" | "gizmo" | "imported"
>;

/**
 * Make the scene match the document.
 *
 * Groups are reused across edits, so moving a piece does not rebuild its
 * geometry and the renderer keeps its uploaded buffers.
 */
export function syncScene(
  state: SceneGraph,
  pack: LoadedPack,
  raw: RawGeometry | null,
  project: LegoProject,
) {
  const wanted = new Set(project.pieces.map((piece) => piece.id));
  const material = unitMaterial(state, pack, project);

  for (const [id, group] of state.groups) {
    if (wanted.has(id)) continue;
    // The gizmo has to come off before the group leaves the scene graph, or
    // TransformControls warns on the next render that its object is gone.
    // This is the only place a group's removal is decided, so it is the only
    // place that can know to detach.
    if (state.gizmo.object === group) state.gizmo.detach();
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

    const geometry = pieceGeometry(pack, raw, piece);
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
      // Reassigned rather than left as it was, because the unit's atlas can
      // change under a mesh that already exists.
      mesh.material = material;
      seatPieceMesh(mesh, piece.pivot);
    } else {
      const added = new THREE.Mesh(geometry, material);
      added.userData.pieceId = piece.id;
      seatPieceMesh(added, piece.pivot);
      group.add(added);
    }
  }
}
