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

import { Button } from "@picoframe/frame";
import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { baseAtlas, type LegoAtlas } from "../../atlas";
import { addStandardLights, partMaterial } from "../../geometry";
import {
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partSize,
} from "../../pack";
import { getShapeGeometry, type ShapeKind } from "../../shapes";

/** Cell size in pixels. Big enough to read a small part, small enough to scan. */
const CELL = 72;
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
  /** Drawn with the base pack's atlas when absent, which is what the Lego
   *  Parts browser wants: it has no unit to draw the rest of, so there is
   *  nothing else to match. */
  atlas?: LegoAtlas;
  selectedId?: string;
  onSelect?: (part: LegoPartInfo, alt: boolean) => void;
  /** Ids of the favourite parts. With `onFavourite`, each cell gets a star. */
  favourites?: ReadonlySet<string>;
  onFavourite?: (part: LegoPartInfo) => void;
  /**
   * Generated shapes (#3337), drawn first, each at its default size, in the same
   * canvas as the parts. A shape is its own geometry, not a slice of the pack's
   * buffer, so a cell knows how to fetch its own.
   */
  shapes?: ShapeKind[];
  /** The kind being placed, if any. */
  selectedShape?: string;
  onSelectShape?: (shape: ShapeKind, alt: boolean) => void;
  /** Kinds of the favourite shapes. With `onFavouriteShape`, each gets a star. */
  favouriteShapes?: ReadonlySet<string>;
  onFavouriteShape?: (shape: ShapeKind) => void;
}

/** One cell of the grid: a part of the pack or a generated shape. */
interface Cell {
  key: string;
  name: string;
  title: string;
  /** The longest side, which the cell is scaled by to fit. */
  size: number;
  geometry: () => THREE.BufferGeometry | null;
  part?: LegoPartInfo;
  shape?: ShapeKind;
}

function shapeCell(info: ShapeKind): Cell {
  return {
    key: `shape:${info.kind}`,
    name: info.label,
    title: `${info.label}, ${info.size.join(" x ")}`,
    size: Math.max(...info.size),
    geometry: () =>
      getShapeGeometry({
        kind: info.kind,
        size: info.size,
        ...(info.options ? { options: info.options } : {}),
      }),
    shape: info,
  };
}

interface Visible {
  columns: number;
  firstRow: number;
  lastRow: number;
}

export function PartPicker({
  pack,
  parts,
  atlas,
  selectedId,
  onSelect,
  favourites,
  onFavourite,
  shapes,
  selectedShape,
  onSelectShape,
  favouriteShapes,
  onFavouriteShape,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewportState | null>(null);
  const [view, setView] = useState<Visible>({
    columns: 1,
    firstRow: 0,
    lastRow: 0,
  });
  const [focusIndex, setFocusIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const reduceMotion = useReduceMotion();
  // Shapes first: there are a handful, so they are on screen without a scroll,
  // where the pack's thousands of parts would push them out of sight.
  const cells = useMemo<Cell[]>(
    () => [
      ...(shapes ?? []).map(shapeCell),
      ...parts.map((part) => ({
        key: part.id,
        name: part.name,
        title: `${part.name}, ${part.tags.join(", ")}`,
        size: partSize(part),
        geometry: () => getPartGeometry(pack, part.id),
        part,
      })),
    ],
    [pack, parts, shapes],
  );

  useCanvas3D(
    hostRef,
    ({ renderer }) => {
      const scroller = scrollRef.current;
      if (!scroller) return;

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
        cells: [],
        onView: setView,
        meshByIndex: new Map(),
      };
      stateRef.current = state;

      const render = () =>
        layout(state, scroller.scrollTop, scroller.clientHeight);
      scroller.addEventListener("scroll", render, { passive: true });

      return {
        render,
        resize: (width) => {
          state.columns = Math.max(1, Math.floor((width + GAP) / PITCH));
        },
        dispose: () => {
          scroller.removeEventListener("scroll", render);
          for (const mesh of state.pool) scene.remove(mesh);
          stateRef.current = null;
        },
      };
    },
    [],
  );

  // Filtering changes which cells are in the grid, not how it is drawn, so the
  // renderer and its geometry cache survive.
  useEffect(() => {
    const state = stateRef.current;
    const scroller = scrollRef.current;
    if (!state || !scroller) return;
    state.cells = cells;
    state.pack = pack;
    scroller.scrollTop = 0;
    setFocusIndex(0);
    layout(state, 0, scroller.clientHeight);
  }, [pack, cells]);

  // Separate from the effect above: switching a unit's atlas changes none of
  // the parts on screen or the scroll position, only what they are drawn
  // with, so this leaves both alone and just redraws in place.
  useEffect(() => {
    const state = stateRef.current;
    const scroller = scrollRef.current;
    if (!state || !scroller) return;
    state.atlas = atlas;
    layout(state, scroller.scrollTop, scroller.clientHeight);
  }, [atlas]);

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
      const next = Math.min(cells.length - 1, Math.max(0, focusIndex + delta));
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
    [focusIndex, cells.length, view.columns],
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

  const rows = Math.ceil(cells.length / view.columns);
  const visible: number[] = [];
  for (let row = view.firstRow; row <= view.lastRow; row++) {
    for (let column = 0; column < view.columns; column++) {
      const index = row * view.columns + column;
      if (index < cells.length) visible.push(index);
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="pointer-events-none absolute inset-0" />
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
        <div
          className="relative"
          style={{ height: Math.max(rows * PITCH - GAP, 0) }}
        >
          {visible.map((index) => {
            const cell = cells[index];
            const { part, shape } = cell;
            const row = Math.floor(index / view.columns);
            const column = index % view.columns;
            const selected = shape
              ? shape.kind === selectedShape
              : part?.id === selectedId;
            const starred = shape
              ? (favouriteShapes?.has(shape.kind) ?? false)
              : (favourites?.has(part?.id ?? "") ?? false);
            const onStar = shape
              ? onFavouriteShape && (() => onFavouriteShape(shape))
              : onFavourite && part && (() => onFavourite(part));
            return (
              <div
                key={cell.key}
                className="group absolute"
                style={{
                  left: column * PITCH,
                  top: row * PITCH,
                  width: CELL,
                  height: CELL,
                }}
              >
                <button
                  type="button"
                  data-index={index}
                  tabIndex={index === focusIndex ? 0 : -1}
                  aria-pressed={selected}
                  title={cell.title}
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() =>
                    setHoverIndex((at) => (at === index ? null : at))
                  }
                  onFocus={() => {
                    setFocusIndex(index);
                    // Keyboard users get the same look at the part as the pointer.
                    setHoverIndex(index);
                  }}
                  onBlur={() =>
                    setHoverIndex((at) => (at === index ? null : at))
                  }
                  onKeyDown={(event) => {
                    // The stars are out of the tab order, like the other cells,
                    // so F is how the keyboard reaches one.
                    if (
                      event.key.toLowerCase() === "f" &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey &&
                      onStar
                    ) {
                      event.preventDefault();
                      onStar();
                      return;
                    }
                    onKeyDown(event);
                  }}
                  onClick={(event) =>
                    shape
                      ? onSelectShape?.(shape, event.altKey)
                      : part && onSelect?.(part, event.altKey)
                  }
                  className={`absolute inset-0 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-muted/40"
                  }`}
                >
                  <span className="sr-only">{cell.name}</span>
                </button>
                {onStar ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    tabIndex={-1}
                    className={`absolute right-0 top-0 transition-opacity focus:opacity-100 group-hover:opacity-100 ${starred ? "opacity-100" : "opacity-0"}`}
                    onClick={onStar}
                    aria-pressed={starred}
                    aria-label={`Favourite the ${cell.name} ${shape ? "shape" : "part"}`}
                    title={starred ? "Remove from favourites" : "Favourite"}
                  >
                    <Star size={14} fill={starred ? "currentColor" : "none"} />
                  </Button>
                ) : null}
              </div>
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
  cells: Cell[];
  pack?: LoadedPack;
  /** Undefined draws the base pack's atlas, resolved in `layout`. */
  atlas?: LegoAtlas;
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
  const { renderer, scene, camera, pool, columns, cells, pack, atlas } = state;
  if (!pack || viewportHeight === 0) return;
  const material = partMaterial(atlas ?? baseAtlas(pack));

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
      const cell = cells[index];
      if (!cell) continue;
      const geometry = cell.geometry();
      if (!geometry) continue;

      let mesh = pool[used];
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, material);
        pool.push(mesh);
        scene.add(mesh);
      }
      mesh.geometry = geometry;
      // Reassigned rather than left as it was, because the pool reuses this
      // mesh for whichever part is here now, and the unit's atlas can also
      // change under it.
      mesh.material = material;
      mesh.visible = true;
      // A three quarter view reads better than face on for boxy parts. Reset
      // every time, because a pooled mesh may have been left mid spin by a
      // part that has since scrolled away.
      mesh.rotation.set(REST_PITCH, REST_YAW, 0);
      state.meshByIndex.set(index, mesh);

      // Fit the part to its cell. Scaling per part means a tiny sliver and a
      // whole hull section are both legible.
      mesh.scale.setScalar((CELL * 0.62) / Math.max(cell.size, 0.001));
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
