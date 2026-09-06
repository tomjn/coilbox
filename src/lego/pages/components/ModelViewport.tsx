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
import {
  buildFrontMarker,
  buildGround,
  disposeFrontMarker,
  disposeGround,
  groundSteps,
  REFERENCE_PARK_X,
} from "../../buildPlate";
import {
  type BackdropId,
  disposeTerrain,
  type GroundId,
} from "../../environment";
import { addStandardLights } from "../../geometry";
import type { PieceTransform } from "../../groupTransform";
import {
  type LegoCollisionVolume,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import {
  buildReferenceUnit,
  disposeReferenceUnit,
} from "../../referenceObject";
import { unitBounds } from "../../s3oBuild";
import type { ScriptTimeline } from "../../scriptPlayback";
import type { Vec3 } from "../../snapping";
import { captureThumbnail, readyToCapture } from "../../thumbnail";
import {
  applySnap,
  clearAnchors,
  forceUniformScale,
  showSeat,
  showTargetAnchors,
} from "./anchorsAndSnapping";
import { disposeBaked, showBaked } from "./bakedPlayback";
import {
  applySceneScale,
  boundsBox,
  frameBounds,
  homeView,
} from "./cameraFraming";
import {
  buildCollisionHandles,
  commitCollision,
  commitPieceCollision,
  handleBox,
} from "./collisionHandles";
import {
  disposePieceCollision,
  showCollisionVolume,
  showPieceCollisionVolumes,
} from "./collisionVolumes";
import { dotMaterial, points } from "./dotsAndPoints";
import { EnvironmentPicker } from "./EnvironmentPicker";
import {
  commitAim,
  commitGizmo,
  commitGroup,
  dragGroup,
  pieceIdOf,
} from "./gizmoCommit";
import { attachPointerHandlers } from "./pointerHandlers";
import { type GameReferenceChoice, ReferencePicker } from "./ReferencePicker";
import { ShortcutSheet } from "./ShortcutSheet";
import type { SceneState } from "./sceneState";
import {
  overlayMaterial,
  refreshSelectionOutlines,
  setHoveredAndNotify,
} from "./selectionAndHoverOutlines";
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
export const ORIGIN_COLOUR = 0x8b5cf6;
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
export const HOME_CAMERA: [number, number, number] = [9, 7, 11];

/**
 * How far the camera may pull back, and how far it can see, when the scene is
 * no bigger than the builder's own defaults. Both grow with the scene: see
 * `applySceneScale`. Neither ever shrinks below these, so a unit on its own
 * behaves exactly as it always has.
 */
export const MIN_MAX_DISTANCE = 120;
export const MIN_FAR = 500;
/** Slack past a tight fit, so the whole scene is comfortably inside the view at
 *  the furthest the camera can go rather than flush with its edges. The same
 *  figure `framing.ts` pads a framed box by. */
export const ZOOM_OUT_PADDING = 1.3;

/** Rotation lands on 15 degree steps unless snapping is held off. */
export const ROTATION_STEP = Math.PI / 12;

interface Props {
  /** The piece hierarchy, and the raw geometry of a unit imported from
   *  somebody else's model rather than built from parts. */
  document: {
    pack: LoadedPack;
    /** The meshes of a unit imported from somebody else's model, if it is one. */
    raw: RawGeometry | null;
    project: LegoProject;
  };
  /** Which pieces are picked, and what a click, a drag or a hover does. */
  selection: {
    /** Every selected piece, oldest first. One is the ordinary case. */
    selectedIds: string[];
    /** `additive` is a Shift or Cmd click: add this piece to the selection
     *  rather than replacing it. */
    onSelect: (pieceId: string | null, additive: boolean) => void;
    /** Committed when a drag ends, not on every frame of it. */
    onTransform: (pieceId: string, change: Partial<LegoPiece>) => void;
    /** The same, for a set: every piece's new transform in one edit, so a
     *  group drag is one undo step rather than one per piece. */
    onTransformMany: (changes: Map<string, PieceTransform>) => void;
    /**
     * The piece to highlight as hovered regardless of where the pointer is,
     * e.g. because the sidebar's tree row for it is hovered instead of the
     * canvas.
     */
    hoveredId?: string | null;
    /** Told whenever the piece under the pointer in this view changes, so the
     *  sidebar tree can highlight the matching row. */
    onHover?: (pieceId: string | null) => void;
  };
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
  /** The applied presets, or a unit's own script, playing or scrubbed. */
  scriptPlayback: {
    /** Runs the applied presets. Nothing is written: stopping restores the
     *  rest pose exactly, because it comes back from the document. */
    playing?: boolean;
    /**
     * Poses to play instead of the presets, for a unit whose script is its
     * own. The presets are gone for such a unit, so this is what playing
     * means for it.
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
     * Told which frame a script run is showing, every tick it is not paused,
     * so a scrubber can track playback and know where a pause should hold.
     */
    onScriptFrame?: (frame: number) => void;
  };
  /** Scale handles keep the piece's proportions. */
  uniformScale?: boolean;
  /** Drop the unit onto y = 0. Absent hides the button. */
  onGround?: () => void;
  /** The toolbar's actions on the current selection: duplicate, paste,
   *  save as a compound and delete, and whether each is available. */
  pieceActions: {
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
    /** Save the selected piece and everything under it, to reuse in another
     *  unit. */
    onSaveAsCompound: () => void;
    canSaveAsCompound: boolean;
    /** Delete every selected piece (Backspace). */
    onDelete: () => void;
    canDelete: boolean;
  };
  /**
   * Whether a new piece gets a mirrored twin the first time it is placed off
   * the centre line (M). A setting for the session, not part of the unit, so
   * it lives with the page rather than the document.
   */
  symmetry: {
    on: boolean;
    onChange: (on: boolean) => void;
  };
  /** Arming the next click to drop a snap anchor instead of selecting, and
   *  what to do with the click that follows. */
  anchorPlacement: {
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
  };
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
  document,
  selection,
  onReady,
  scriptPlayback,
  uniformScale = false,
  onGround,
  pieceActions,
  symmetry,
  anchorPlacement,
  editCollision = false,
  onCollisionChange,
  editPieceCollisionId = null,
  onPieceCollisionVolumeChange,
  showAimPoint = false,
  onAimChange,
}: Props) {
  const { pack, raw, project } = document;
  const {
    selectedIds,
    onSelect,
    onTransform,
    onTransformMany,
    hoveredId,
    onHover,
  } = selection;
  const {
    playing = false,
    scriptTimeline = null,
    scriptPaused = false,
    scriptFrame = 0,
    onScriptFrame,
  } = scriptPlayback;
  const {
    onDuplicate,
    canDuplicate,
    onPaste,
    onSaveAsCompound,
    canSaveAsCompound,
    onDelete,
    canDelete,
  } = pieceActions;
  const { on: symmetryOn, onChange: onSymmetryChange } = symmetry;
  const {
    placingAnchor = false,
    onPlaceAnchor,
    onCancelAnchor,
  } = anchorPlacement;
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
        onSelectRef,
        dragging: false,
      };
      sceneRef.current = state;

      // `mouseDown` and `mouseUp`, not `dragging-changed`: this version of
      // TransformControls does not dispatch that one, so listening for it left
      // orbit running during a drag, and never wrote the moved transform back.
      // The next edit then resynced the scene from a document that still had
      // every piece at the origin.
      gizmo.addEventListener("mouseDown", () => {
        controls.enabled = false;
        state.dragging = true;
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
        state.dragging = false;
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

      // Collision-face dragging, click-to-select, click-to-place-anchor and
      // hover: all DOM listeners on the finished canvas rather than anything
      // with its own lifetime, so they live apart from the scene this effect
      // builds. See pointerHandlers.ts for the registration order this
      // depends on.
      const detachPointerHandlers = attachPointerHandlers(state);

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
          detachPointerHandlers();
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
                    variant={symmetryOn ? "default" : "outline"}
                    onClick={() => onSymmetryChange(!symmetryOn)}
                    aria-pressed={symmetryOn}
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
