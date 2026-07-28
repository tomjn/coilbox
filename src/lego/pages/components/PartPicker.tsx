/**
 * A browsable grid of every part in the pack.
 *
 * There are thousands of parts, so this is one canvas rather than one per cell,
 * and only the cells on screen hold a mesh. Live mesh count stays around fifty
 * however large the pack is. Nothing is pre-rendered to a thumbnail: the parts
 * are already in memory, and drawing them live means a part looks the same here
 * as it does in the editor.
 *
 * The canvas is a background layer and a transparent scroller sits on top of
 * it, holding one real button per visible cell. That keeps the grid keyboard
 * navigable and gives every cell an accessible name, which a canvas alone
 * cannot. Buttons are virtualised the same way the meshes are, and arrow keys
 * move between them.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { useReduceMotion } from "../../../general/display";
import { addStandardLights, partMaterial } from "../../geometry";
import {
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partSize,
} from "../../pack";

/** Cell size in pixels. Big enough to read a small part, small enough to scan. */
const CELL = 108;
const GAP = 8;
const PITCH = CELL + GAP;
/** Rows kept either side of the viewport, so scrolling never shows a gap. */
const OVERSCAN = 2;
/**
 * How a part sits when it is not being looked at. The pitch is positive so the
 * part's top tilts towards the camera: negative tips it away and shows the
 * underside instead.
 */
const REST_PITCH = 0.42;
const REST_YAW = 0.72;
/** Radians per second while hovered. One turn takes about six seconds. */
const SPIN_RATE = 1.05;

interface Props {
  pack: LoadedPack;
  parts: LegoPartInfo[];
  selectedId?: string;
  onSelect?: (part: LegoPartInfo) => void;
}

interface Visible {
  columns: number;
  firstRow: number;
  lastRow: number;
}

export function PartPicker({ pack, parts, selectedId, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<ViewportState | null>(null);
  const [view, setView] = useState<Visible>({
    columns: 1,
    firstRow: 0,
    lastRow: 0,
  });
  const [focusIndex, setFocusIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const reduceMotion = useReduceMotion();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    addStandardLights(scene);

    // Orthographic, so a cell is the same size on screen wherever it sits.
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1000, 1000);
    camera.position.set(0, 0, 100);

    const state: ViewportState = {
      renderer,
      scene,
      camera,
      pool: [],
      columns: 1,
      parts: [],
      onView: setView,
      meshByIndex: new Map(),
    };
    stateRef.current = state;

    const draw = () => {
      const width = scroller.clientWidth;
      const height = scroller.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      state.columns = Math.max(1, Math.floor((width + GAP) / PITCH));
      layout(state, scroller.scrollTop, height);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(scroller);
    const onScroll = () =>
      layout(state, scroller.scrollTop, scroller.clientHeight);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    draw();

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
      for (const mesh of state.pool) scene.remove(mesh);
      renderer.dispose();
      stateRef.current = null;
    };
  }, []);

  // Filtering changes which parts are in the grid, not how it is drawn, so the
  // renderer and its geometry cache survive.
  useEffect(() => {
    const state = stateRef.current;
    const scroller = scrollRef.current;
    if (!state || !scroller) return;
    state.parts = parts;
    state.pack = pack;
    scroller.scrollTop = 0;
    setFocusIndex(0);
    layout(state, 0, scroller.clientHeight);
  }, [pack, parts]);

  // Arrow keys move the roving tab stop, so focus has to follow it onto a
  // button that may only exist after the next render.
  const chasingFocus = useRef(false);
  useEffect(() => {
    if (!chasingFocus.current) return;
    chasingFocus.current = false;
    scrollRef.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${focusIndex}"]`)
      ?.focus();
  }, [focusIndex]);

  // Turn the part under the pointer, so its far side can be seen without
  // opening anything. This is the only continuous loop in the picker: it runs
  // while one part is hovered and stops the moment it is not.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || hoverIndex === null || reduceMotion) return;

    let frame = 0;
    let previous = performance.now();
    let yaw = REST_YAW;

    const tick = (now: number) => {
      const mesh = state.meshByIndex.get(hoverIndex);
      if (mesh) {
        yaw += ((now - previous) / 1000) * SPIN_RATE;
        mesh.rotation.y = yaw;
        state.renderer.render(state.scene, state.camera);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      const mesh = state.meshByIndex.get(hoverIndex);
      if (mesh) {
        mesh.rotation.y = REST_YAW;
        state.renderer.render(state.scene, state.camera);
      }
    };
  }, [hoverIndex, reduceMotion]);

  const move = useCallback(
    (delta: number) => {
      const next = Math.min(parts.length - 1, Math.max(0, focusIndex + delta));
      chasingFocus.current = true;
      setFocusIndex(next);
      const scroller = scrollRef.current;
      if (!scroller) return;
      const top = Math.floor(next / view.columns) * PITCH;
      if (top < scroller.scrollTop) {
        scroller.scrollTop = top;
      } else if (top + CELL > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = top + CELL - scroller.clientHeight;
      }
    },
    [focusIndex, parts.length, view.columns],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: view.columns,
      ArrowUp: -view.columns,
      PageDown: view.columns * 4,
      PageUp: -view.columns * 4,
    };
    const delta = steps[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    move(delta);
  };

  const rows = Math.ceil(parts.length / view.columns);
  const visible: number[] = [];
  for (let row = view.firstRow; row <= view.lastRow; row++) {
    for (let column = 0; column < view.columns; column++) {
      const index = row * view.columns + column;
      if (index < parts.length) visible.push(index);
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
        <div
          className="relative"
          style={{ height: Math.max(rows * PITCH - GAP, 0) }}
        >
          {visible.map((index) => {
            const part = parts[index];
            const row = Math.floor(index / view.columns);
            const column = index % view.columns;
            return (
              <button
                key={part.id}
                type="button"
                data-index={index}
                tabIndex={index === focusIndex ? 0 : -1}
                aria-pressed={part.id === selectedId}
                title={`${part.name}, ${part.tags.join(", ")}`}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() =>
                  setHoverIndex((at) => (at === index ? null : at))
                }
                onFocus={() => {
                  setFocusIndex(index);
                  // Keyboard users get the same look at the part as the pointer.
                  setHoverIndex(index);
                }}
                onBlur={() => setHoverIndex((at) => (at === index ? null : at))}
                onKeyDown={onKeyDown}
                onClick={() => onSelect?.(part)}
                className={`absolute rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  part.id === selectedId
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/40"
                }`}
                style={{
                  left: column * PITCH,
                  top: row * PITCH,
                  width: CELL,
                  height: CELL,
                }}
              >
                <span className="sr-only">{part.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ViewportState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  pool: THREE.Mesh[];
  columns: number;
  parts: LegoPartInfo[];
  pack?: LoadedPack;
  onView: (view: Visible) => void;
  /** Which pooled mesh is currently standing in for which part, so the spin
   *  can find the one under the pointer. Rebuilt on every layout. */
  meshByIndex: Map<number, THREE.Mesh>;
}

/**
 * Put the visible parts into the mesh pool and draw once.
 *
 * The pool is reused rather than rebuilt, so scrolling allocates nothing. World
 * units are pixels here, which keeps the mapping between a cell on screen and
 * its position in the scene obvious.
 */
function layout(
  state: ViewportState,
  scrollTop: number,
  viewportHeight: number,
) {
  const { renderer, scene, camera, pool, columns, parts, pack } = state;
  if (!pack || viewportHeight === 0) return;

  const firstRow = Math.max(0, Math.floor(scrollTop / PITCH) - OVERSCAN);
  const lastRow = Math.ceil((scrollTop + viewportHeight) / PITCH) + OVERSCAN;
  state.onView({ columns, firstRow, lastRow });

  camera.left = 0;
  camera.right = renderer.domElement.clientWidth;
  camera.top = -scrollTop;
  camera.bottom = -scrollTop - viewportHeight;
  camera.updateProjectionMatrix();

  let used = 0;
  state.meshByIndex.clear();
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const part = parts[index];
      if (!part) continue;
      const geometry = getPartGeometry(pack, part.id);
      if (!geometry) continue;

      let mesh = pool[used];
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, partMaterial(pack.manifest));
        pool.push(mesh);
        scene.add(mesh);
      }
      mesh.geometry = geometry;
      mesh.visible = true;
      // A three quarter view reads better than face on for boxy parts. Reset
      // every time, because a pooled mesh may have been left mid spin by a
      // part that has since scrolled away.
      mesh.rotation.set(REST_PITCH, REST_YAW, 0);
      state.meshByIndex.set(index, mesh);

      // Fit the part to its cell. Scaling per part means a tiny sliver and a
      // whole hull section are both legible.
      mesh.scale.setScalar((CELL * 0.62) / Math.max(partSize(part), 0.001));
      mesh.position.set(
        column * PITCH + CELL / 2,
        -(row * PITCH + CELL / 2),
        0,
      );
      used++;
    }
  }

  for (let i = used; i < pool.length; i++) pool[i].visible = false;
  renderer.render(scene, camera);
}
