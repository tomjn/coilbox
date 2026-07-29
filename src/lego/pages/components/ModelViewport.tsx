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
  Grid3x3,
  Move,
  RotateCw,
  Scaling,
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
import { addStandardLights, partMaterial } from "../../geometry";
import {
  descendantIds,
  isEffectivelyHidden,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";
import { type BakedPiece, bakedPieces } from "../../s3oBuild";
import {
  localAnchors,
  nearestSnap,
  screenPixelsToWorld,
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
/** The pair that actually seated, and the piece it seated against. */
const SEAT_COLOUR = 0x34d399;
const SEAT_DOT = 11;
/** A target anchor nothing is near. Warms towards `SEAT_COLOUR` on approach. */
const TARGET_COLD = 0x64748b;

/** Where the camera starts, and where Reset view puts it back. */
const HOME_CAMERA: [number, number, number] = [9, 7, 11];

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
  selectedId: string | null;
  onSelect: (pieceId: string | null) => void;
  /** Committed when a drag ends, not on every frame of it. */
  onTransform: (pieceId: string, change: Partial<LegoPiece>) => void;
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
  onGround,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const reduceMotion = useReduceMotion();
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [snapped, setSnapped] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  function resetView() {
    const state = sceneRef.current;
    if (!state) return;
    state.camera.position.set(...HOME_CAMERA);
    state.controls.target.set(0, 0, 0);
    state.controls.update();
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
  // The gizmo reads the document every frame of a drag to find what to snap
  // against, and a stale copy would snap to where pieces used to be.
  const projectRef = useRef(project);
  projectRef.current = project;
  const packRef = useRef(pack);
  packRef.current = pack;

  // Built once. Everything after this mutates the scene rather than remaking it.
  useCanvas3D(
    containerRef,
    (canvas) => {
      const { renderer } = canvas;

      const scene = new THREE.Scene();
      addStandardLights(scene);

      // Units stand on y = 0, so the grid is the ground the engine will use.
      const grid = new THREE.GridHelper(40, 40, 0x556070, 0x2c333f);
      scene.add(grid);

      // Which way is which, drawn at the origin. Short, because it is a compass
      // and not a measure.
      const axes = new THREE.AxesHelper(2);
      axes.position.y = 0.01;
      scene.add(axes);

      const root = new THREE.Group();
      scene.add(root);

      const outline = new THREE.BoxHelper(root, 0x8b5cf6);
      outline.visible = false;
      scene.add(outline);

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

      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
      camera.position.set(...HOME_CAMERA);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !reduceMotion;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 1;
      controls.maxDistance = 120;

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
        outline,
        grid,
        axes,
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
        showTargetAnchors(state, packRef.current, projectRef.current, null);
        showSeat(state, null);
        commitGizmo(state);
        render();
      });

      gizmo.addEventListener("objectChange", () => {
        forceUniformScale(state);
        applySnap(state);
        state.outline.setFromObject(gizmo.object ?? root);
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

      onReadyRef.current?.(canvas.capture);

      return {
        render,
        resize: (width, height) => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        },
        dispose: () => {
          cancelAnimationFrame(frame);
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          controls.removeEventListener("change", render);
          controls.dispose();
          gizmo.detach();
          gizmo.getHelper().removeFromParent();
          gizmo.dispose();
          clearAnchors(state);
          state.targetAnchors?.geometry.dispose();
          state.seatMark.geometry.dispose();
          (state.seatMark.material as THREE.PointsMaterial).dispose();
          state.seatOutline.dispose();
          state.dots.dispose();
          state.originDot.dispose();
          disposeBaked(state);
          grid.dispose();
          outline.dispose();
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
    if (playing && !reduceMotion) showBaked(state, pack, project);
    state.render();
  }, [pack, project, playing, reduceMotion]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const piece = selectedId ? pieceById(project, selectedId) : undefined;
    const group = piece ? state.groups.get(piece.id) : undefined;
    // A hidden piece keeps its row selectable, so unhiding it stays reachable,
    // but there is nothing on screen to outline or drag: attaching the gizmo
    // to an invisible object would just fight the pointer over thin air. An
    // ancestor being hidden counts too, since that hides this piece as well.
    if (
      group &&
      piece &&
      selectedId &&
      !isEffectivelyHidden(project, selectedId)
    ) {
      state.outline.setFromObject(group);
      state.outline.visible = true;
      // The root has nothing to move relative to, so it gets no handles.
      if (selectedId === project.rootPieceId) {
        state.gizmo.detach();
      } else {
        state.gizmo.attach(group);
      }
    } else {
      state.outline.visible = false;
      state.gizmo.detach();
    }
    state.render();
  }, [selectedId, project]);

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

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    state.grid.visible = showGrid;
    state.axes.visible = showGrid;
    state.render();
  }, [showGrid]);

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
        <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
          <ButtonGroup orientation="vertical">
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
                <TooltipContent side="right">Sit on the ground</TooltipContent>
              </Tooltip>
            </ButtonGroup>
          ) : null}
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
          title={showGrid ? "Hide the ground grid" : "Show the ground grid"}
        >
          <Grid3x3 className="size-4" />
        </Button>
        <AxisCompass svgRef={compassRef} onClick={resetView} />
      </ButtonGroup>

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

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  root: THREE.Group;
  outline: THREE.BoxHelper;
  /** The ground and the compass, both of which can be switched off. */
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
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

  const { points, owners } = snapTargets(state, pack, project, pieceId);
  const mine = worldAnchors(state, pack, piece);

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

  paintProximity(state, mine, points, threshold);

  const snap = nearestSnap(mine, points, threshold);
  state.onSnapChange(snap !== null);
  showSeat(
    state,
    snap ? { at: snap.at, owner: owners[snap.targetIndex] } : null,
  );
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
): { points: Vec3[]; owners: string[] } {
  const own = new Set(descendantIds(project, pieceId));
  const points: Vec3[] = [];
  const owners: string[] = [];
  for (const other of project.pieces) {
    if (own.has(other.id)) continue;
    for (const anchor of worldAnchors(state, pack, other)) {
      points.push(anchor);
      owners.push(other.id);
    }
  }
  return { points, owners };
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

  const { points: positions } = snapTargets(state, pack, project, pieceId);
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
