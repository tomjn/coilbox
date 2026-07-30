/**
 * Saved sub-assemblies, drawn rather than listed.
 *
 * Built the way the parts grid is: one canvas behind a transparent scroller
 * holding one real button per cell, so the grid stays keyboard reachable and
 * every cell has a name. Nothing is pre-rendered to a file. A compound is
 * assembled live from the same geometry the builder uses, so it looks the same
 * here as it will once inserted, and a preview can never go stale.
 *
 * There is no virtualisation, unlike the parts grid. Compounds are made by hand
 * one at a time, so there are tens of them where there are hundreds of parts.
 */

import { Button, Input } from "@picoframe/frame";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { baseAtlas, type LegoAtlas } from "../../atlas";
import { validateCompoundName } from "../../compounds";
import { addStandardLights, partMaterial } from "../../geometry";
import { type LegoProject, walkPieces } from "../../model";
import { getPartGeometry, type LoadedPack } from "../../pack";

/** Cell size in pixels: a square of model, with the name under it. */
const CELL = 108;
const LABEL = 24;
const GAP = 8;
const PITCH_X = CELL + GAP;
const PITCH_Y = CELL + LABEL + GAP;
/** How a compound sits when it is not being looked at. */
const REST_PITCH = 0.42;
const REST_YAW = 0.72;
/** Radians per second while hovered. One turn takes about six seconds. */
const SPIN_RATE = 1.05;

interface Props {
  pack: LoadedPack;
  compounds: LegoProject[];
  /**
   * Drawn with the base pack's atlas when absent. A compound is geometry, not
   * a texture, so once inserted it takes on whatever atlas the unit around it
   * already uses: this is only about how it looks while still in the tray, and
   * the builder passes the unit's own atlas so a compound previews the way it
   * will actually look once dropped in.
   */
  atlas?: LegoAtlas;
  /** Absent on the parts browser, which has no unit to insert into. */
  onInsert?: (compound: LegoProject) => void;
  onDelete: (id: string) => void;
  onRename: (compound: LegoProject, name: string) => void;
}

/** The name field being edited, and why it cannot be saved yet, if at all. */
interface Renaming {
  id: string;
  draft: string;
  error: string | null;
}

export function CompoundPicker({
  pack,
  compounds,
  atlas,
  onInsert,
  onDelete,
  onRename,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GridState | null>(null);
  const [columns, setColumns] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const reduceMotion = useReduceMotion();

  function startRename(compound: LegoProject) {
    setRenaming({ id: compound.id, draft: compound.name, error: null });
  }

  function cancelRename() {
    setRenaming(null);
  }

  /**
   * Enter and blur both land here. An empty or clashing name keeps the field
   * open with a reason rather than reverting, so a mistyped name does not
   * quietly vanish: the fix is to correct it or press Escape to give up.
   */
  function commitRename() {
    setRenaming((current) => {
      if (!current) return current;
      const error = validateCompoundName(compounds, current.id, current.draft);
      if (error) return { ...current, error };
      const trimmed = current.draft.trim();
      const compound = compounds.find((c) => c.id === current.id);
      if (compound && trimmed !== compound.name) onRename(compound, trimmed);
      return null;
    });
  }

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

      const state: GridState = {
        renderer,
        scene,
        camera,
        holders: new Map(),
        order: [],
        columns: 1,
        onColumns: setColumns,
      };
      stateRef.current = state;

      const render = () =>
        layout(state, scroller.scrollTop, scroller.clientHeight);
      scroller.addEventListener("scroll", render, { passive: true });

      return {
        render,
        resize: (width) => {
          const next = Math.max(1, Math.floor((width + GAP) / PITCH_X));
          if (next !== state.columns) {
            state.columns = next;
            state.onColumns(next);
          }
        },
        dispose: () => {
          scroller.removeEventListener("scroll", render);
          for (const holder of state.holders.values()) scene.remove(holder);
          stateRef.current = null;
        },
      };
    },
    [],
  );

  // The geometry is shared and cached, so a compound that is still here keeps
  // the object it already had and only new ones are built. The material is
  // reassigned on every holder regardless, not only a freshly built one,
  // because the unit's atlas can change under a compound that already exists.
  useEffect(() => {
    const state = stateRef.current;
    const scroller = scrollRef.current;
    if (!state || !scroller) return;

    const material = partMaterial(atlas ?? baseAtlas(pack));
    const wanted = new Set(compounds.map((compound) => compound.id));
    for (const [id, holder] of state.holders) {
      if (wanted.has(id)) continue;
      state.scene.remove(holder);
      state.holders.delete(id);
    }
    for (const compound of compounds) {
      if (state.holders.has(compound.id)) continue;
      const holder = buildHolder(pack, compound, material);
      state.scene.add(holder);
      state.holders.set(compound.id, holder);
    }
    for (const holder of state.holders.values()) {
      holder.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = material;
      });
    }
    state.order = compounds.map((compound) => compound.id);
    layout(state, scroller.scrollTop, scroller.clientHeight);
  }, [pack, compounds, atlas]);

  // Turn the compound under the pointer, so its far side can be seen without
  // inserting it. Runs only while one is hovered.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || hovered === null || reduceMotion) return;

    let frame = 0;
    let previous = performance.now();
    let yaw = REST_YAW;

    const tick = (now: number) => {
      const holder = state.holders.get(hovered);
      if (holder) {
        yaw += ((now - previous) / 1000) * SPIN_RATE;
        holder.rotation.y = yaw;
        state.renderer.render(state.scene, state.camera);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      const holder = state.holders.get(hovered);
      if (holder) {
        holder.rotation.y = REST_YAW;
        state.renderer.render(state.scene, state.camera);
      }
    };
  }, [hovered, reduceMotion]);

  const rows = Math.ceil(compounds.length / columns);

  // The host and scroller stay in the tree even with nothing saved yet, so the
  // canvas the mount effect builds always has somewhere to attach. Returning
  // early here instead would mean the first compound ever saved has no canvas
  // to draw into, and the mount effect only runs once.
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="pointer-events-none absolute inset-0" />
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
        {compounds.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Nothing saved yet. In a unit, select a piece and choose Save as
            compound to keep the assembly under it for reuse.
          </p>
        ) : (
          <div
            className="relative"
            style={{ height: Math.max(rows * PITCH_Y - GAP, 0) }}
          >
            {compounds.map((compound, index) => {
              const isRenaming = renaming?.id === compound.id;
              return (
                <div
                  key={compound.id}
                  className="group absolute"
                  style={{
                    left: (index % columns) * PITCH_X,
                    top: Math.floor(index / columns) * PITCH_Y,
                    width: CELL,
                    height: CELL + LABEL,
                  }}
                >
                  {/* A button whether or not it inserts: pointing at a cell or
                      tabbing to it turns the compound, which is how its far side
                      gets seen. The parts browser has no unit to insert into, so
                      there it only turns. Renaming covers its label with a field
                      but leaves it in place, so hover and spin still work. */}
                  <button
                    type="button"
                    onClick={onInsert ? () => onInsert(compound) : undefined}
                    onMouseEnter={() => setHovered(compound.id)}
                    onMouseLeave={() =>
                      setHovered((at) => (at === compound.id ? null : at))
                    }
                    onFocus={() => setHovered(compound.id)}
                    onBlur={() =>
                      setHovered((at) => (at === compound.id ? null : at))
                    }
                    title={
                      onInsert
                        ? `Add ${compound.name} to the unit`
                        : `${compound.name}, ${compound.pieces.length} pieces`
                    }
                    className="flex h-full w-full flex-col justify-end rounded border border-transparent pb-1 text-center hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate px-1 text-xs">
                      {isRenaming ? "" : compound.name}
                    </span>
                  </button>
                  {isRenaming ? (
                    <div className="absolute inset-x-1 bottom-1">
                      <Input
                        autoFocus
                        value={renaming.draft}
                        onChange={(event) =>
                          setRenaming({
                            id: compound.id,
                            draft: event.target.value,
                            error: null,
                          })
                        }
                        onFocus={(event) => event.target.select()}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        aria-label={`Rename the ${compound.name} compound`}
                        aria-invalid={renaming.error ? true : undefined}
                        className="h-5 bg-background px-1 text-xs"
                      />
                      {renaming.error ? (
                        <p className="truncate text-[10px] text-destructive">
                          {renaming.error}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute left-0 top-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    onClick={() => startRename(compound)}
                    aria-label={`Rename the ${compound.name} compound`}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute right-0 top-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    onClick={() => onDelete(compound.id)}
                    aria-label={`Delete the ${compound.name} compound`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface GridState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** Compound id to the object drawn for it, one per compound. */
  holders: Map<string, THREE.Group>;
  /** The order the cells are in, which is the order the list is in. */
  order: string[];
  columns: number;
  onColumns: (columns: number) => void;
}

/**
 * One compound, ready to be dropped into a cell.
 *
 * The holder carries the cell's placement and the resting pose, and its child
 * carries the compound itself, shifted so the assembly's middle sits on the
 * holder's origin. Two objects rather than one, because the shift has to happen
 * before the holder scales and turns it.
 */
function buildHolder(
  pack: LoadedPack,
  compound: LegoProject,
  material: THREE.MeshStandardMaterial,
): THREE.Group {
  const holder = new THREE.Group();
  const centred = new THREE.Group();
  holder.add(centred);

  const groups = new Map<string, THREE.Group>();
  const assembly = new THREE.Group();
  centred.add(assembly);

  // Depth first from the root, so a piece's parent is always in place first.
  for (const piece of walkPieces(compound)) {
    const group = new THREE.Group();
    group.position.set(...piece.position);
    group.rotation.set(...piece.rotation);
    group.scale.set(...piece.scale);
    const parent =
      piece.id === compound.rootPieceId
        ? assembly
        : (groups.get(piece.parentId as string) ?? assembly);
    parent.add(group);
    groups.set(piece.id, group);

    const geometry = piece.partId ? getPartGeometry(pack, piece.partId) : null;
    if (geometry) group.add(new THREE.Mesh(geometry, material));
  }

  // A compound of nothing but empty pieces has no size to fit, and dividing by
  // it would send the holder to infinity.
  const box = new THREE.Box3().setFromObject(assembly);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    holder.scale.setScalar(
      (CELL * 0.58) / Math.max(size.x, size.y, size.z, 0.001),
    );
    centred.position.copy(centre).negate();
  }
  holder.rotation.set(REST_PITCH, REST_YAW, 0);
  return holder;
}

/** Put every compound in its cell and draw once. World units are pixels. */
function layout(state: GridState, scrollTop: number, viewportHeight: number) {
  const { renderer, camera, columns, order, holders } = state;
  if (viewportHeight === 0) return;

  camera.left = 0;
  camera.right = renderer.domElement.clientWidth;
  camera.top = -scrollTop;
  camera.bottom = -scrollTop - viewportHeight;
  camera.updateProjectionMatrix();

  order.forEach((id, index) => {
    const holder = holders.get(id);
    if (!holder) return;
    holder.position.set(
      (index % columns) * PITCH_X + CELL / 2,
      -(Math.floor(index / columns) * PITCH_Y + CELL / 2),
      0,
    );
  });

  renderer.render(state.scene, state.camera);
}
