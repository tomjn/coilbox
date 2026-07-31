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
  FlipHorizontal2,
  Grid3x3,
  Keyboard,
  Move,
  PackagePlus,
  RotateCw,
  Scaling,
  Trash2,
} from "lucide-react";
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
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { type AnimPreset, presetById } from "../../animPresets";
import { unitAtlas } from "../../atlas";
import {
  buildFrontMarker,
  buildGround,
  disposeFrontMarker,
  disposeGround,
  groundSteps,
  REFERENCE_PARK_X,
  referenceParkX,
} from "../../buildPlate";
import {
  effectiveCollisionVolume,
  engineScales,
  resizeCollisionFace,
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
import { addStandardLights, partMaterial } from "../../geometry";
import {
  groupPivot,
  groupTransform,
  type PieceTransform,
  transformRoots,
} from "../../groupTransform";
import {
  descendantIds,
  isEffectivelyHidden,
  type LegoCollisionVolume,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import { seatPieceMesh } from "../../pivot";
import {
  buildGameReferenceUnit,
  buildReferenceUnit,
  disposeReferenceUnit,
} from "../../referenceObject";
import {
  type BakedPiece,
  bakedPieces,
  type UnitBounds,
  unitBounds,
} from "../../s3oBuild";
import { isShortcut } from "../../shortcuts";
import {
  type Anchor,
  nearestSnap,
  pieceAnchors,
  screenPixelsToWorld,
  snapRotation,
  type Vec3,
} from "../../snapping";
import { captureThumbnail } from "../../thumbnail";
import { EnvironmentPicker } from "./EnvironmentPicker";
import { type GameReferenceChoice, ReferencePicker } from "./ReferencePicker";
import { ShortcutSheet } from "./ShortcutSheet";

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
/** A seat the modeller marked, which is the only kind that piece then offers. */
const CUSTOM_COLOUR = 0xf472b6;
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
const SELECT_OVERLAY_OPACITY = 0.22;
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
const SEAT_COLOUR = 0x34d399;
const SEAT_DOT = 11;
/** A target anchor nothing is near. Warms towards `SEAT_COLOUR` on approach. */
const TARGET_COLD = 0x64748b;
/**
 * The collision volume's wireframe. Orange because nothing else in the scene
 * is: it is a reading about the unit rather than a part of it, so it has to be
 * telling apart from the selection, the anchors and the front marker at a
 * glance.
 */
const COLLISION_COLOUR = 0xf97316;

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

/**
 * How close two anchors must be before a piece seats against another,
 * expressed as screen pixels rather than world units, so a snap reaches the
 * same distance on screen whatever the camera is doing.
 *
 * At the home camera position and a typical panel height, 0.45 world units
 * (the fixed figure this replaces) works out to about 23px, so 24px keeps
 * the default snap feeling much the same. It also sits in the 20-30px range
 * that feels natural for a snap radius in other 3D tools.
 */
const SNAP_PIXELS = 24;
/** Rotation lands on 15 degree steps unless snapping is held off. */
const ROTATION_STEP = Math.PI / 12;

interface Props {
  pack: LoadedPack;
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
   */
  onReady?: (capture: () => HTMLCanvasElement) => void;
  /** Runs the applied presets. Nothing is written: stopping restores the rest
   *  pose exactly, because it comes back from the document. */
  playing?: boolean;
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
}

export function ModelViewport({
  pack,
  project,
  selectedIds,
  onSelect,
  onTransform,
  onTransformMany,
  hoveredId,
  onHover,
  onReady,
  playing = false,
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
}: Props) {
  // The one selected piece, when there is exactly one. Anchors, the key at the
  // bottom of the view and the pivot dot are all about a single piece: a set
  // is dragged about its midpoint and seats against nothing.
  const soleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;
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
    const bounds = unitBounds(project, pack);
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
  const placingAnchorRef = useRef(placingAnchor);
  placingAnchorRef.current = placingAnchor;
  const onPlaceAnchorRef = useRef(onPlaceAnchor);
  onPlaceAnchorRef.current = onPlaceAnchor;
  const onCancelAnchorRef = useRef(onCancelAnchor);
  onCancelAnchorRef.current = onCancelAnchor;
  const onCollisionChangeRef = useRef(onCollisionChange);
  onCollisionChangeRef.current = onCollisionChange;

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
        opacity: 0.9,
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
        collisionDrag: null,
        onCollisionChangeRef,
        sky: null,
        terrain: null,
        groups: new Map(),
        baked: [],
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
        if (gizmo.object === state.collision) commitCollision(state);
        else if (gizmo.object === groupPivot) commitGroup(state);
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
          sceneRef.current = null;
        },
      };
    },
    [reduceMotion],
  );

  // Structure and transforms both land here, because a piece added and a piece
  // moved are the same operation on the same map. While playing, the bake goes
  // back over the top: changing an animation's parameters must not drop the
  // scene back to its unbaked form mid-cycle.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    syncScene(state, pack, project);
    // Framed once per scene, the moment the whole unit's geometry first has
    // something in it. A brand new unit's root piece is empty, so this keeps
    // retrying on every sync (each one is cheap: an empty box, nothing more)
    // until a piece with geometry exists, rather than giving up after the
    // first, geometry-less attempt. Once it succeeds, `framed` stops it ever
    // running again for this scene, so it never fights a camera the user has
    // since moved.
    if (!state.framed && frameObject(state, state.root)) state.framed = true;
    if (playing && !reduceMotion) showBaked(state, pack, project);
    applySceneScale(state);
    state.render();
  }, [pack, project, playing, reduceMotion]);

  // Before the gizmo below, which may have to point at what this builds.
  // Follows the document as well as the toggle: the derived volume is the
  // unit's own bounding box, so it changes every time a piece does.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.editCollision = editCollision;
    const shown = showCollision || editCollision;
    showCollisionVolume(state, shown ? project : null, pack);
    // The handles move between the volume and the selected piece with this, so
    // they are re-pointed here rather than left until the selection changes.
    attachGizmo(
      state,
      project,
      selectedIdsRef.current,
      placingAnchorRef.current,
    );
    showCollisionHandles(state);
    state.render();
  }, [showCollision, editCollision, project, pack]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showSelection(state, project, selectedIds);
    attachGizmo(state, project, selectedIds, placingAnchor);
    // The new selection may be a piece already showing a hover treatment,
    // which now has to stand down in favour of the (stronger) selected look.
    applyHoverVisual(state);
    state.render();
  }, [selectedIds, project, placingAnchor]);

  // Independent of the pointer: the hovered piece can arrive from the sidebar
  // tree instead of a raycast, and does not report back up when it does, so
  // this never fights with what the pointer itself is over. Unlike the
  // pointer-driven path this always redraws rather than bailing out when the
  // id has not changed, so an edit to the hovered piece itself (a transform
  // typed into a field, an undo) still keeps its outline and wash in step.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.hoveredId = resolveHovered(project, hoveredId ?? null);
    applyHoverVisual(state);
    state.render();
  }, [hoveredId, project]);

  // Declared after the scene sync, so the group a new piece needs already
  // exists by the time this looks for it. Playback clears them: the baked scene
  // has no pivot left to point at. So does a set: a group drag seats against
  // nothing, so fifteen dots per piece would be pointing at nothing.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    showAnchors(state, pack, project, playing ? null : soleSelectedId);
    state.render();
  }, [pack, project, soleSelectedId, playing]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    // Rotate falls back to move on a volume, which has no rotation to drag.
    state.gizmo.setMode(
      editCollision && mode === "rotate" ? "translate" : mode,
    );
    // Scale on a volume is the face plates rather than the gizmo, so the mode
    // decides which of the two is on screen.
    attachGizmo(
      state,
      state.projectRef.current,
      state.selectedIdsRef.current,
      state.placingAnchorRef.current,
    );
    showCollisionHandles(state);
    state.render();
  }, [mode, editCollision]);

  useEffect(() => {
    const state = sceneRef.current;
    if (state) state.uniformScale = uniformScale;
  }, [uniformScale]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.grid.visible = showGrid;
    state.axes.visible = showGrid;
    state.render();
  }, [showGrid]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.reference.visible = showReference;
    applySceneScale(state);
    state.render();
  }, [showReference]);

  // Read by the swap below, which must not itself rerun on a toggle: rebuilding
  // a game's model every time the figure is hidden and shown again would throw
  // its geometry away and read it back.
  const showReferenceRef = useRef(showReference);
  showReferenceRef.current = showReference;

  // Swapping the figure for a game's unit, and back. The old one is freed
  // rather than kept: a real unit can be tens of thousands of triangles and
  // several textures, and the built-in one is cheap to rebuild.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.scene.remove(state.reference);
    state.disposeReference();

    if (gameReference) {
      const built = buildGameReferenceUnit(gameReference.model);
      built.group.position.set(referenceParkX(built.widthElmos), 0, 0);
      state.reference = built.group;
      state.disposeReference = built.dispose;
    } else {
      const group = buildReferenceUnit();
      group.position.set(REFERENCE_PARK_X, 0, 0);
      state.reference = group;
      state.disposeReference = () => disposeReferenceUnit(group);
    }

    state.reference.visible = showReferenceRef.current;
    state.scene.add(state.reference);
    applySceneScale(state);
    state.render();
  }, [gameReference]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    applyBackdrop(state, backdrop);
    state.render();
  }, [backdrop]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    applyGround(state, ground);
    state.render();
  }, [ground]);

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
      attachGizmo(
        current,
        projectRef.current,
        selectedIds,
        placingAnchorRef.current,
      );
      current.render();
    };
  }, [playing, reduceMotion, selectedIds]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.onSnapChange = (on, anchorName) => {
      setSnapped(on);
      setSnappedTo(anchorName ?? null);
    };
  }, []);

  // Held rather than toggled: snapping is on, and letting go of it is a
  // deliberate act for the one piece that has to sit off the grid.
  useEffect(() => {
    const setSnapping = (on: boolean) => {
      const state = sceneRef.current;
      if (state) state.snapping = on;
    };
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (isShortcut("snap-hold", event)) setSnapping(false);
      if (isShortcut("translate", event)) setMode("translate");
      if (isShortcut("rotate", event)) setMode("rotate");
      if (isShortcut("scale", event)) setMode("scale");
      if (isShortcut("frame", event)) {
        const state = sceneRef.current;
        if (state) focusSelection(state, selectedIdsRef.current);
      }
      if (isShortcut("shortcuts", event)) setShortcutsOpen(true);
    };
    const up = (event: KeyboardEvent) => {
      if (!isShortcut("snap-hold", event)) setSnapping(true);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

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
                const off = editCollision && id === "rotate";
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
                      {off
                        ? "A collision volume has no rotation"
                        : `${label} (${key})`}
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
      <ButtonGroup className="absolute bottom-3 right-3">
        <Button
          size="icon"
          variant="outline"
          onClick={() => setShowGrid(!showGrid)}
          aria-pressed={showGrid}
          title={
            showGrid
              ? "Hide the ground grid"
              : "Show the ground grid, marked in footprint steps and plate sizes"
          }
        >
          <Grid3x3 className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={() => setShowCollision(!showCollision)}
          aria-pressed={showCollision}
          title={
            showCollision
              ? "Hide the collision volume"
              : "Show the collision volume, the shape the engine hits and clicks"
          }
        >
          <Box className="size-4" />
        </Button>
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
        <Button
          size="icon"
          variant="outline"
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="size-4" />
        </Button>
        <AxisCompass svgRef={compassRef} onClick={resetView} />
      </ButtonGroup>

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

/** The three world axes as seen from here, and a click to face front again. */
function AxisCompass({
  svgRef,
  onClick,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  onClick: () => void;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      onClick={onClick}
      title="Reset the view"
      aria-label="Reset the view"
    >
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
    </Button>
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

/** Which face of the volume a grab plate is, carried on the plate itself so a
 *  raycast hit says what it dragged. */
interface CollisionFace {
  axis: 0 | 1 | 2;
  /** Which end of that axis: the high face or the low one. */
  sign: 1 | -1;
}

/** A face of the volume being dragged. */
interface CollisionFaceDrag extends CollisionFace {
  /** The pointer is followed on this plane. It holds the axis and faces the
   *  camera, so the face tracks the pointer from any angle. */
  plane: THREE.Plane;
  /** The model's middle, which the volume's offsets are measured from. Fixed
   *  for the length of the drag: the unit cannot change while it runs. */
  mid: [number, number, number];
  /** The volume when the face was grabbed. Every frame sizes this rather than
   *  the last frame's answer, so the opposite face cannot creep. */
  from: LegoCollisionVolume;
  /** What the wireframe is showing now, and what release writes. */
  volume: LegoCollisionVolume;
}

interface SceneState {
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
  /** A grab plate on each of the volume's six faces, which is how the volume
   *  is sized. Built with the scene and moved onto the volume from there. */
  collisionHandles: THREE.Group;
  collisionHandleMaterial: THREE.MeshBasicMaterial;
  /** The same plate under the pointer, or being dragged. */
  collisionHandleHotMaterial: THREE.MeshBasicMaterial;
  /** The face drag in progress, or null while nothing is being sized. */
  collisionDrag: CollisionFaceDrag | null;
  onCollisionChangeRef: {
    current: ((volume: LegoCollisionVolume) => void) | undefined;
  };
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
function applyBackdrop(state: SceneState, id: BackdropId) {
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
 * The volume is positioned from the model's middle, because that is where the
 * engine measures its offsets from, so a volume with no offset sits on the
 * middle of the unit's bounding box exactly as it will in a game.
 *
 * A null project means "not showing", which is also what leaves nothing behind
 * to keep in step with the document.
 *
 * The shape is built one elmo across and the object carries its size, so the
 * volume's own numbers are the object's transform and a drag needs no
 * conversion to read back.
 */
function showCollisionVolume(
  state: SceneState,
  project: LegoProject | null,
  pack: LoadedPack,
) {
  if (state.collision) {
    if (state.gizmo.object === state.collision) state.gizmo.detach();
    state.collision.geometry.dispose();
    state.collision.removeFromParent();
    state.collision = null;
  }
  if (!project) return;

  const bounds = unitBounds(project, pack);
  const volume = effectiveCollisionVolume(project, bounds);
  const lines = new THREE.LineSegments(
    collisionWireframe(volume),
    state.collisionMaterial,
  );
  lines.position.set(
    bounds.mid[0] + volume.offsets[0],
    bounds.mid[1] + volume.offsets[1],
    bounds.mid[2] + volume.offsets[2],
  );
  lines.scale.set(...engineScales(volume));
  // Over the model, to match the material's own `depthTest: false`.
  lines.renderOrder = 4;
  lines.raycast = () => {};
  state.collision = lines;
  state.scene.add(lines);
}

/**
 * Put the grab plates on the volume's faces, or take them off screen.
 *
 * They are the volume's size control, and they replace the gizmo rather than
 * joining it: a face plate and a scale handle would be two answers to the same
 * question, and only one of them sizes the thing you are pointing at.
 *
 * Drag one and its own face follows the pointer while the opposite face stays,
 * which is how a box is sized anywhere else. The gizmo's squares could not do
 * that. They multiply the volume by the ratio of two distances from its middle,
 * measured from wherever the handle happens to sit on screen, so the same drag
 * means different sizes at different zooms and dragging through the middle
 * turns the size negative.
 */
function showCollisionHandles(state: SceneState) {
  const lines = state.collision;
  const shown =
    lines !== null && state.editCollision && state.gizmo.getMode() === "scale";
  state.collisionHandles.visible = shown;
  if (!lines || !shown) return;

  const size = [lines.scale.x, lines.scale.y, lines.scale.z];
  state.collisionHandles.position.copy(lines.position);
  for (const plate of state.collisionHandles.children) {
    const { axis, sign } = plate.userData as CollisionFace;
    const across = [0, 1, 2].filter((other) => other !== axis);
    plate.position.setComponent(axis, (sign * size[axis]) / 2);
    const side = plateSize(size[across[0]], size[across[1]]);
    plate.scale.set(side, side, 1);
  }
}

/** How big a grab plate is, given the face it sits on. A quarter of the face's
 *  shorter side, but never so small that a thin volume cannot be grabbed nor so
 *  large that a volume is hidden under its own handles. */
function plateSize(acrossA: number, acrossB: number): number {
  return Math.min(1.5, Math.max(0.4, 0.25 * Math.min(acrossA, acrossB)));
}

/** The six plates, built once with the scene. Squares rather than the gizmo's
 *  arrows: a face is a flat thing and the handle sits on it. */
function buildCollisionHandles(material: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  const square = new THREE.PlaneGeometry(1, 1);
  for (const axis of [0, 1, 2] as const) {
    for (const sign of [1, -1] as const) {
      const plate = new THREE.Mesh(square, material);
      // Turned to lie in the face it sits on, which is also what makes the
      // plate's own z the axis it drags along.
      if (axis === 0) plate.rotation.y = (sign * Math.PI) / 2;
      if (axis === 1) plate.rotation.x = (-sign * Math.PI) / 2;
      if (axis === 2 && sign === -1) plate.rotation.y = Math.PI;
      plate.userData = { axis, sign } satisfies CollisionFace;
      plate.renderOrder = 5;
      group.add(plate);
    }
  }
  group.visible = false;
  return group;
}

/**
 * Start sizing the volume, if the pointer landed on one of the plates.
 *
 * The face is tracked on a plane that holds its axis and faces the camera, so
 * it follows the pointer from any angle. Looking straight down the axis there
 * is no such plane and no drag to be had, which is the one case this refuses.
 */
function beginFaceDrag(state: SceneState, raycaster: THREE.Raycaster): boolean {
  if (!state.collisionHandles.visible) return false;
  const hit = raycaster.intersectObjects(
    state.collisionHandles.children,
    false,
  )[0];
  if (!hit) return false;

  const { axis, sign } = hit.object.userData as CollisionFace;
  const along = new THREE.Vector3().setComponent(axis, 1);
  const eye = state.camera.position.clone().sub(hit.point);
  const normal = eye.sub(along.clone().multiplyScalar(eye.dot(along)));
  if (normal.lengthSq() < 1e-6) return false;

  const project = state.projectRef.current;
  const bounds = unitBounds(project, state.packRef.current);
  const volume = effectiveCollisionVolume(project, bounds);
  state.collisionDrag = {
    axis,
    sign,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      hit.point,
    ),
    mid: bounds.mid,
    from: volume,
    volume,
  };
  highlightHandle(state, hit.object);
  state.controls.enabled = false;
  return true;
}

/** Follow the pointer with the dragged face. Shown live rather than on release,
 *  so the size being set is the size on screen the whole way through. */
function moveFaceDrag(state: SceneState, raycaster: THREE.Raycaster) {
  const drag = state.collisionDrag;
  const lines = state.collision;
  if (!drag || !lines) return;

  const at = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!at) return;

  drag.volume = resizeCollisionFace(
    drag.from,
    drag.axis,
    drag.sign,
    at.getComponent(drag.axis) - drag.mid[drag.axis],
  );
  lines.scale.set(...engineScales(drag.volume));
  lines.position.set(
    drag.mid[0] + drag.volume.offsets[0],
    drag.mid[1] + drag.volume.offsets[1],
    drag.mid[2] + drag.volume.offsets[2],
  );
  showCollisionHandles(state);
  state.render();
}

/** Write the sized volume back to the document, if the drag changed it. A press
 *  that went nowhere is not an edit and does not belong in the undo history. */
function endFaceDrag(state: SceneState) {
  const drag = state.collisionDrag;
  state.collisionDrag = null;
  state.controls.enabled = true;
  highlightHandle(state, null);
  if (!drag) return;
  const change = state.onCollisionChangeRef.current;
  const moved =
    drag.volume.scales.some((size, i) => size !== drag.from.scales[i]) ||
    drag.volume.offsets.some((offset, i) => offset !== drag.from.offsets[i]);
  if (moved && change) change(drag.volume);
  else state.render();
}

/** Light up the plate under the pointer, so it reads as something to grab. */
function highlightHandle(state: SceneState, plate: THREE.Object3D | null) {
  let changed = false;
  for (const other of state.collisionHandles.children) {
    if (!(other instanceof THREE.Mesh)) continue;
    const material =
      other === plate
        ? state.collisionHandleHotMaterial
        : state.collisionHandleMaterial;
    if (other.material === material) continue;
    other.material = material;
    changed = true;
  }
  return changed;
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
function applyGround(state: SceneState, id: GroundId) {
  if (id !== "terrain") {
    state.terrain?.removeFromParent();
    return;
  }
  if (!state.terrain) state.terrain = buildTerrain();
  state.scene.add(state.terrain);
}

/**
 * Every anchor of a piece, in the piece's own space.
 *
 * Anchors are in the part's own space, so the pivot comes off them exactly as
 * it comes off the geometry and they sit on the part however the origin moves.
 */
function localAnchorsOf(
  pack: LoadedPack,
  piece: LegoPiece,
): { anchor: Anchor; position: Vec3 }[] {
  const part = piece.partId ? pack.byId.get(piece.partId) : undefined;
  const pivot = piece.pivot ?? [0, 0, 0];
  return pieceAnchors(part?.bbox ?? null, piece.customAnchors).map(
    (anchor) => ({
      anchor,
      position: [
        anchor.position[0] - pivot[0],
        anchor.position[1] - pivot[1],
        anchor.position[2] - pivot[2],
      ],
    }),
  );
}

/**
 * Every anchor of a piece, in world space.
 *
 * The piece's own transform carries them, so an anchor turns and scales with
 * the piece it is on rather than staying where the piece used to be.
 */
function worldAnchors(
  state: SceneState,
  pack: LoadedPack,
  piece: LegoPiece,
): Anchor[] {
  const group = state.groups.get(piece.id);
  if (!group) return [];
  group.updateWorldMatrix(true, false);

  const point = new THREE.Vector3();
  return localAnchorsOf(pack, piece).map(({ anchor, position }) => {
    point.set(...position).applyMatrix4(group.matrixWorld);
    return { ...anchor, position: [point.x, point.y, point.z] as Vec3 };
  });
}

/**
 * Turn a click on the model into an anchor on the piece it landed on.
 *
 * The point is handed back in that piece's part space, which is the frame an
 * anchor is stored in, so it stays on the surface it was clicked on however the
 * piece is later moved, turned or scaled. A click that hit nothing means the
 * pointer was aimed at the background, which is how you change your mind.
 */
function placeAnchor(state: SceneState, hit: THREE.Intersection | undefined) {
  const pieceId = hit ? pieceIdOf(hit.object) : null;
  const group = pieceId ? state.groups.get(pieceId) : undefined;
  const piece = pieceId
    ? pieceById(state.projectRef.current, pieceId)
    : undefined;
  if (!hit || !pieceId || !group || !piece) {
    state.onCancelAnchorRef.current?.();
    return;
  }

  group.updateWorldMatrix(true, false);
  const local = hit.point
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert());
  const pivot = piece.pivot ?? [0, 0, 0];
  state.onPlaceAnchorRef.current?.(pieceId, [
    local.x + pivot[0],
    local.y + pivot[1],
    local.z + pivot[2],
  ]);
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

  const targets = snapTargets(state, pack, project, pieceId);
  const targetPoints = targets.map((target) => target.position);
  const mine = worldAnchors(state, pack, piece).map(
    (anchor) => anchor.position,
  );

  // Screen-scaled, so the snap reaches the same number of pixels whether the
  // camera is zoomed in tight or pulled right back. Measured to the dragged
  // piece itself, not the camera's orbit target, so seating a piece far from
  // the pivot does not get a threshold sized for somewhere else in the scene.
  const distance = state.camera.position.distanceTo(
    group.getWorldPosition(new THREE.Vector3()),
  );
  const viewportHeight = state.renderer.getSize(new THREE.Vector2()).y;
  const threshold = screenPixelsToWorld(
    THREE.MathUtils.degToRad(state.camera.fov),
    viewportHeight,
    distance,
    SNAP_PIXELS,
  );

  paintProximity(state, mine, targetPoints, threshold);

  const snap = nearestSnap(mine, targetPoints, threshold);
  const seated = snap ? targets[snap.targetIndex] : undefined;
  state.onSnapChange(snap !== null, seated?.name);
  showSeat(state, snap ? { at: snap.at, owner: seated?.owner } : null);
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

interface SnapTarget {
  position: Vec3;
  /** The piece whose anchor this is, so the seat can point at it. */
  owner: string;
  /** A custom anchor's name, so the seat can say which one it took. */
  name?: string;
}

/**
 * Every anchor a dragged piece could seat against, and whose each one is.
 *
 * A piece never snaps to itself or to anything hanging off it, or dragging a
 * parent would try to seat it against the children it is carrying.
 */
function snapTargets(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string,
): SnapTarget[] {
  const own = new Set(descendantIds(project, pieceId));
  const targets: SnapTarget[] = [];
  for (const other of project.pieces) {
    if (own.has(other.id)) continue;
    for (const anchor of worldAnchors(state, pack, other)) {
      targets.push({
        position: anchor.position,
        owner: other.id,
        ...(anchor.name ? { name: anchor.name } : {}),
      });
    }
  }
  return targets;
}

/**
 * Show what a drag is seating against: a dot where the two anchors meet, and a
 * box round the piece whose anchor it is.
 *
 * Without this a snap is a piece jumping for no visible reason. There are
 * fifteen anchors on each piece and any pair within reach can win, so the only
 * useful answer to "what just happened" is to point at the pair that did.
 */
function showSeat(
  state: SceneState,
  seat: { at: Vec3; owner: string | undefined } | null,
) {
  if (!seat) {
    state.seatMark.visible = false;
    state.seatOutline.visible = false;
    return;
  }

  state.seatMark.position.set(...seat.at);
  state.seatMark.visible = true;

  const group = seat.owner ? state.groups.get(seat.owner) : undefined;
  if (group) {
    state.seatOutline.setFromObject(group);
    state.seatOutline.visible = true;
  } else {
    state.seatOutline.visible = false;
  }
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
function showSelection(
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
function attachGizmo(
  state: SceneState,
  project: LegoProject,
  selectedIds: string[],
  placingAnchor: boolean,
) {
  // Editing the volume takes the handles off the pieces entirely. One set of
  // handles cannot mean two things, and the volume is a property of the whole
  // unit rather than of whichever piece happens to be selected behind it.
  if (state.editCollision && state.collision) {
    state.groupIds = [];
    state.groupChanges = new Map();
    // The face plates are the volume's size control, so the gizmo stands down
    // in scale mode rather than offering a second, worse one.
    if (state.gizmo.getMode() === "scale") state.gizmo.detach();
    else state.gizmo.attach(state.collision);
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
function resolveHovered(
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
function applyHoverVisual(state: SceneState) {
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

/** Every other piece's anchors, so a drag can see what it is aiming at. */
function showTargetAnchors(
  state: SceneState,
  pack: LoadedPack,
  project: LegoProject,
  pieceId: string | null,
) {
  state.targetAnchors?.geometry.dispose();
  state.targetAnchors?.removeFromParent();
  state.targetAnchors = null;
  if (!pieceId) return;

  const positions = snapTargets(state, pack, project, pieceId).map(
    (target) => target.position,
  );
  if (positions.length === 0) return;

  // Every point starts cold. `paintProximity` warms them as the drag closes in.
  const cold = new THREE.Color(TARGET_COLD);
  const colours = positions.flatMap(() => [cold.r, cold.g, cold.b]);

  const object = points(positions.flat(), colours, state.dots);
  state.scene.add(object);
  state.targetAnchors = object;
}

/**
 * Warm each target anchor as the dragged piece approaches it.
 *
 * A snap is otherwise a step function: nothing, nothing, then a jump. Colouring
 * by distance turns it into something you can aim with, and the point that goes
 * fully green is the one about to take the piece.
 */
function paintProximity(
  state: SceneState,
  moving: Vec3[],
  targets: Vec3[],
  threshold: number,
) {
  const object = state.targetAnchors;
  if (!object) return;
  const colours = object.geometry.getAttribute("color");
  if (!colours || colours.count !== targets.length) return;

  const cold = new THREE.Color(TARGET_COLD);
  const hot = new THREE.Color(SEAT_COLOUR);
  const shade = new THREE.Color();

  targets.forEach((target, index) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const from of moving) {
      nearest = Math.min(
        nearest,
        Math.hypot(
          target[0] - from[0],
          target[1] - from[1],
          target[2] - from[2],
        ),
      );
    }
    // Warms from twice the snapping distance, so a point starts to glow before
    // it can actually take the piece.
    const closeness = 1 - Math.min(nearest / (threshold * 2), 1);
    shade.copy(cold).lerp(hot, closeness * closeness);
    colours.setXYZ(index, shade.r, shade.g, shade.b);
  });
  colours.needsUpdate = true;
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
  const material = partMaterial(
    unitAtlas(project, pack.library.atlases).drawWith,
  );

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

  const marks = new THREE.Group();

  // The origin is its own object, drawn larger. There is one of it, and it is
  // the one you go looking for.
  marks.add(points([0, 0, 0], null, state.originDot));

  const positions: number[] = [];
  const colours: number[] = [];
  for (const { anchor, position } of localAnchorsOf(pack, piece)) {
    if (anchor.kind !== "custom" && position.every((v) => Math.abs(v) < 1e-6)) {
      // The middle and the origin coincide, and two dots in one place read
      // as one dot of the wrong colour. A custom anchor still draws there: it
      // is a point someone put down, and it has to be visible to be moved.
      continue;
    }
    positions.push(...position);
    const colour = new THREE.Color(anchorColour(anchor.kind));
    colours.push(colour.r, colour.g, colour.b);
  }
  if (positions.length > 0) marks.add(points(positions, colours, state.dots));

  group.add(marks);
  state.anchors = marks;
}

function anchorColour(kind: Anchor["kind"]): number {
  if (kind === "custom") return CUSTOM_COLOUR;
  return kind === "corner" ? CORNER_COLOUR : FACE_COLOUR;
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
function focusSelection(state: SceneState, pieceIds: string[]) {
  const unit = boundsBox(
    unitBounds(state.projectRef.current, state.packRef.current),
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
function frameObject(state: SceneState, object: THREE.Object3D): boolean {
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
function applySceneScale(state: SceneState) {
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
 * Write a moved collision volume back to the document.
 *
 * Only the offsets: the gizmo moves the volume, and the face handles are what
 * size it. The wireframe's position is the volume's own numbers, since the
 * offsets run from the model's middle, which is where the wireframe was put.
 * Its scale is not, because a round shape is drawn at the size the engine will
 * build rather than the size typed in, so reading it back would quietly round
 * off a cylinder nobody asked to change.
 */
function commitCollision(state: SceneState) {
  const lines = state.collision;
  const change = state.onCollisionChangeRef.current;
  if (!lines || !change) return;

  const project = state.projectRef.current;
  const bounds = unitBounds(project, state.packRef.current);
  const volume = effectiveCollisionVolume(project, bounds);
  change({
    ...volume,
    offsets: [
      lines.position.x - bounds.mid[0],
      lines.position.y - bounds.mid[1],
      lines.position.z - bounds.mid[2],
    ],
  });
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
  const material = partMaterial(
    unitAtlas(project, pack.library.atlases).drawWith,
  );

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
