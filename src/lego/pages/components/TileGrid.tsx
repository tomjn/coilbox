/**
 * The inventory as one grid of tiles: shapes, parts and modules (#4536).
 *
 * The Lego Parts page and the builder's drawer both list these through here.
 * The tiles are split into sections, each under a heading with its count, and
 * `./sectionGrid` says where every tile goes.
 *
 * There are hundreds of parts, so this is one canvas rather than one per tile,
 * and only the tiles on screen are drawn: a part or a shape borrows a mesh from
 * a pool, and a module shows the assembly kept for it. Nothing is pre-rendered
 * to a thumbnail, so a part looks the same here as it does in the editor and a
 * module preview can never go stale.
 *
 * The canvas lies over a layer of tiles: real buttons with their frames and
 * names, which keep the grid keyboard reachable and give every tile a name. The
 * canvas lets the pointer through, and is see-through where nothing is drawn.
 * Arrow keys move a roving tab stop across every section as one list.
 *
 * A module lifted from a game (#3262) has meshes rather than parts. Its tile
 * waits for the module's own geometry file and draws with the game's texture,
 * and it is marked with the game's name.
 */

import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { Star } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { baseAtlas, type LegoAtlas } from "../../atlas";
import { buildCompoundHolder } from "../../compoundPreview";
import {
  addStandardLights,
  importedMaterial,
  partMaterial,
} from "../../geometry";
import { refKey } from "../../inventory";
import { holdsLiftedPieces, liftCredits } from "../../liftPiece";
import type { LegoLifted, LegoPiece, LegoProject } from "../../model";
import {
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partSize,
} from "../../pack";
import { partTitle, visibleTags } from "../../partOrder";
import {
  disposeRawGeometry,
  getMeshGeometry,
  loadRawGeometry,
  type RawGeometry,
} from "../../rawGeometry";
import { getShapeGeometry, type ShapeKind } from "../../shapes";
import { type GridWindow, gridScroll, useRootHeight } from "./gridScroll";
import {
  type GridMetrics,
  sectionCount,
  sectionLayout,
  stepFrom,
  tileAt,
  tilesBetween,
} from "./sectionGrid";

/** A tile's model square in pixels, with its one line name under it. */
export const CELL = 88;
export const LABEL = 18;
export const GAP = 8;
const METRICS: GridMetrics = {
  cell: CELL,
  label: LABEL,
  gap: GAP,
  heading: 24,
  sectionGap: 8,
};
/** Rows kept either side of the viewport, so scrolling never shows a gap. */
const OVERSCAN = 2;
/**
 * How a tile's model sits when it is not being looked at. The pitch is
 * positive so the top tilts towards the camera: negative tips it away and
 * shows the underside instead.
 */
const REST_PITCH = 0.42;
const REST_YAW = 0.72;
/** Radians per second while hovered. One turn takes about six seconds. */
const SPIN_RATE = 1.05;
/** How much of its square a part or a shape fills, by its longest side. */
const PART_FIT = 0.62;
/** The same for a module, which is wider than it is deep more often. */
const MODULE_FIT = 0.58;

/** One tile: a generated shape, a part of the pack or a module. */
export type GridItem =
  | { kind: "shape"; shape: ShapeKind }
  | { kind: "part"; part: LegoPartInfo }
  | { kind: "module"; module: LegoProject };

/** A heading and the tiles under it. A section with no tiles is left out. */
export interface GridSection {
  id: string;
  label: string;
  /** How many there are before any filter, for "12 of 373". */
  total: number;
  items: GridItem[];
}

/** The key the favourites and the selection use for an item. */
export function itemKey(item: GridItem): string {
  switch (item.kind) {
    case "shape":
      return refKey({ kind: "shape", id: item.shape.id });
    case "part":
      return refKey({ kind: "part", id: item.part.id });
    case "module":
      return refKey({ kind: "module", id: item.module.id });
  }
}

function itemName(item: GridItem, pack: LoadedPack): string {
  switch (item.kind) {
    case "shape":
      return item.shape.label;
    case "part":
      return partTitle(pack, item.part);
    case "module":
      return item.module.name;
  }
}

interface Props {
  pack: LoadedPack;
  sections: GridSection[];
  /** Drawn with the base pack's atlas when absent, which is what the Lego
   *  Parts page wants: it has no unit to draw the rest of. */
  atlas?: LegoAtlas;
  /** The `itemKey` of the tile drawn as chosen. */
  selectedKey?: string;
  onPick?: (item: GridItem, alt: boolean) => void;
  /** Whether picking a module places it in a unit, which its title says. */
  placesModules?: boolean;
  /** `itemKey`s of the favourites. With `onFavourite`, each tile gets a star. */
  favourites?: ReadonlySet<string>;
  onFavourite?: (item: GridItem) => void;
  /**
   * A scroller further out to scroll with, in place of one of the grid's own,
   * as `./gridScroll` describes. Given or not for the life of the grid.
   */
  scrollRoot?: RefObject<HTMLElement | null>;
}

interface Visible {
  columns: number;
  indices: number[];
}

export function TileGrid({
  pack,
  sections,
  atlas,
  selectedKey,
  onPick,
  placesModules = false,
  favourites,
  onFavourite,
  scrollRoot,
}: Props) {
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rootHeight = useRootHeight(scrollRoot);
  // On a page, the canvas waits for the page's scroller to be measured.
  const ready = !scrollRoot || rootHeight > 0;
  const stateRef = useRef<GridState | null>(null);
  const [view, setView] = useState<Visible>({ columns: 1, indices: [] });
  const [focusIndex, setFocusIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  /** A lifted module's geometry by its id, or null when it would not load. */
  const [raws, setRaws] = useState<ReadonlyMap<string, RawGeometry | null>>(
    () => new Map(),
  );
  const asked = useRef(new Set<string>());
  const reduceMotion = useReduceMotion();

  const shown = useMemo(
    () => sections.filter((section) => section.items.length > 0),
    [sections],
  );
  const items = useMemo(
    () => shown.flatMap((section) => section.items),
    [shown],
  );
  const counts = useMemo(
    () => shown.map((section) => section.items.length),
    [shown],
  );
  // Which tiles there are, without what they hold: a renamed module is the
  // same tile, so it keeps the scroll and the focus where a new filter does not.
  const itemsKey = useMemo(() => items.map(itemKey).join("\n"), [items]);
  const grid = sectionLayout(counts, view.columns, METRICS);

  const scrolling = useCallback(
    () =>
      contentRef.current && hostRef.current
        ? gridScroll(
            contentRef.current,
            hostRef.current,
            scrollRef.current,
            scrollRoot ? scrollRoot.current : undefined,
          )
        : null,
    [scrollRoot],
  );

  useCanvas3D(
    hostRef,
    ({ renderer }) => {
      const scroll = scrolling();
      if (!scroll) return;

      const scene = new THREE.Scene();
      addStandardLights(scene);

      // Orthographic, so a tile is the same size on screen wherever it sits.
      const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1000, 1000);
      camera.position.set(0, 0, 100);

      const state: GridState = {
        renderer,
        scene,
        camera,
        pool: [],
        holders: new Map(),
        columns: 1,
        items: [],
        counts: [],
        raws: new Map(),
        onView: setView,
        objectByIndex: new Map(),
      };
      stateRef.current = state;

      const render = () => layout(state, scroll.window());
      const unwatch = scroll.watch(render);

      return {
        render,
        resize: (width) => {
          state.columns = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)));
        },
        dispose: () => {
          unwatch();
          for (const mesh of state.pool) scene.remove(mesh);
          for (const holder of state.holders.values()) {
            scene.remove(holder.group);
            holder.dispose();
          }
          stateRef.current = null;
        },
      };
    },
    [],
    ready,
  );

  // A lifted module's meshes are in a file of its own, read once per module.
  useEffect(() => {
    for (const item of items) {
      if (item.kind !== "module") continue;
      const { module } = item;
      if (!holdsLiftedPieces(module) || asked.current.has(module.id)) continue;
      asked.current.add(module.id);
      const { id } = module;
      void loadRawGeometry(id).then(
        (raw) => setRaws((was) => new Map(was).set(id, raw)),
        () => setRaws((was) => new Map(was).set(id, null)),
      );
    }
  }, [items]);

  // Freed with the grid, not when another module's file arrives.
  const rawsRef = useRef(raws);
  rawsRef.current = raws;
  useEffect(
    () => () => {
      for (const raw of rawsRef.current.values())
        if (raw) disposeRawGeometry(raw);
    },
    [],
  );

  // What the tiles hold and what they are drawn with. Neither moves the scroll:
  // a module's file arriving or the unit's atlas changing redraws in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of ready builds a new canvas with an empty state, which needs filling again
  useEffect(() => {
    const state = stateRef.current;
    const scroll = scrolling();
    if (!state || !scroll) return;
    state.items = items;
    state.counts = counts;
    state.pack = pack;
    state.atlas = atlas;
    state.raws = raws;
    const listed = new Set(
      items.flatMap((item) => (item.kind === "module" ? [item.module.id] : [])),
    );
    for (const [id, holder] of state.holders) {
      if (listed.has(id)) continue;
      state.scene.remove(holder.group);
      holder.dispose();
      state.holders.delete(id);
    }
    layout(state, scroll.window());
  }, [pack, items, counts, atlas, raws, scrolling, ready]);

  // A new filter starts the grid from its first tile.
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemsKey is the signal, the tiles themselves are read through the effect above
  useEffect(() => {
    const state = stateRef.current;
    const scroll = scrolling();
    setFocusIndex(0);
    if (!state || !scroll) return;
    scroll.reset();
    layout(state, scroll.window());
  }, [itemsKey, scrolling, ready]);

  // Arrow keys move the roving tab stop, so focus has to follow it onto a
  // button that may only exist after the next render.
  const chasingFocus = useRef(false);
  useEffect(() => {
    if (!chasingFocus.current) return;
    chasingFocus.current = false;
    contentRef.current
      ?.querySelector<HTMLButtonElement>(`[data-index="${focusIndex}"]`)
      ?.focus();
  }, [focusIndex]);

  // Turn the tile under the pointer, so its far side can be seen without
  // opening anything. This is the grid's only continuous loop: it runs while
  // one tile is hovered and stops the moment none is.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || hoverIndex === null || reduceMotion) return;

    let frame = 0;
    let previous = performance.now();
    let yaw = REST_YAW;

    const tick = (now: number) => {
      const object = state.objectByIndex.get(hoverIndex);
      if (object) {
        yaw += ((now - previous) / 1000) * SPIN_RATE;
        object.rotation.y = yaw;
        state.renderer.render(state.scene, state.camera);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      const object = state.objectByIndex.get(hoverIndex);
      if (object) {
        object.rotation.y = REST_YAW;
        state.renderer.render(state.scene, state.camera);
      }
    };
  }, [hoverIndex, reduceMotion]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = stepFrom(grid, focusIndex, event.key);
    if (next === undefined) return;
    event.preventDefault();
    chasingFocus.current = true;
    setFocusIndex(next);
    const at = tileAt(grid, next);
    if (at) scrolling()?.reveal(at.top, CELL + LABEL);
  };

  const headings = grid.sections.map((box, i) => {
    const section = shown[i];
    return (
      <h3
        key={section.id}
        className="absolute left-0 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        style={{ top: box.top }}
      >
        {section.label}
        <span className="ml-1.5 font-normal normal-case tracking-normal">
          {sectionCount(section.items.length, section.total)}
        </span>
      </h3>
    );
  });

  const tiles = view.indices
    .filter((index) => index < items.length)
    .map((index) => {
      const item = items[index];
      const at = tileAt(grid, index);
      if (!at) return null;
      const key = itemKey(item);
      const name = itemName(item, pack);
      const selected = key === selectedKey;
      const starred = favourites?.has(key) ?? false;
      const onStar = onFavourite && (() => onFavourite(item));
      const module = item.kind === "module" ? item.module : undefined;
      const liftedFrom =
        module && holdsLiftedPieces(module) ? module.game?.name : undefined;
      const shapeSize =
        item.kind === "shape" ? item.shape.size.join(" x ") : "";
      const partTags =
        item.kind === "part" ? visibleTags(item.part.tags).join(", ") : "";
      const pieceCount = item.kind === "module" ? item.module.pieces.length : 0;
      const title =
        item.kind === "shape"
          ? t`${name}, ${shapeSize}`
          : item.kind === "part"
            ? t`${name}, ${partTags}`
            : [
                placesModules
                  ? t`Place ${name} on a connector. Alt adds it to the selected piece`
                  : plural(pieceCount, {
                      one: `${name}, # piece`,
                      other: `${name}, # pieces`,
                    }),
                ...(liftedFrom ? liftCredits(item.module) : []),
              ]
                .filter(Boolean)
                .join(". ");
      return (
        <div
          key={key}
          className="group absolute"
          style={{
            left: at.left,
            top: at.top,
            width: CELL,
            height: CELL + LABEL,
          }}
        >
          <button
            type="button"
            data-index={index}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-pressed={selected}
            title={title}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() =>
              setHoverIndex((was) => (was === index ? null : was))
            }
            onFocus={() => {
              setFocusIndex(index);
              // Keyboard users get the same look at the model as the pointer.
              setHoverIndex(index);
            }}
            onBlur={() => setHoverIndex((was) => (was === index ? null : was))}
            onKeyDown={(event) => {
              // The stars are out of the tab order, like the other tiles,
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
            onClick={(event) => onPick?.(item, event.altKey)}
            className="peer absolute inset-0 flex flex-col justify-end rounded-md focus-visible:outline-none"
          >
            <span className="block truncate px-0.5 text-center text-[11px] leading-[14px]">
              {name}
            </span>
          </button>
          {/* The frame sits under the canvas, so a model is drawn on it, and after
              the button so the focus ring can follow the button. */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 rounded-md border bg-card transition-colors",
              selected
                ? "border-primary bg-primary/10"
                : "border-border/50 group-hover:border-border",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
            )}
            style={{ height: CELL }}
          />
          {liftedFrom ? (
            <span className="pointer-events-none absolute inset-x-6 top-1 truncate text-center text-[10px] text-muted-foreground">
              {liftedFrom}
            </span>
          ) : null}
          {onStar ? (
            <Button
              size="icon"
              variant="ghost"
              tabIndex={-1}
              className={`absolute right-0 top-0 size-6 transition-opacity focus:opacity-100 group-hover:opacity-100 ${starred ? "opacity-100" : "opacity-0"}`}
              onClick={onStar}
              aria-pressed={starred}
              aria-label={
                item.kind === "shape"
                  ? t`Favourite the ${name} shape`
                  : item.kind === "part"
                    ? t`Favourite the ${name} part`
                    : t`Favourite the ${name} module`
              }
              title={starred ? t`Remove from favourites` : t`Favourite`}
            >
              <Star size={14} fill={starred ? "currentColor" : "none"} />
            </Button>
          ) : null}
        </div>
      );
    });

  const height = grid.height;
  // The canvas lies over the tiles and lets the pointer through to them.
  if (scrollRoot) {
    return (
      <div
        ref={contentRef}
        className="relative w-full min-w-0 shrink-0"
        style={{ height }}
      >
        <div
          ref={hostRef}
          className="pointer-events-none sticky top-0 z-10"
          style={{ height: Math.min(height, rootHeight) }}
        />
        <div className="absolute inset-0">
          {headings}
          {tiles}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
        <div ref={contentRef} className="relative" style={{ height }}>
          {headings}
          {tiles}
        </div>
      </div>
      <div
        ref={hostRef}
        className="pointer-events-none absolute inset-0 z-10"
      />
    </div>
  );
}

/** A module's assembly, kept while the module is listed. */
export interface Holder {
  group: THREE.Group;
  /** What it was built from, so an edited module is built again. */
  module: LegoProject;
  raw: RawGeometry | null | undefined;
  /** The pack material its pack parts were last given. */
  material: THREE.Material | null;
  /** Frees a lifted module's own materials. */
  dispose: () => void;
}

interface GridState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** Meshes lent to the part and shape tiles on screen. */
  pool: THREE.Mesh[];
  /** Module id to its assembly. */
  holders: Map<string, Holder>;
  columns: number;
  items: GridItem[];
  /** Tiles in each section, in order. */
  counts: number[];
  pack?: LoadedPack;
  /** Undefined draws the base pack's atlas, resolved in `layout`. */
  atlas?: LegoAtlas;
  raws: ReadonlyMap<string, RawGeometry | null>;
  onView: (view: Visible) => void;
  /** The last view handed out, so an unchanged one costs no render. */
  view?: Visible;
  /** Which object stands for which tile, so the spin can find the one under
   *  the pointer. Rebuilt on every layout. */
  objectByIndex: Map<number, THREE.Object3D>;
}

/**
 * A module's assembly, `fit` across, or null for a lifted module whose
 * geometry has not arrived or would not load. The grid sizes it to a tile and
 * the detail panel to its preview.
 */
export function buildModule(
  module: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null | undefined,
  material: THREE.Material,
  fit: number,
): Holder | null {
  if (!holdsLiftedPieces(module)) {
    const group = buildCompoundHolder(
      module,
      (piece) =>
        piece.shape
          ? getShapeGeometry(piece.shape)
          : piece.partId
            ? getPartGeometry(pack, piece.partId)
            : null,
      material,
      fit,
    );
    return { group, module, raw, material, dispose: () => {} };
  }
  if (!raw) return null;
  // A module lifted whole draws everything with its game's texture. One saved
  // out of a selection (#4344) has none of its own, so each lifted piece draws
  // with the textures it records and a pack part with the pack's.
  const own = new Map<string, ReturnType<typeof importedMaterial>>();
  const lifted = (piece: LegoPiece) => {
    const source: Pick<LegoLifted, "texture" | "texture2"> =
      module.imported ?? piece.lifted ?? {};
    const key = `${source.texture?.key ?? ""}|${source.texture2?.key ?? ""}`;
    let held = own.get(key);
    if (!held) {
      held = importedMaterial(source);
      own.set(key, held);
    }
    return held.material;
  };
  const group = buildCompoundHolder(
    module,
    (piece) =>
      piece.meshId
        ? getMeshGeometry(raw, piece.meshId)
        : piece.shape
          ? getShapeGeometry(piece.shape)
          : piece.partId
            ? getPartGeometry(pack, piece.partId)
            : null,
    (piece) => (piece.meshId ? lifted(piece) : material),
    fit,
  );
  return {
    group,
    module,
    raw,
    material,
    dispose: () => {
      for (const held of own.values()) held.dispose();
    },
  };
}

/**
 * The module's assembly, built on first sight and again when the module or
 * its file changes. The pack material is reassigned when the unit's atlas
 * changes, and a lifted piece keeps the game's texture it was built with.
 */
function holderFor(
  state: GridState,
  pack: LoadedPack,
  module: LegoProject,
  material: THREE.Material,
): Holder | null {
  const raw = holdsLiftedPieces(module) ? state.raws.get(module.id) : undefined;
  let holder = state.holders.get(module.id);
  if (holder && (holder.module !== module || holder.raw !== raw)) {
    state.scene.remove(holder.group);
    holder.dispose();
    state.holders.delete(module.id);
    holder = undefined;
  }
  if (!holder) {
    const built = buildModule(module, pack, raw, material, CELL * MODULE_FIT);
    if (!built) return null;
    holder = built;
    state.scene.add(holder.group);
    state.holders.set(module.id, holder);
  }
  if (holder.material !== material) {
    holder.group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const piece = module.pieces.find(
        (p) => p.id === child.parent?.userData.pieceId,
      );
      if (!piece?.meshId) child.material = material;
    });
    holder.material = material;
  }
  return holder;
}

function sameView(a: Visible | undefined, b: Visible): boolean {
  return (
    a !== undefined &&
    a.columns === b.columns &&
    a.indices.length === b.indices.length &&
    a.indices.every((index, i) => index === b.indices[i])
  );
}

/**
 * Put the tiles on screen into the scene and draw once.
 *
 * The mesh pool is reused rather than rebuilt, so scrolling past parts
 * allocates nothing. World units are pixels here, which keeps the mapping
 * between a tile on screen and its place in the scene obvious.
 */
function layout(state: GridState, slice: GridWindow) {
  const { top: scrollTop, height: viewportHeight } = slice;
  const { renderer, scene, camera, pool, items, pack, atlas } = state;
  if (!pack || viewportHeight === 0) return;
  const material = partMaterial(atlas ?? baseAtlas(pack));
  const grid = sectionLayout(state.counts, state.columns, METRICS);
  const indices = tilesBetween(
    grid,
    scrollTop,
    scrollTop + viewportHeight,
    OVERSCAN,
  );
  const view = { columns: grid.columns, indices };
  if (!sameView(state.view, view)) {
    state.view = view;
    state.onView(view);
  }

  camera.left = 0;
  camera.right = renderer.domElement.clientWidth;
  camera.top = -scrollTop;
  camera.bottom = -scrollTop - viewportHeight;
  camera.updateProjectionMatrix();

  let used = 0;
  const showing = new Set<Holder>();
  state.objectByIndex.clear();
  for (const index of indices) {
    const item = items[index];
    const at = tileAt(grid, index);
    if (!item || !at) continue;
    const x = at.left + CELL / 2;
    const y = -(at.top + CELL / 2);

    if (item.kind === "module") {
      const holder = holderFor(state, pack, item.module, material);
      if (!holder) continue;
      holder.group.visible = true;
      holder.group.position.set(x, y, 0);
      holder.group.rotation.set(REST_PITCH, REST_YAW, 0);
      showing.add(holder);
      state.objectByIndex.set(index, holder.group);
      continue;
    }

    const geometry =
      item.kind === "part"
        ? getPartGeometry(pack, item.part.id)
        : getShapeGeometry({
            kind: item.shape.kind,
            size: item.shape.size,
            ...(item.shape.options ? { options: item.shape.options } : {}),
          });
    if (!geometry) continue;
    const size =
      item.kind === "part" ? partSize(item.part) : Math.max(...item.shape.size);

    let mesh = pool[used];
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      pool.push(mesh);
      scene.add(mesh);
    }
    mesh.geometry = geometry;
    // Reassigned rather than left as it was, because the pool reuses this mesh
    // for whichever part is here now, and the unit's atlas can change under it.
    mesh.material = material;
    mesh.visible = true;
    // Reset every time, because a pooled mesh may have been left mid spin by a
    // part that has since scrolled away.
    mesh.rotation.set(REST_PITCH, REST_YAW, 0);
    // Scaling per part means a tiny sliver and a whole hull section are both
    // legible.
    mesh.scale.setScalar((CELL * PART_FIT) / Math.max(size, 0.001));
    mesh.position.set(x, y, 0);
    state.objectByIndex.set(index, mesh);
    used++;
  }

  for (let i = used; i < pool.length; i++) pool[i].visible = false;
  for (const holder of state.holders.values())
    if (!showing.has(holder)) holder.group.visible = false;
  renderer.render(scene, camera);
}
