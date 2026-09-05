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
import {
  ArrowDownToLine,
  Box,
  ClipboardPaste,
  Copy,
  Crosshair,
  FlipHorizontal2,
  Keyboard,
  Move,
  PackagePlus,
  RotateCw,
  Scaling,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GridToggle,
  ViewButton,
  ViewControls,
  ViewToggle,
} from "@/components/ViewControls";
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { aimPoint } from "../../aimPoint";
import { unitAtlas } from "../../atlas";
import {
  buildFrontMarker,
  buildGround,
  disposeFrontMarker,
  disposeGround,
  groundSteps,
  REFERENCE_PARK_X,
} from "../../buildPlate";
import {
  effectiveCollisionVolume,
  engineScales,
  pieceCollisionVolumes,
} from "../../collisionVolume";
import {
  type BackdropId,
  backdropById,
  buildTerrain,
  disposeTerrain,
  type GroundId,
  skyTexture,
} from "../../environment";
import { frameBox } from "../../framing";
import {
  addStandardLights,
  importedMaterial,
  partMaterial,
} from "../../geometry";
import {
  groupPivot,
  groupTransform,
  type PieceTransform,
  transformRoots,
} from "../../groupTransform";
import {
  isEffectivelyHidden,
  type LegoCollisionVolume,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import { seatPieceMesh } from "../../pivot";
import { getMeshGeometry, type RawGeometry } from "../../rawGeometry";
import {
  buildReferenceUnit,
  disposeReferenceUnit,
} from "../../referenceObject";
import {
  type BakedPiece,
  bakedPieces,
  type UnitBounds,
  unitBounds,
} from "../../s3oBuild";
import type { ScriptTimeline } from "../../scriptPlayback";
import { snapRotation, type Vec3 } from "../../snapping";
import { captureThumbnail, readyToCapture } from "../../thumbnail";
import {
  applySnap,
  clearAnchors,
  forceUniformScale,
  placeAnchor,
  showSeat,
  showTargetAnchors,
} from "./anchorsAndSnapping";
import {
  beginFaceDrag,
  buildCollisionHandles,
  type CollisionFaceDrag,
  commitCollision,
  commitPieceCollision,
  endFaceDrag,
  handleBox,
  highlightHandle,
  moveFaceDrag,
} from "./collisionHandles";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { type GameReferenceChoice, ReferencePicker } from "./ReferencePicker";
import { ShortcutSheet } from "./ShortcutSheet";
import { useCollisionAndAimVisibility } from "./useCollisionAndAimVisibility";
import { useGizmoMode } from "./useGizmoMode";
import { useModelAnchors } from "./useModelAnchors";
import { useModelEnvironment } from "./useModelEnvironment";
import { useModelHover } from "./useModelHover";
import { useModelSceneSync } from "./useModelSceneSync";
import { useModelSelection } from "./useModelSelection";
import { useModelShortcuts } from "./useModelShortcuts";
import { useScriptFrameStepping } from "./useScriptFrameStepping";

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
export const FACE_COLOUR = 0x38bdf8;
export const CORNER_COLOUR = 0xfbbf24;
/** A seat the modeller marked, which is the only kind that piece then offers. */
export const CUSTOM_COLOUR = 0xf472b6;
/**
 * Hover reuses the face anchors' sky blue rather than a new hex: it already
 * means "something to interact with", and it reads clearly apart from the
 * selection outline's violet.
 */
const HOVER_COLOUR = FACE_COLOUR;
/**
 * How strongly the hover and selection washes tint a piece's own faces.
 * Selection is the stronger claim, so it gets the stronger tint. Both stay
 * low: a wash that hides the part's texture is too strong to be "subtle".
 */
const HOVER_OVERLAY_OPACITY = 0.12;
export const SELECT_OVERLAY_OPACITY = 0.22;
/**
 * The same wash while a collision panel is open, where it is in the way.
 *
 * The boxes are wireframes drawn over the model, so a selected piece's violet
 * wash sits between the eye and the very lines being read, and a box passing
 * across a washed face is harder to follow than one crossing the texture. The
 * selection outline still marks the piece, so the wash can give way.
 */
export const COLLISION_OVERLAY_OPACITY = 0.1;
/**
 * Dot sizes in CSS pixels, constant however far the camera is.
 *
 * Small: a part can carry fifteen of these and they have to sit on the model
 * rather than cover it. The origin is drawn larger because there is one of it
 * and it is the one you go looking for.
 */
const ANCHOR_DOT = 4;
const ORIGIN_DOT = 9;
/** The pair that actually seated, and the piece it seated against. */
export const SEAT_COLOUR = 0x34d399;
const SEAT_DOT = 11;
/**
 * The collision volume's wireframe. Orange because nothing else in the scene
 * is: it is a reading about the unit rather than a part of it, so it has to be
 * telling apart from the selection, the anchors and the front marker at a
 * glance.
 */
const COLLISION_COLOUR = 0xf97316;
/** How strongly that wireframe draws when it is the shape being read. */
export const COLLISION_OPACITY = 0.9;
/**
 * The same wireframe while a piece's own box is being edited.
 *
 * It stays on screen, because a piece box is only reached at all when the unit
 * volume lets the engine walk the piece tree, so the two are read together. But
 * it is no longer the answer being changed, and at full strength a large orange
 * box drawn over everything wins the eye against the small yellow one inside it.
 */
export const COLLISION_DIM_OPACITY = 0.3;

/**
 * The per-piece boxes. Yellow rather than the unit volume's orange, because the
 * two are drawn at once and one sits inside the other: the same orange at a
 * lower opacity read as a dimmer copy of the volume rather than as a different
 * reading, so a piece's box was easy to miss entirely.
 *
 * Warm, so it still groups with the volume as "what stops a shot", but far
 * enough round the wheel to be told apart at a glance in a wireframe.
 */
const PIECE_COLLISION_COLOUR = 0xfacc15;

/**
 * How wide the box on the piece being edited is drawn, in pixels.
 *
 * `LineBasicMaterial.linewidth` is ignored by every WebGL driver, so the one
 * box that has to stand out is drawn with the `Line2` shader instead, which
 * builds each segment as screen-space geometry. Only the edited piece gets it:
 * the shader costs a draw call per box and the crowd is meant to recede.
 */
const PIECE_EDIT_LINE_WIDTH = 3;

/**
 * The aim point. Red and larger than the origin dot, because it is the one
 * thing in the scene another unit is shooting at, and because it is usually
 * buried inside the model rather than out on a surface.
 */
const AIM_COLOUR = 0xef4444;
const AIM_DOT = 13;

/** Where the camera starts, and where Reset view puts it back. */
const HOME_CAMERA: [number, number, number] = [9, 7, 11];

/**
 * How far the camera may pull back, and how far it can see, when the scene is
 * no bigger than the builder's own defaults. Both grow with the scene: see
 * `applySceneScale`. Neither ever shrinks below these, so a unit on its own
 * behaves exactly as it always has.
 */
const MIN_MAX_DISTANCE = 120;
const MIN_FAR = 500;
/** Slack past a tight fit, so the whole scene is comfortably inside the view at
 *  the furthest the camera can go rather than flush with its edges. The same
 *  figure `framing.ts` pads a framed box by. */
const ZOOM_OUT_PADDING = 1.3;

/** Rotation lands on 15 degree steps unless snapping is held off. */
export const ROTATION_STEP = Math.PI / 12;

interface Props {
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  project: LegoProject;
  /** Every selected piece, oldest first. One is the ordinary case. */
  selectedIds: string[];
  /** `additive` is a Shift or Cmd click: add this piece to the selection
   *  rather than replacing it. */
  onSelect: (pieceId: string | null, additive: boolean) => void;
  /** Committed when a drag ends, not on every frame of it. */
  onTransform: (pieceId: string, change: Partial<LegoPiece>) => void;
  /** The same, for a set: every piece's new transform in one edit, so a group
   *  drag is one undo step rather than one per piece. */
  onTransformMany: (changes: Map<string, PieceTransform>) => void;
  /**
   * The piece to highlight as hovered regardless of where the pointer is, e.g.
   * because the sidebar's tree row for it is hovered instead of the canvas.
   */
  hoveredId?: string | null;
  /** Told whenever the piece under the pointer in this view changes, so the
   *  sidebar tree can highlight the matching row. */
  onHover?: (pieceId: string | null) => void;
  /**
   * Handed a function that draws a frame and returns the canvas, rather than
   * the canvas itself. WebGL discards its drawing buffer once the frame is
   * composited, so reading the canvas at any later moment gives a blank image.
   * The caller has to copy the pixels in the same task as the draw.
   *
   * It answers null while there is no picture to take: an empty unit, or one
   * still waiting on its textures. Ask again later rather than storing that.
   */
  onReady?: (capture: () => HTMLCanvasElement | null) => void;
  /** Runs the applied presets. Nothing is written: stopping restores the rest
   *  pose exactly, because it comes back from the document. */
  playing?: boolean;
  /**
   * Poses to play instead of the presets, for a unit whose script is its own.
   * The presets are gone for such a unit, so this is what playing means for it.
   */
  scriptTimeline?: ScriptTimeline | null;
  /**
   * True while a script run's clock is frozen on `scriptFrame` rather than
   * advancing on its own. The bake and detached gizmo stay exactly as they
   * are while paused, so scrubbing and stepping only ever change the pose.
   */
  scriptPaused?: boolean;
  /**
   * The frame a paused run is held on, and where the clock in a resumed run
   * picks back up from. Ignored for the preset codepath.
   */
  scriptFrame?: number;
  /**
   * Told which frame a script run is showing, every tick it is not paused, so
   * a scrubber can track playback and know where a pause should hold.
   */
  onScriptFrame?: (frame: number) => void;
  /** Scale handles keep the piece's proportions. */
  uniformScale?: boolean;
  /** Drop the unit onto y = 0. Absent hides the button. */
  onGround?: () => void;
  /** Duplicate the selected piece and everything under it (Cmd D). */
  onDuplicate: () => void;
  canDuplicate: boolean;
  /**
   * Paste under the selected piece (Cmd V). Always enabled: it reads the
   * system clipboard on click, so there is nothing to check synchronously
   * before then, and a mistaken paste reports itself rather than needing
   * to be prevented.
   */
  onPaste: () => void;
  /** Save the selected piece and everything under it, to reuse in another unit. */
  onSaveAsCompound: () => void;
  canSaveAsCompound: boolean;
  /** Delete every selected piece (Backspace). */
  onDelete: () => void;
  canDelete: boolean;
  /**
   * Whether a new piece gets a mirrored twin the first time it is placed off
   * the centre line (M). A setting for the session, not part of the unit, so it
   * lives with the page rather than the document.
   */
  symmetry: boolean;
  onSymmetryChange: (on: boolean) => void;
  /**
   * Arms the next click on the model to drop a snap anchor where it lands,
   * rather than selecting. The gizmo comes off while it is armed, since its
   * handles sit over the middle of the very piece being clicked.
   */
  placingAnchor?: boolean;
  /** Where the click landed, in the clicked piece's part space. */
  onPlaceAnchor?: (pieceId: string, position: Vec3) => void;
  /** A click that missed the model, which is how you change your mind. */
  onCancelAnchor?: () => void;
  /**
   * Puts the gizmo on the collision volume rather than on the selected piece,
   * so its size and where it sits are dragged rather than typed. The volume is
   * shown while this is on whether or not its own toggle is.
   */
  editCollision?: boolean;
  /** Where a dragged volume goes. Committed on release, like a piece's. */
  onCollisionChange?: (volume: LegoCollisionVolume) => void;
  /**
   * The piece whose own box takes the handles instead, drawn wide so it stands
   * out from the rest. Null leaves them on the unit's volume.
   *
   * A separate prop from `editCollision` rather than a mode inside it, because
   * the two boxes are set in the same panel and only one of them can have the
   * handles at a time: whichever the panel says.
   */
  editPieceCollisionId?: string | null;
  /** Where a dragged piece box goes. The piece keeps whether anything hits it,
   *  which the panel owns, so only the volume comes back here. */
  onPieceCollisionVolumeChange?: (
    pieceId: string,
    volume: LegoCollisionVolume,
  ) => void;
  /** Draws the aim point whether or not its own toggle is on, so the panel
   *  that sets it has the point it is about on screen. */
  showAimPoint?: boolean;
  /**
   * Where a dragged aim point goes, which also puts the move handles on it.
   * Committed on release like everything else here.
   *
   * A point has no size and no rotation, so this is the move gizmo only: there
   * are no faces to grab the way a volume has.
   */
  onAimChange?: (mid: [number, number, number]) => void;
}

export function ModelViewport({
  pack,
  raw,
  project,
  selectedIds,
  onSelect,
  onTransform,
  onTransformMany,
  hoveredId,
  onHover,
  onReady,
  playing = false,
  scriptTimeline = null,
  scriptPaused = false,
  scriptFrame = 0,
  onScriptFrame,
  uniformScale = false,
  onGround,
  onDuplicate,
  canDuplicate,
  onPaste,
  onSaveAsCompound,
  canSaveAsCompound,
  onDelete,
  canDelete,
  symmetry,
  onSymmetryChange,
  placingAnchor = false,
  onPlaceAnchor,
  onCancelAnchor,
  editCollision = false,
  onCollisionChange,
  editPieceCollisionId = null,
  onPieceCollisionVolumeChange,
  showAimPoint = false,
  onAimChange,
}: Props) {
  // The one selected piece, when there is exactly one. Anchors, the key at the
  // bottom of the view and the pivot dot are all about a single piece: a set
  // is dragged about its midpoint and seats against nothing.
  const soleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  /** Either box being edited: they behave the same way under the handles, and
   *  differ only in which one the plates land on. */
  const editingVolume = editCollision || editPieceCollisionId !== null;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const reduceMotion = useReduceMotion();
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [snapped, setSnapped] = useState(false);
  /** The name of the anchor a drag seated against, when it had one. */
  const [snappedTo, setSnappedTo] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showReference, setShowReference] = useState(false);
  /** A unit read out of an installed game to stand instead of the built-in
   *  solar collector. Null is the built-in one, which is also the fallback
   *  whenever a game's model cannot be read. */
  const [gameReference, setGameReference] =
    useState<GameReferenceChoice | null>(null);
  const [showCollision, setShowCollision] = useState(false);
  const [showAim, setShowAim] = useState(false);
  // View settings, held for as long as the viewport is open and no longer,
  // exactly as the two above are. Both open on what the builder has always
  // shown, so nothing about opening a project changes.
  const [backdrop, setBackdrop] = useState<BackdropId>("studio");
  const [ground, setGround] = useState<GroundId>("grid");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // The compass is the button people press when they are lost, so it frames
  // the whole unit rather than dropping the camera on a fixed point that a
  // unit built away from the origin, or much bigger than the default, is not
  // near. It frames from the home direction rather than the direction the
  // camera is already facing, so it lands somewhere recognisable every time.
  //
  // The box comes from the document rather than the scene because the scene's
  // root holds the pivot dot as well as the geometry, which would make an
  // empty unit look like a unit the size of a point at the origin. A unit with
  // no geometry has nothing to frame, and keeps the old behaviour: the home
  // camera, looking at the origin.
  function resetView() {
    const state = sceneRef.current;
    if (!state) return;
    const bounds = unitBounds(project, pack, raw);
    const box = boundsBox(bounds);
    if (box) {
      frameBounds(state, box, HOME_CAMERA);
    } else {
      homeView(state);
    }
    state.render();
  }

  // The scene is built once and never rebuilt on a prop change, because that
  // would reset the camera mid-edit. Callbacks therefore go through refs rather
  // than being captured, or the handler would keep calling the first ones it saw.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onTransformRef = useRef(onTransform);
  onTransformRef.current = onTransform;
  const onTransformManyRef = useRef(onTransformMany);
  onTransformManyRef.current = onTransformMany;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  // F reads this from the keydown listener below, which is registered once
  // and would otherwise only ever see the selection at mount. The hover code
  // reads it too, to skip drawing a hover treatment on a selected piece.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  // The gizmo reads the document every frame of a drag to find what to snap
  // against, and a stale copy would snap to where pieces used to be.
  const projectRef = useRef(project);
  projectRef.current = project;
  const packRef = useRef(pack);
  packRef.current = pack;
  const rawRef = useRef(raw);
  rawRef.current = raw;
  // Read inside the playback loop, so replaying a different scenario swaps what
  // is playing without tearing the loop down and building the bake again.
  const scriptTimelineRef = useRef(scriptTimeline);
  scriptTimelineRef.current = scriptTimeline;
  // Same reason: read inside the tick rather than depended on, so pausing,
  // scrubbing and stepping never tear down the bake or reattach the gizmo.
  const scriptPausedRef = useRef(scriptPaused);
  scriptPausedRef.current = scriptPaused;
  const scriptFrameRef = useRef(scriptFrame);
  scriptFrameRef.current = scriptFrame;
  const onScriptFrameRef = useRef(onScriptFrame);
  onScriptFrameRef.current = onScriptFrame;
  const placingAnchorRef = useRef(placingAnchor);
  placingAnchorRef.current = placingAnchor;
  const onPlaceAnchorRef = useRef(onPlaceAnchor);
  onPlaceAnchorRef.current = onPlaceAnchor;
  const onCancelAnchorRef = useRef(onCancelAnchor);
  onCancelAnchorRef.current = onCancelAnchor;
  const onCollisionChangeRef = useRef(onCollisionChange);
  onCollisionChangeRef.current = onCollisionChange;
  const onPieceVolumeChangeRef = useRef(onPieceCollisionVolumeChange);
  onPieceVolumeChangeRef.current = onPieceCollisionVolumeChange;
  const onAimChangeRef = useRef(onAimChange);
  onAimChangeRef.current = onAimChange;

  // Built once. Everything after this mutates the scene rather than remaking it.
  useCanvas3D(
    containerRef,
    (canvas) => {
      const { renderer } = canvas;

      const scene = new THREE.Scene();
      addStandardLights(scene);

      // Units stand on y = 0, so the grid is the ground the engine will use.
      // Marked up in footprint steps and common plate sizes: see buildPlate.ts.
      const grid = buildGround();
      scene.add(grid);

      // Which way is which, drawn at the origin. Short, because it is a compass
      // and not a measure.
      const axes = new THREE.AxesHelper(2);
      axes.position.y = 0.01;
      scene.add(axes);

      // Which way the unit faces. Not part of the grid toggle below: a
      // decluttered view still has to say which way is front, since that is
      // the one thing here a builder cannot re-check once it is missed.
      const frontMarker = buildFrontMarker();
      scene.add(frontMarker);

      // A view aid, not a piece: sits beside where a unit is built rather
      // than under it, and is off by default so it never surprises anyone
      // opening a project for the first time.
      const reference = buildReferenceUnit();
      reference.position.set(REFERENCE_PARK_X, 0, 0);
      reference.visible = false;
      scene.add(reference);

      // The collision volume's wireframe. Drawn over everything rather than
      // depth-tested, because a volume set smaller than the unit sits inside
      // the geometry and would otherwise be invisible exactly when its size is
      // the thing being checked.
      const collisionMaterial = new THREE.LineBasicMaterial({
        color: COLLISION_COLOUR,
        transparent: true,
        opacity: COLLISION_OPACITY,
        depthTest: false,
      });

      // The volume's size controls. Drawn over everything for the same reason
      // the wireframe is, and grabbable from either side because a face can be
      // looked at from inside the volume.
      const collisionHandleMaterial = new THREE.MeshBasicMaterial({
        color: COLLISION_COLOUR,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const collisionHandleHotMaterial = new THREE.MeshBasicMaterial({
        color: COLLISION_COLOUR,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const collisionHandles = buildCollisionHandles(collisionHandleMaterial);
      scene.add(collisionHandles);

      // The same plates go on a piece's box, in that box's own colour, so the
      // handles say which of the two shapes they are about to size.
      const pieceHandleMaterial = new THREE.MeshBasicMaterial({
        color: PIECE_COLLISION_COLOUR,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const pieceHandleHotMaterial = new THREE.MeshBasicMaterial({
        color: PIECE_COLLISION_COLOUR,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
        side: THREE.DoubleSide,
      });

      // The per-piece boxes, when the unit is hit piece by piece. Fainter than
      // the box of whichever piece is being edited, so a unit with thirty
      // pieces still reads as one box you are working on and a crowd behind it.
      const pieceCollisionMaterial = new THREE.LineBasicMaterial({
        color: PIECE_COLLISION_COLOUR,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
      });

      // The box on the piece being edited. Wide enough to find without hunting,
      // which needs the `Line2` shader: see `PIECE_EDIT_LINE_WIDTH`.
      const pieceEditMaterial = new LineMaterial({
        color: PIECE_COLLISION_COLOUR,
        linewidth: PIECE_EDIT_LINE_WIDTH,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      });
      // Screen-space widths need the viewport size. `useCanvas3D` calls `resize`
      // once straight after this, which is what keeps it right from then on.
      renderer.getSize(pieceEditMaterial.resolution);

      // The aim point: one dot, moved rather than rebuilt, drawn over the
      // collision wireframe so it is still findable inside a volume.
      const aimMaterial = dotMaterial(
        AIM_DOT,
        renderer.getPixelRatio(),
        false,
        AIM_COLOUR,
      );
      const aimMark = points([0, 0, 0], null, aimMaterial);
      aimMark.renderOrder = 5;
      aimMark.visible = false;
      scene.add(aimMark);

      const root = new THREE.Group();
      scene.add(root);

      // What the gizmo drags when more than one piece is selected. An object
      // of its own, sitting at the set's midpoint, because the pieces have
      // different parents and there is no shared carrier to grab.
      const groupPivot = new THREE.Object3D();
      scene.add(groupPivot);

      // Sky blue, and thinner reading than the selection outline: the piece
      // under the pointer, not yet clicked.
      const hoverOutline = new THREE.BoxHelper(root, HOVER_COLOUR);
      hoverOutline.visible = false;
      scene.add(hoverOutline);

      // A wash over the piece's own faces rather than its bounding box, so it
      // follows the part's silhouette. Unparented until first shown: a mesh
      // with nowhere to sit has nothing to draw.
      const hoverOverlayMaterial = overlayMaterial(
        HOVER_COLOUR,
        HOVER_OVERLAY_OPACITY,
      );
      const hoverOverlay = new THREE.Mesh(
        new THREE.BufferGeometry(),
        hoverOverlayMaterial,
      );
      hoverOverlay.visible = false;
      hoverOverlay.raycast = () => {};

      const selectOverlayMaterial = overlayMaterial(
        ORIGIN_COLOUR,
        SELECT_OVERLAY_OPACITY,
      );

      // Green, and only ever seen mid-drag: the piece being seated against, and
      // the point the two anchors meet at.
      const seatOutline = new THREE.BoxHelper(root, SEAT_COLOUR);
      seatOutline.visible = false;
      scene.add(seatOutline);

      const seatMark = new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute([0, 0, 0], 3),
        ),
        dotMaterial(SEAT_DOT, renderer.getPixelRatio(), false, SEAT_COLOUR),
      );
      seatMark.visible = false;
      seatMark.renderOrder = 3;
      seatMark.raycast = () => {};
      scene.add(seatMark);

      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, MIN_FAR);
      camera.position.set(...HOME_CAMERA);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !reduceMotion;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 1;
      controls.maxDistance = MIN_MAX_DISTANCE;
      // The point under the pointer stays under it as the wheel dollies,
      // rather than everything converging on the orbit target. OrbitControls
      // moves the target itself to keep looking the same way from the new
      // position, which is why F still frames correctly afterwards: it reads
      // the target fresh rather than a value cached from before the zoom.
      controls.zoomToCursor = true;

      const render = () => {
        renderer.render(scene, camera);
        // After the render, so the camera's inverse matrix is the one just used.
        if (compassRef.current) paintCompass(compassRef.current, camera);
      };
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
        groupPivot,
        groupPivotAt: [0, 0, 0],
        groupIds: [],
        groupChanges: new Map(),
        hoverOutline,
        hoverOverlay,
        selectOverlayMaterial,
        selectOutlines: [],
        selectOverlays: [],
        selectedGroups: [],
        hoveredId: null,
        grid,
        groundSteps: groundSteps(0),
        axes,
        reference,
        disposeReference: () => disposeReferenceUnit(reference),
        collision: null,
        collisionMaterial,
        editCollision: false,
        collisionHandles,
        collisionHandleMaterial,
        collisionHandleHotMaterial,
        pieceHandleMaterial,
        pieceHandleHotMaterial,
        collisionDrag: null,
        onCollisionChangeRef,
        pieceCollision: null,
        pieceCollisionMaterial,
        pieceEditMaterial,
        pieceCollisionBoxes: new Map(),
        editPieceId: null,
        onPieceVolumeChangeRef,
        editAim: false,
        onAimChangeRef,
        aimMark,
        sky: null,
        terrain: null,
        groups: new Map(),
        baked: [],
        imported: null,
        rest: new Map(),
        uniformScale: false,
        anchors: null,
        targetAnchors: null,
        seatMark,
        seatOutline,
        dots: dotMaterial(ANCHOR_DOT, renderer.getPixelRatio(), true),
        originDot: dotMaterial(ORIGIN_DOT, renderer.getPixelRatio(), false),
        render,
        framed: false,
        snapping: true,
        onSnapChange: () => {},
        projectRef,
        packRef,
        rawRef,
        placingAnchorRef,
        onPlaceAnchorRef,
        onCancelAnchorRef,
        onTransformRef,
        onTransformManyRef,
        selectedIdsRef,
        onHoverRef,
      };
      sceneRef.current = state;

      // Read by the pointermove handler below, so a drag pins the hover
      // highlight rather than having it flicker onto whatever the gizmo drags
      // the cursor over.
      let dragging = false;

      // `mouseDown` and `mouseUp`, not `dragging-changed`: this version of
      // TransformControls does not dispatch that one, so listening for it left
      // orbit running during a drag, and never wrote the moved transform back.
      // The next edit then resynced the scene from a document that still had
      // every piece at the origin.
      gizmo.addEventListener("mouseDown", () => {
        controls.enabled = false;
        dragging = true;
        setHoveredAndNotify(state, null);
        // Built once per drag: the other pieces do not move while one is dragged,
        // so their anchors are fixed for the length of it.
        const pieceId = gizmo.object ? pieceIdOf(gizmo.object) : null;
        if (gizmo.getMode() === "translate") {
          showTargetAnchors(
            state,
            packRef.current,
            projectRef.current,
            pieceId,
          );
        }
      });
      gizmo.addEventListener("mouseUp", () => {
        controls.enabled = true;
        dragging = false;
        showTargetAnchors(state, packRef.current, projectRef.current, null);
        showSeat(state, null);
        const dragged = gizmo.object;
        if (dragged === state.collision) commitCollision(state);
        else if (dragged === state.aimMark) commitAim(state);
        else if (dragged === groupPivot) commitGroup(state);
        else if (dragged && dragged === handleBox(state))
          commitPieceCollision(state);
        else commitGizmo(state);
        render();
      });

      gizmo.addEventListener("objectChange", () => {
        if (gizmo.object === groupPivot) {
          dragGroup(state);
        } else {
          forceUniformScale(state);
          applySnap(state);
        }
        refreshSelectionOutlines(state);
        render();
      });

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

      const aimAt = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
      };

      // Sizing the volume by its faces. Registered before the selection
      // handlers below, so a press that grabbed a plate is already known by the
      // time they run. The orbit registered before all of them and has already
      // taken this press, which is why the drag switches it off rather than
      // asking it not to start: the same thing TransformControls does.
      const onFaceDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        aimAt(event);
        if (!beginFaceDrag(state, raycaster)) return;
        dragging = true;
        setHoveredAndNotify(state, null);
        renderer.domElement.setPointerCapture(event.pointerId);
        render();
      };
      const onFaceMove = (event: PointerEvent) => {
        if (!state.collisionDrag) return;
        aimAt(event);
        moveFaceDrag(state, raycaster);
      };
      const onFaceUp = (event: PointerEvent) => {
        if (!state.collisionDrag) return;
        endFaceDrag(state);
        dragging = false;
        if (renderer.domElement.hasPointerCapture(event.pointerId))
          renderer.domElement.releasePointerCapture(event.pointerId);
      };
      renderer.domElement.addEventListener("pointerdown", onFaceDown);
      renderer.domElement.addEventListener("pointermove", onFaceMove);
      renderer.domElement.addEventListener("pointerup", onFaceUp);
      renderer.domElement.addEventListener("pointercancel", onFaceUp);

      const onPointerDown = (event: PointerEvent) => {
        pressedAt = { x: event.clientX, y: event.clientY };
        // Whether a handle was grabbed has to be read now rather than on release.
        // TransformControls registered its listeners on this canvas first, so its
        // pointerdown has already set these, and its pointerup clears them again
        // before this handler's pointerup would ever see them.
        pressedOnGizmo =
          gizmo.dragging || gizmo.axis !== null || state.collisionDrag !== null;
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
        if (placingAnchorRef.current) {
          placeAnchor(state, hit);
          return;
        }
        onSelectRef.current(
          pieceIdOf(hit?.object ?? null),
          event.shiftKey || event.metaKey || event.ctrlKey,
        );
      };
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);

      // Raycasting on every `pointermove` would run it far more often than the
      // screen can show a result, so a move only records where the pointer is
      // and asks for a frame. The frame itself does the one raycast that
      // frame gets, and only re-renders if the hovered piece actually changed.
      let hoverFrame = 0;
      let hoverAt: { x: number; y: number } | null = null;

      const checkHover = () => {
        hoverFrame = 0;
        if (!hoverAt || dragging) return;
        pointer.x = hoverAt.x;
        pointer.y = hoverAt.y;
        raycaster.setFromCamera(pointer, camera);
        // The plates sit over the model, so they answer first: a face about to
        // be grabbed is not a piece about to be picked.
        const plate = state.collisionHandles.visible
          ? raycaster.intersectObjects(
              state.collisionHandles.children,
              false,
            )[0]
          : undefined;
        if (highlightHandle(state, plate?.object ?? null)) render();
        if (plate) {
          setHoveredAndNotify(state, null);
          return;
        }
        let found: string | null = null;
        for (const hit of raycaster.intersectObject(root, true)) {
          const id = pieceIdOf(hit.object);
          if (id && !isEffectivelyHidden(projectRef.current, id)) {
            found = id;
            break;
          }
        }
        setHoveredAndNotify(state, found);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (dragging) return;
        const bounds = renderer.domElement.getBoundingClientRect();
        hoverAt = {
          x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        };
        if (!hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
      };
      const onPointerLeave = () => {
        hoverAt = null;
        if (!dragging) setHoveredAndNotify(state, null);
      };
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);

      // A thumbnail is the unit alone, drawn from a fixed camera: see
      // thumbnail.ts. The live view is drawn again straight after, before the
      // browser composites anything, so the capture is never seen.
      onReadyRef.current?.(() => {
        // Nothing worth photographing yet: a unit with no pieces in it, or one
        // whose textures have not arrived and would draw black.
        if (!readyToCapture(root)) return null;
        const thumb = captureThumbnail(renderer, scene, root, [
          state.hoverOverlay,
          state.anchors,
          ...state.selectOverlays,
        ]);
        render();
        return thumb;
      });

      return {
        render,
        resize: (width, height) => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          // The wide line shader works in screen space, so it has to be told
          // how big the screen is or the box comes out the wrong width.
          pieceEditMaterial.resolution.set(width, height);
        },
        dispose: () => {
          cancelAnimationFrame(frame);
          cancelAnimationFrame(hoverFrame);
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener(
            "pointerleave",
            onPointerLeave,
          );
          controls.removeEventListener("change", render);
          controls.dispose();
          gizmo.detach();
          gizmo.getHelper().removeFromParent();
          gizmo.dispose();
          clearAnchors(state);
          for (const helper of state.selectOutlines) helper.dispose();
          state.targetAnchors?.geometry.dispose();
          state.seatMark.geometry.dispose();
          (state.seatMark.material as THREE.PointsMaterial).dispose();
          state.seatOutline.dispose();
          state.hoverOutline.dispose();
          // Not the overlays' geometry: it is always a borrowed reference to a
          // piece's own mesh geometry (or the pack's cache, or the bake), never
          // something these meshes own.
          hoverOverlayMaterial.dispose();
          selectOverlayMaterial.dispose();
          state.dots.dispose();
          state.originDot.dispose();
          disposeBaked(state);
          state.imported?.dispose();
          // Not `grid`: the ground is laid again whenever it has to reach
          // further, so the one in the scene may not be the one built here.
          disposeGround(state.grid);
          disposeFrontMarker(frontMarker);
          state.sky?.texture.dispose();
          if (state.terrain) disposeTerrain(state.terrain);
          // Not `reference`: the figure may have been swapped for a unit read
          // out of an installed game since the scene was built.
          state.disposeReference();
          state.collision?.geometry.dispose();
          collisionMaterial.dispose();
          // One square shared by all six plates, so it is freed once.
          (collisionHandles.children[0] as THREE.Mesh).geometry.dispose();
          collisionHandleMaterial.dispose();
          collisionHandleHotMaterial.dispose();
          pieceHandleMaterial.dispose();
          pieceHandleHotMaterial.dispose();
          disposePieceCollision(state);
          pieceCollisionMaterial.dispose();
          pieceEditMaterial.dispose();
          state.aimMark.geometry.dispose();
          aimMaterial.dispose();
          sceneRef.current = null;
        },
      };
    },
    [reduceMotion],
  );

  useModelSceneSync(sceneRef, pack, raw, project, playing, reduceMotion);

  useCollisionAndAimVisibility(sceneRef, {
    project,
    pack,
    raw,
    showCollision,
    editCollision,
    editingVolume,
    editPieceCollisionId,
    showAim,
    showAimPoint,
    selectedIdsRef,
    placingAnchorRef,
  });

  useModelSelection(sceneRef, selectedIds, project, placingAnchor);

  useModelHover(sceneRef, hoveredId, project);

  useModelAnchors(sceneRef, pack, project, soleSelectedId, playing);

  useGizmoMode(sceneRef, mode, editingVolume, showAimPoint, uniformScale);

  useModelEnvironment(sceneRef, {
    showGrid,
    showReference,
    gameReference,
    backdrop,
    ground,
  });

  useScriptFrameStepping(sceneRef, {
    playing,
    reduceMotion,
    selectedIds,
    scriptPaused,
    scriptTimeline,
    scriptFrame,
    packRef,
    rawRef,
    projectRef,
    scriptTimelineRef,
    scriptPausedRef,
    scriptFrameRef,
    onScriptFrameRef,
    placingAnchorRef,
  });

  useModelShortcuts(sceneRef, {
    selectedIdsRef,
    setSnapped,
    setSnappedTo,
    setMode,
    setShortcutsOpen,
  });

  // Whether the selected piece carries anchors of its own, which decides what
  // the key at the bottom of the view has to name.
  const ownAnchors = soleSelectedId
    ? (pieceById(project, soleSelectedId)?.customAnchors?.length ?? 0)
    : 0;

  return (
    // Darker than the page behind it, so the unit reads as being in its own
    // space and pale parts have something to sit against. A translucent tint
    // rather than a fixed colour, so it deepens whatever the theme is.
    <div className="relative h-full w-full bg-black/30">
      <div
        ref={containerRef}
        className={`h-full w-full ${placingAnchor ? "cursor-crosshair" : ""}`}
      />

      {/* Down the left edge and vertically centred, out of the way of the
          unit's own chrome at the top of the view. Bounded top and bottom and
          scrollable, rather than centred on a fixed point: with three button
          groups now stacked here, a short window has it scroll instead of
          spilling into that chrome. `m-auto` on the inner column rather than
          `justify-center` on the outer one: centring a flex container that
          way clips content off both ends once it overflows, since a plain
          `center` does not yield to the scrollport the way auto margins do. */}
      <TooltipProvider delayDuration={300}>
        <div className="absolute inset-y-3 left-3 flex flex-col overflow-y-auto">
          <div className="m-auto flex flex-col gap-2">
            <ButtonGroup orientation="vertical">
              {MODES.map(({ id, label, key, Icon }) => {
                // A collision volume is measured along the model's own axes and
                // has nothing to turn, so the handles for it are move and scale.
                // The aim point is a point: move is all it has.
                const off = showAimPoint
                  ? id !== "translate"
                  : editingVolume && id === "rotate";
                return (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant={mode === id && !off ? "default" : "outline"}
                        onClick={() => setMode(id)}
                        disabled={off}
                        aria-label={label}
                        aria-pressed={mode === id && !off}
                      >
                        <Icon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {!off
                        ? `${label} (${key})`
                        : showAimPoint
                          ? "An aim point is one point, so it only moves"
                          : "A collision volume has no rotation"}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </ButtonGroup>

            {/* A group of its own. The three above are a mode you are in, this
              is a thing you do once. */}
            {onGround ? (
              <ButtonGroup orientation="vertical">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={onGround}
                      aria-label="Sit the unit on the ground"
                    >
                      <ArrowDownToLine className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Sit on the ground
                  </TooltipContent>
                </Tooltip>
              </ButtonGroup>
            ) : null}

            {/* A third group: what you do to the selected piece, rather than a
              mode or a one-off on the whole unit. */}
            <ButtonGroup orientation="vertical">
              {/* Held on rather than pressed once, so it reads as a state the
                  builder is in: everything placed while it is lit comes in
                  pairs. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={symmetry ? "default" : "outline"}
                    onClick={() => onSymmetryChange(!symmetry)}
                    aria-pressed={symmetry}
                    aria-label="Symmetry"
                  >
                    <FlipHorizontal2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Symmetry: a new piece gets a twin, which follows it for as
                  long as it stays selected (M)
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={onDuplicate}
                    disabled={!canDuplicate}
                    aria-label="Duplicate the selection"
                  >
                    <Copy className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Duplicate (Cmd D)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={onPaste}
                    aria-label="Paste"
                  >
                    <ClipboardPaste className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Paste (Cmd V)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={onSaveAsCompound}
                    disabled={!canSaveAsCompound}
                    aria-label="Save the selection as a compound"
                  >
                    <PackagePlus className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Save as a compound</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={onDelete}
                    disabled={!canDelete}
                    aria-label="Delete the selection"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Delete (Backspace)</TooltipContent>
              </Tooltip>
            </ButtonGroup>
          </div>
        </div>
      </TooltipProvider>

      {/* Camera and scene, in the opposite corner from the notes. Stacked
          rather than side by side, so the compass keeps the corner and the
          buttons do not push it inward. */}
      <ViewControls>
        <GridToggle
          on={showGrid}
          onChange={setShowGrid}
          showTitle="Show the ground grid, marked in footprint steps and plate sizes"
        />
        <ViewToggle
          icon={Box}
          on={showCollision}
          onChange={setShowCollision}
          hideTitle="Hide the collision volume"
          showTitle="Show the collision volume, the shape the engine hits and clicks"
        />
        <ViewToggle
          icon={Crosshair}
          on={showAim}
          onChange={setShowAim}
          hideTitle="Hide the aim point"
          showTitle="Show the aim point, the one point another unit shoots at"
        />
        <EnvironmentPicker
          backdrop={backdrop}
          onBackdrop={setBackdrop}
          ground={ground}
          onGround={setGround}
        />
        <ReferencePicker
          show={showReference}
          onShowChange={setShowReference}
          onReference={(choice) => {
            setGameReference(choice);
            // Picking a unit and having nothing appear reads as a broken
            // picker, so choosing one turns the figure on.
            if (choice) setShowReference(true);
          }}
        />
        <ViewButton
          title="Keyboard shortcuts (?)"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard className="size-4" />
        </ViewButton>
        <AxisCompass svgRef={compassRef} onClick={resetView} />
      </ViewControls>

      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Notes and the key sit at the bottom, where they can be read when
          wanted and ignored when not. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-xs text-muted-foreground">
        {soleSelectedId && !playing ? (
          <div className="flex gap-3">
            <Dot colour="#8b5cf6" label="Turns here" />
            {/* A piece with anchors of its own offers only those, so the box's
                key would be naming dots that are not drawn. */}
            {ownAnchors > 0 ? (
              <Dot colour="#f472b6" label="Anchors" />
            ) : (
              <>
                <Dot colour="#38bdf8" label="Faces" />
                <Dot colour="#fbbf24" label="Corners" />
              </>
            )}
          </div>
        ) : null}
        {/* Named only while the boxes are drawn, and the piece swatch only
            while there are piece boxes to name. Two oranges with no key was
            the thing that made a piece's box hard to place at all. */}
        {showCollision || editingVolume ? (
          <div className="flex gap-3">
            <Dot colour="#f97316" label="Unit volume" />
            {project.pieceCollision ||
            project.pieceSelection ||
            editPieceCollisionId ? (
              <Dot colour="#facc15" label="Piece boxes" />
            ) : null}
          </div>
        ) : null}
        {showAim || showAimPoint ? (
          <div className="flex gap-3">
            <Dot colour="#ef4444" label="Aim point" />
          </div>
        ) : null}
        <span>
          {placingAnchor
            ? "Click the model to put an anchor there. Escape to stop"
            : snapped
              ? snappedTo
                ? `Snapped to "${snappedTo}". Hold Alt to place freely`
                : "Snapped. Hold Alt to place freely"
              : "Hold Alt to place freely"}
        </span>
      </div>
    </div>
  );
}

/**
 * Which way the world's axes point from where the camera is.
 *
 * Painted straight into the SVG from the render loop rather than through React
 * state: the camera moves every frame while orbiting, and re-rendering the tree
 * sixty times a second to move three lines would be absurd.
 */
function paintCompass(svg: SVGSVGElement, camera: THREE.Camera) {
  const basis = new THREE.Matrix3().setFromMatrix4(camera.matrixWorldInverse);
  const point = new THREE.Vector3();

  for (const [axis, x, y, z] of [
    ["x", 1, 0, 0],
    ["y", 0, 1, 0],
    ["z", 0, 0, 1],
  ] as const) {
    point.set(x, y, z).applyMatrix3(basis);
    const line = svg.querySelector(`[data-axis="${axis}"]`);
    const label = svg.querySelector(`[data-label="${axis}"]`);
    // Screen y grows downward, so the camera-space y is negated.
    const tipX = COMPASS_MID + point.x * COMPASS_ARM;
    const tipY = COMPASS_MID - point.y * COMPASS_ARM;
    line?.setAttribute("x2", String(tipX));
    line?.setAttribute("y2", String(tipY));
    label?.setAttribute("x", String(tipX));
    label?.setAttribute("y", String(tipY));
    // An axis pointing away from the camera is drawn faint, so the near end of
    // each pair is the readable one.
    const towards = (point.z + 1) / 2;
    line?.setAttribute("opacity", String(0.35 + towards * 0.65));
    label?.setAttribute("opacity", String(0.35 + towards * 0.65));
  }
}

const COMPASS_SIZE = 32;
const COMPASS_MID = COMPASS_SIZE / 2;
const COMPASS_ARM = 11;

/**
 * The three world axes as seen from here, and a click to face front again.
 *
 * The builder's own {@link ResetViewButton}, and richer than the plain one: it
 * frames the unit like any reset, and while it waits it says which way round the
 * camera is, which is how somebody notices they are lost in the first place. It
 * is still one of the bar's buttons, so it is drawn as one.
 */
function AxisCompass({
  svgRef,
  onClick,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  onClick: () => void;
}) {
  return (
    <ViewButton title="Reset the view" onClick={onClick}>
      {/* A `size-` class of its own, or the button's own icon rule shrinks any
          bare svg to 16px and the compass becomes a smudge. */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
        className="size-7"
        aria-hidden
        role="presentation"
      >
        {(
          [
            ["x", "#f87171"],
            ["y", "#4ade80"],
            ["z", "#60a5fa"],
          ] as const
        ).map(([axis, colour]) => (
          <g key={axis}>
            <line
              data-axis={axis}
              x1={COMPASS_MID}
              y1={COMPASS_MID}
              x2={COMPASS_MID}
              y2={COMPASS_MID}
              stroke={colour}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <text
              data-label={axis}
              x={COMPASS_MID}
              y={COMPASS_MID}
              fill={colour}
              fontSize={9}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {axis.toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
    </ViewButton>
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

/**
 * Draw the collision volume the export would write, or take it away again.
 *
 * The volume is positioned from the unit's aim point, because that is where the
 * engine measures its offsets from, so what is drawn sits exactly where it will
 * in a game. On most units the aim point is the middle of the bounding box and
 * a volume with no offset sits on it.
 *
 * A null project means "not showing", which is also what leaves nothing behind
 * to keep in step with the document.
 *
 * The shape is built one elmo across and the object carries its size, so the
 * volume's own numbers are the object's transform and a drag needs no
 * conversion to read back.
 */
export function showCollisionVolume(
  state: SceneState,
  project: LegoProject | null,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  if (state.collision) {
    if (state.gizmo.object === state.collision) state.gizmo.detach();
    state.collision.geometry.dispose();
    state.collision.removeFromParent();
    state.collision = null;
  }
  if (!project) return;

  const bounds = unitBounds(project, pack, raw);
  const aim = aimPoint(project, bounds);
  const volume = effectiveCollisionVolume(project, bounds);
  const lines = new THREE.LineSegments(
    collisionWireframe(volume),
    state.collisionMaterial,
  );
  lines.position.set(
    aim[0] + volume.offsets[0],
    aim[1] + volume.offsets[1],
    aim[2] + volume.offsets[2],
  );
  lines.scale.set(...engineScales(volume));
  // Over the model, to match the material's own `depthTest: false`.
  lines.renderOrder = 4;
  lines.raycast = () => {};
  state.collision = lines;
  state.scene.add(lines);
}

/**
 * Draw the box the engine will hit on each piece, or take them away again.
 *
 * Mostly a reading: nothing in a model or a unit definition declares these, the
 * engine measures one off every piece's vertices as it loads the model, and the
 * unit definition only chooses whether to hit them. Drawing them is the only way
 * to see what a shot will meet before the unit is in a game.
 *
 * A piece given a box of its own draws that one instead, and a piece switched
 * out of the hit test draws nothing, because nothing is what it will stop. Both
 * come out of `pieceCollisionVolumes`, so the shape on screen is the shape the
 * generated collision file sets. See `pieceCollisionScript.ts`.
 *
 * A null project means "not showing", which covers both the toggle being off
 * and the unit not asking for piece collision.
 *
 * The piece being edited is drawn wide and the rest thin. Every box used to be
 * one faint colour, which left the one you had picked indistinguishable from
 * the thirty behind it, so a unit with any real number of pieces read as a mesh
 * of lines rather than as a box you were changing.
 */
export function showPieceCollisionVolumes(
  state: SceneState,
  project: LegoProject | null,
  pack: LoadedPack,
  raw: RawGeometry | null,
) {
  disposePieceCollision(state);
  if (!project) return;

  const { pieces } = bakedPieces(project, pack, raw);
  const group = new THREE.Group();
  for (const { pieceId, origin, volume, hit } of pieceCollisionVolumes(
    project,
    pieces,
  )) {
    if (!hit) continue;
    const edited = pieceId === state.editPieceId;
    const wire = collisionWireframe(volume);
    let lines: THREE.Object3D;
    if (edited) {
      // `LineSegments2` keeps its own copy of the points as instance
      // attributes, so the wireframe it was built from is finished with here.
      // Fed by position rather than by `fromEdgesGeometry`, which is typed for
      // an `EdgesGeometry` and a round volume's wireframe is not one.
      const fat = new LineSegmentsGeometry().setPositions(
        wire.attributes.position.array as Float32Array,
      );
      wire.dispose();
      lines = new LineSegments2(fat, state.pieceEditMaterial);
    } else {
      lines = new THREE.LineSegments(wire, state.pieceCollisionMaterial);
    }
    lines.position.set(
      origin[0] + volume.offsets[0],
      origin[1] + volume.offsets[1],
      origin[2] + volume.offsets[2],
    );
    // What the engine will build rather than what was typed, the same way the
    // unit volume is drawn: `FixTypeAndScale` makes a sphere uniform and a
    // cylinder round whatever the numbers say.
    lines.scale.set(...engineScales(volume));
    // Above the crowd of thin boxes, so the edited one is not cut into by a
    // box drawn after it.
    lines.renderOrder = edited ? 5 : 4;
    lines.raycast = () => {};
    group.add(lines);
    state.pieceCollisionBoxes.set(pieceId, lines);
  }
  state.pieceCollision = group;
  state.scene.add(group);
}

/** Free the per-piece boxes. Each carries its own geometry, and they share the
 *  two materials, which outlive them. */
function disposePieceCollision(state: SceneState) {
  state.pieceCollisionBoxes.clear();
  if (!state.pieceCollision) return;
  for (const lines of state.pieceCollision.children) {
    if (state.gizmo.object === lines) state.gizmo.detach();
    (lines as THREE.LineSegments | LineSegments2).geometry.dispose();
  }
  state.pieceCollision.removeFromParent();
  state.pieceCollision = null;
}

/**
 * Which handles the gizmo shows, given what is being edited.
 *
 * A volume is measured along the model's own axes, so it has no rotation to
 * drag and rotate falls back to move. The aim point is one point, so it has no
 * size either and every mode falls back to move.
 */
export function gizmoMode(
  mode: GizmoMode,
  editingVolume: boolean,
  editingAim: boolean,
): GizmoMode {
  if (editingAim) return "translate";
  return editingVolume && mode === "rotate" ? "translate" : mode;
}

/**
 * A volume as lines, one elmo across, in the shape the engine will actually
 * build. A sphere written with three different sizes is drawn round, and a
 * cylinder written with an oval cross-section is drawn circular, because that
 * is what a game gets: see `engineScales`.
 *
 * A box and a cylinder are drawn as their edges, which is the outline you would
 * draw by hand. A sphere has no edges to find, so that one is the full mesh
 * wireframe.
 */
function collisionWireframe(volume: LegoCollisionVolume): THREE.BufferGeometry {
  const solid = collisionSolid(volume);
  const round = volume.type === "sphere" || volume.type === "ellipsoid";
  const lines = round
    ? new THREE.WireframeGeometry(solid)
    : new THREE.EdgesGeometry(solid);
  solid.dispose();
  return lines;
}

/** The volume as a solid one elmo across, for the lines to come off. Its size
 *  is on the object rather than in here, so the same shape serves any size. */
function collisionSolid(volume: LegoCollisionVolume): THREE.BufferGeometry {
  switch (volume.type) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cylx":
    case "cyly":
    case "cylz": {
      // Three.js builds a cylinder along y, so the other two axes turn onto it.
      const solid = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      if (volume.type === "cylx") solid.rotateZ(Math.PI / 2);
      if (volume.type === "cylz") solid.rotateX(Math.PI / 2);
      return solid;
    }
    default:
      // A sphere and an ellipsoid are the same shape. Which one it turns out
      // to be is entirely in the scales the object carries.
      return new THREE.SphereGeometry(0.5, 16, 10);
  }
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
 * A flat, unlit tint for the hover and selection washes.
 *
 * `polygonOffset` pulls the wash slightly forward in the depth buffer without
 * moving a vertex, which is what stops it z-fighting with the very surface it
 * sits on. `depthWrite` stays off so it never itself occludes anything drawn
 * after it.
 */
function overlayMaterial(
  colour: number,
  opacity: number,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * Sit a wash mesh over a piece's own faces, not its bounding box, by pointing
 * it at the same geometry as the piece's mesh and copying that mesh's local
 * transform. The geometry is a borrowed reference: it belongs to the pack's
 * shared cache or, while playing, to the bake, and this mesh must never
 * dispose it.
 *
 * A piece with no part (an empty hierarchy node) has no mesh to trace, so
 * there is nothing to wash and the overlay is hidden instead.
 */
function showOverlay(overlay: THREE.Mesh, group: THREE.Group) {
  const mesh = group.children.find((child) => child instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
  if (!mesh) {
    hideOverlay(overlay);
    return;
  }
  overlay.geometry = mesh.geometry;
  overlay.position.copy(mesh.position);
  overlay.rotation.copy(mesh.rotation);
  overlay.scale.copy(mesh.scale);
  group.add(overlay);
  overlay.visible = true;
}

function hideOverlay(overlay: THREE.Mesh) {
  overlay.visible = false;
}

/**
 * Draw a violet box and face wash on every selected piece.
 *
 * A hidden piece is left out: its row stays selectable so it can be unhidden,
 * but there is nothing on screen to draw a box round. The pools are only ever
 * grown, so selecting eight pieces and then one leaves seven idle helpers
 * rather than seven disposed and rebuilt on the next click.
 */
export function showSelection(
  state: SceneState,
  project: LegoProject,
  selectedIds: string[],
) {
  const groups = selectedIds
    .filter((id) => !isEffectivelyHidden(project, id))
    .map((id) => state.groups.get(id))
    .filter((group): group is THREE.Group => group !== undefined);
  state.selectedGroups = groups;

  while (state.selectOutlines.length < groups.length) {
    const helper = new THREE.BoxHelper(state.root, ORIGIN_COLOUR);
    helper.visible = false;
    state.scene.add(helper);
    state.selectOutlines.push(helper);
  }
  while (state.selectOverlays.length < groups.length) {
    const overlay = new THREE.Mesh(
      new THREE.BufferGeometry(),
      state.selectOverlayMaterial,
    );
    overlay.visible = false;
    overlay.raycast = () => {};
    state.selectOverlays.push(overlay);
  }

  state.selectOutlines.forEach((helper, index) => {
    const group = groups[index];
    if (group) helper.setFromObject(group);
    helper.visible = group !== undefined;
  });
  state.selectOverlays.forEach((overlay, index) => {
    const group = groups[index];
    // `showOverlay` adds the wash to the piece's own group, which takes it off
    // whichever group had it before.
    if (group) showOverlay(overlay, group);
    else hideOverlay(overlay);
  });
}

/** Keep the boxes on the pieces while a drag moves them. */
function refreshSelectionOutlines(state: SceneState) {
  state.selectedGroups.forEach((group, index) => {
    state.selectOutlines[index]?.setFromObject(group);
  });
}

/**
 * Point the gizmo at whatever the selection means: one piece's own group, or
 * an object at the midpoint of a set.
 *
 * Nothing gets handles while an anchor is being placed, because they would sit
 * over the middle of the very piece the click has to reach, and nothing gets
 * them for a selection with nothing movable in it: the root is the unit, and a
 * hidden piece is not on screen to drag.
 */
export function attachGizmo(
  state: SceneState,
  project: LegoProject,
  selectedIds: string[],
  placingAnchor: boolean,
) {
  // Editing a volume takes the handles off the pieces entirely. One set of
  // handles cannot mean two things, and a volume is a property of the unit or
  // of one named piece rather than of whichever piece is selected behind it.
  const box = handleBox(state);
  if (box) {
    state.groupIds = [];
    state.groupChanges = new Map();
    // The face plates are the volume's size control, so the gizmo stands down
    // in scale mode rather than offering a second, worse one.
    if (state.gizmo.getMode() === "scale") state.gizmo.detach();
    else state.gizmo.attach(box);
    return;
  }

  // The aim point is one point, so it only ever moves. There is no size to
  // grab and nothing to turn, which is why it gets the gizmo and no plates.
  if (state.editAim && state.aimMark.visible && state.onAimChangeRef.current) {
    state.groupIds = [];
    state.groupChanges = new Map();
    state.gizmo.attach(state.aimMark);
    return;
  }

  const roots = transformRoots(project, selectedIds).filter(
    (id) => !isEffectivelyHidden(project, id) && state.groups.has(id),
  );
  state.groupIds = roots;
  state.groupChanges = new Map();

  if (placingAnchor || roots.length === 0) {
    state.gizmo.detach();
    return;
  }
  if (roots.length === 1) {
    const group = state.groups.get(roots[0]);
    if (group) state.gizmo.attach(group);
    else state.gizmo.detach();
    return;
  }

  const pivot = groupPivot(project, roots);
  state.groupPivotAt = pivot;
  state.groupPivot.position.set(...pivot);
  state.groupPivot.rotation.set(0, 0, 0);
  state.groupPivot.scale.set(1, 1, 1);
  state.gizmo.attach(state.groupPivot);
}

/**
 * Turn a drag of the group pivot into a transform for each piece in the set.
 *
 * The gesture is read off the pivot once and handed to `groupTransform`, which
 * works out where each piece lands. The answer is put straight onto the scene
 * so the drag is visible, and kept for the commit, so what was drawn is
 * exactly what gets saved.
 */
function dragGroup(state: SceneState) {
  const pivot = state.groupPivot;
  const at = state.groupPivotAt;
  const rotating = state.gizmo.getMode() === "rotate";

  // One number, not three. A non-uniform scale about a shared point shears
  // any piece turned relative to it, and a shear is not something a piece's
  // position, rotation and scale can hold.
  const scale = draggedScale(pivot);
  pivot.scale.setScalar(scale);

  const euler = new THREE.Euler().setFromQuaternion(pivot.quaternion);
  let rotation: Vec3 = [euler.x, euler.y, euler.z];
  // The same 15 degree steps a single piece lands on, applied to the pivot
  // itself so the handles show where the set has actually gone.
  if (rotating && state.snapping) {
    rotation = snapRotation(rotation, ROTATION_STEP);
    pivot.rotation.set(...rotation);
  }

  const changes = groupTransform(state.projectRef.current, state.groupIds, at, {
    position: [
      pivot.position.x - at[0],
      pivot.position.y - at[1],
      pivot.position.z - at[2],
    ],
    rotation,
    scale,
  });
  state.groupChanges = changes;

  for (const [pieceId, transform] of changes) {
    const group = state.groups.get(pieceId);
    if (!group) continue;
    group.position.set(...transform.position);
    group.rotation.set(...transform.rotation);
    group.scale.set(...transform.scale);
  }

  // A set seats against nothing: there is no one anchor on it to seat with.
  // Its turn still lands on the same 15 degree steps a single piece's does.
  state.onSnapChange(rotating && state.snapping);
}

/** The scale a drag has put on the pivot, read off the axis that moved. */
function draggedScale(pivot: THREE.Object3D): number {
  let ratio = 1;
  for (let axis = 0; axis < 3; axis++) {
    const candidate = pivot.scale.getComponent(axis);
    if (Math.abs(candidate - 1) > Math.abs(ratio - 1)) ratio = candidate;
  }
  return ratio;
}

/** Write a finished group drag back to the document, as one edit. */
function commitGroup(state: SceneState) {
  const changes = state.groupChanges;
  state.groupChanges = new Map();
  state.onSnapChange(false);
  if (changes.size > 0) state.onTransformManyRef.current(changes);
}

/**
 * Resolve what should count as hovered, apply the outline and wash for it,
 * and report the result back to whichever raycast or pointer event asked.
 *
 * Split from `applyHoveredId` because a change coming from the `hoveredId`
 * prop (the sidebar tree hovering a row) must not itself call back out through
 * `onHoverRef`: that would immediately overwrite the tree's own hover state,
 * most visibly for a hidden piece, which resolves to nothing here but is still
 * exactly what the tree row is hovering.
 */
function setHoveredAndNotify(state: SceneState, pieceId: string | null) {
  const previous = state.hoveredId;
  const resolved = applyHoveredId(state, pieceId);
  if (resolved !== previous) state.onHoverRef.current?.(resolved);
}

/**
 * Resolve, store and draw the hovered piece, without notifying anyone.
 *
 * A hidden piece (or one behind a hidden ancestor) resolves to nothing: there
 * is nothing on screen to point at, so there is nothing to hover.
 */
function applyHoveredId(
  state: SceneState,
  pieceId: string | null,
): string | null {
  const resolved = resolveHovered(state.projectRef.current, pieceId);
  if (resolved !== state.hoveredId) {
    state.hoveredId = resolved;
    applyHoverVisual(state);
    state.render();
  }
  return resolved;
}

/** Never a hidden piece, or one behind a hidden ancestor: there is nothing on
 *  screen for either of those to point at. */
export function resolveHovered(
  project: LegoProject,
  pieceId: string | null,
): string | null {
  return pieceId && !isEffectivelyHidden(project, pieceId) ? pieceId : null;
}

/**
 * Draw (or clear) the hover outline and wash for whatever `state.hoveredId` is
 * now. A selected piece is skipped even if it is also the hovered one: its own
 * outline, wash and gizmo already say enough, and a second wash in a different
 * colour on the same faces would only look muddy.
 */
export function applyHoverVisual(state: SceneState) {
  const id = state.hoveredId;
  const group =
    id && !state.selectedIdsRef.current.includes(id)
      ? state.groups.get(id)
      : undefined;
  if (group) {
    state.hoverOutline.setFromObject(group);
    state.hoverOutline.visible = true;
    showOverlay(state.hoverOverlay, group);
  } else {
    state.hoverOutline.visible = false;
    hideOverlay(state.hoverOverlay);
  }
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
export function showBaked(
  state: SceneState,
  pack: LoadedPack,
  raw: RawGeometry | null,
  project: LegoProject,
) {
  // Baking again on every change to the document, so freeing what the last
  // bake built belongs here rather than only at the end of playback.
  disposeBaked(state);
  const { pieces } = bakedPieces(project, pack, raw);
  const material = unitMaterial(state, pack, project);

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
      // Reassigned rather than left as it was, because the unit's atlas can
      // change under a mesh that already exists.
      mesh.material = material;
      // Baked vertices already sit around the origin, so the offset the
      // editing scene puts on the mesh has to come back off.
      mesh.position.set(0, 0, 0);
    } else {
      const added = new THREE.Mesh(geometry, material);
      added.userData.pieceId = pieceId;
      group.add(added);
    }
  }
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
function unitMaterial(
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

/** Free the geometry playback built. The shared part cache is untouched. */
export function disposeBaked(state: SceneState) {
  for (const geometry of state.baked) geometry.dispose();
  state.baked = [];
  state.rest = new Map();
}

/**
 * Frame the selection: move the orbit target to the box round everything in
 * it, and pull the camera in along the direction it is already looking.
 *
 * With nothing selected the whole unit is framed instead. That reads as more
 * useful than F doing nothing, and matches other 3D tools' "frame all"
 * behaviour for an empty selection.
 *
 * A unit with no geometry in it at all has nothing to frame, whatever is
 * selected, so the camera goes home instead: the same place the compass puts
 * it, and for the same reason. Measuring the scene made this case look like a
 * unit the size of a point at the origin, because a selected piece's pivot dot
 * is in the scene as well as its geometry, and F dived at the dot. The
 * document's own box has no dots in it, and no reference figure either: the
 * figure stands beside the unit for scale and is not the work being framed.
 */
export function focusSelection(state: SceneState, pieceIds: string[]) {
  const unit = boundsBox(
    unitBounds(
      state.projectRef.current,
      state.packRef.current,
      state.rawRef.current,
    ),
  );
  if (!unit) {
    homeView(state);
    state.render();
    return;
  }

  const groups = pieceIds
    .map((id) => state.groups.get(id))
    .filter((group): group is THREE.Group => group !== undefined);
  if (groups.length === 0) {
    if (frameBounds(state, unit)) state.render();
    return;
  }

  const box = new THREE.Box3();
  for (const group of groups) box.union(new THREE.Box3().setFromObject(group));
  if (frameBounds(state, box)) state.render();
}

/**
 * Move the orbit target to `object`'s world-space bounding box and pull the
 * camera in along the direction it is already looking. Returns false, leaving
 * the camera untouched, when the box is empty: an object with no geometry
 * (an empty piece, or a unit that is only empty pieces) has nothing to frame.
 *
 * Used by the opening frame, which frames the whole unit once as soon as its
 * geometry exists.
 */
export function frameObject(
  state: SceneState,
  object: THREE.Object3D,
): boolean {
  return frameBounds(state, new THREE.Box3().setFromObject(object));
}

/** The view the builder opens on: the home camera, looking at the origin.
 *  Where the camera lands when there is nothing to frame. */
function homeView(state: SceneState) {
  state.camera.position.set(...HOME_CAMERA);
  state.controls.target.set(0, 0, 0);
  state.controls.update();
}

/** The unit's own measured box, or null when it has no geometry to frame: a
 *  unit with no vertices measures zero on every axis. */
function boundsBox(bounds: UnitBounds): THREE.Box3 | null {
  if (bounds.sizeX === 0 && bounds.sizeY === 0 && bounds.sizeZ === 0) {
    return null;
  }
  return new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(...bounds.mid),
    new THREE.Vector3(bounds.sizeX, bounds.sizeY, bounds.sizeZ),
  );
}

/** The same, from a box that is already worked out: framing a set unions the
 *  boxes of several pieces rather than taking one object's own. `from` is the
 *  direction to look from when the caller wants a set one, and defaults to the
 *  direction the camera is already looking. */
function frameBounds(state: SceneState, box: THREE.Box3, from?: Vec3): boolean {
  if (box.isEmpty()) return false;

  // The direction from the target to the camera, not the camera to the
  // target: keeping this fixed and only moving the target and the distance
  // along it is what stops framing from spinning the view to a new angle.
  const offset = new THREE.Vector3().subVectors(
    state.camera.position,
    state.controls.target,
  );

  const { target, position } = frameBox(
    {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    },
    from ?? [offset.x, offset.y, offset.z],
    THREE.MathUtils.degToRad(state.camera.fov),
  );

  state.controls.target.set(...target);
  state.camera.position.set(...position);
  state.controls.update();
  return true;
}

/**
 * Size the camera's reach and the ground's to what is actually in the scene:
 * the unit being built, and whatever reference figure is standing beside it.
 *
 * Both used to be constants picked when the only reference was a solar
 * collector, 43 elmos across. A figure read out of an installed game is any
 * size at all, and the big ones are far bigger than that: Balanced
 * Annihilation's Krogoth gantry is 125 elmos wide, its Buzzsaw 190 tall. At
 * the old limits neither could be got fully in shot, and the gantry stood off
 * the end of the ground it is there to be measured against.
 *
 * Called whenever the unit or the figure changes, which is cheap: it measures
 * two bounding boxes and only lays the ground again when the answer crosses a
 * whole footprint step.
 */
export function applySceneScale(state: SceneState) {
  const box = new THREE.Box3().setFromObject(state.root);
  // Only when it is standing. A figure that has been picked but switched off
  // is not in the scene, and should not stretch the ground out under nothing.
  if (state.reference.visible) {
    box.union(new THREE.Box3().setFromObject(state.reference));
  }
  if (box.isEmpty()) return;

  // Measured from the world origin rather than from the box's own middle,
  // because the orbit target sits on the unit, which is built at the origin,
  // not on the middle of a scene a reference has pulled off to one side.
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.center.length() + sphere.radius;

  const fit = radius / Math.sin(THREE.MathUtils.degToRad(state.camera.fov) / 2);
  state.controls.maxDistance = Math.max(
    MIN_MAX_DISTANCE,
    fit * ZOOM_OUT_PADDING,
  );
  // The ground is flat, so only how far the scene spreads matters here, not
  // how tall it stands.
  layGround(state, Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z, 0));

  // Far enough to still draw the far side of the scene from the furthest back
  // the camera can now get. Measured against the ground too, not just what
  // stands on it: the ground is always the wider of the two, so its far corner
  // is what the far plane cuts off first. It is centred on the origin, so its
  // bounding sphere's radius is that corner's distance.
  const ground = new THREE.Box3()
    .setFromObject(state.grid)
    .getBoundingSphere(new THREE.Sphere()).radius;
  state.camera.far = Math.max(
    MIN_FAR,
    state.controls.maxDistance + Math.max(radius, ground),
  );
  state.camera.updateProjectionMatrix();
}

/** Lay the ground again when it has to reach further than it does. Skipped
 *  whenever the step count is unchanged, which is nearly always: each plate
 *  carries a label drawn on its own canvas. */
function layGround(state: SceneState, reachElmos: number) {
  const steps = groundSteps(reachElmos);
  if (steps === state.groundSteps) return;
  state.groundSteps = steps;

  const { visible } = state.grid;
  state.scene.remove(state.grid);
  disposeGround(state.grid);
  state.grid = buildGround(reachElmos);
  state.grid.visible = visible;
  state.scene.add(state.grid);
}

/**
 * Write a moved aim point back to the document.
 *
 * Straight off the marker's position, because the aim point is measured from
 * the unit's own origin and the marker is drawn at exactly that point. What has
 * to move with it, the collision volume's offsets and a stale imported radius,
 * is the caller's business: the same handler the aim panel's fields use.
 */
function commitAim(state: SceneState) {
  const { position } = state.aimMark;
  state.onAimChangeRef.current?.([position.x, position.y, position.z]);
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
export function pieceIdOf(object: THREE.Object3D | null): string | null {
  let at: THREE.Object3D | null = object;
  while (at) {
    const id = at.userData.pieceId;
    if (typeof id === "string") return id;
    at = at.parent;
  }
  return null;
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
