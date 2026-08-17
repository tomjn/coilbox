/**
 * The units a scenario places, drawn into the editor's map scene.
 *
 * Every model comes from the game's own archives through the same reader the
 * content browser's unit viewer uses, so what stands on the map here is the
 * model the engine will draw. Nothing about the formats is known at this level:
 * `buildModel` hands back a group of meshes and this file decides where it
 * stands, which way it points and what colour its team markings are.
 *
 * A def the game does not have gets a marker box instead of nothing, because a
 * scenario written against one game and opened against another would otherwise
 * look empty rather than wrong.
 *
 * A unit put down grows into place and one deleted shrinks away (issue #1716).
 * Every pass rebuilds the whole scene, so what is animated is worked out by name
 * rather than by what was rebuilt: see `./arrivals.ts`.
 */

import * as THREE from "three";

import type { UnitModelResult } from "@/content/bindings";
import { type BuiltModel, buildModel } from "@/content/unitModel";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { Rgb } from "@/play/config";
import { animates, eased, fadeAt } from "./arrivals";
import { facingToYaw, type Placement } from "./placements";
import { worldToScene } from "./scene";
import { groundHeight, type HeightField } from "./terrain";

/** How wide the stand-in for a unit with no model is, in elmos. Roughly a
 *  medium tank, so it reads as a unit-sized hole rather than scenery. */
const MARKER_ELMOS = 40;

/** What a scenario's units are drawn under, so the layer can be found and
 *  removed as one thing. */
const ROOT_NAME = "scenario-units";

/** How long a unit takes to grow into place, and to shrink away when it is
 *  deleted, in milliseconds. Short enough to be feedback rather than an
 *  entrance (issue #1716). */
const ARRIVE_MS = 200;
const LEAVE_MS = 160;

/** How small a unit starts, as a fraction of its size. Not from nothing: a
 *  building that unfolds from a point reads as an animation, and one that
 *  swells the last fifth reads as it landing. */
const ARRIVE_FROM = 0.7;

/** What one placement's object carries, for a picker to read off a hit. */
export interface PlacementUserData {
  placementKey: string;
  placement: Placement;
}

export interface UnitsLayerDeps {
  handle: MapScene3D;
  /** Map extent in elmos, as `useMissionMapAssets` reports it. */
  worldWidth: number;
  worldHeight: number;
  /** The map's relief, for standing models on the ground. */
  field: HeightField;
  minHeight: number;
  maxHeight: number;
  /** The unitdef's `objectname`, or undefined when the game has no such unit. */
  objectName: (def: string) => string | undefined;
  /** Read a model by `objectname`. Rejects when unitsync cannot be reached. */
  loadModel: (object: string) => Promise<UnitModelResult>;
  /** The colour a team's units are painted in, as 0..1 float RGB. */
  teamColor: (team: string) => Rgb;
  /** Whether motion is wanted, read at draw time because it is a preference
   *  somebody can change while the editor is open (issue #1716). */
  motion?: () => boolean;
}

/** What one pass of drawing found it could not draw. */
export interface DrawResult {
  /** Unit def names the game has no model for, in the order first seen. */
  missing: string[];
}

export interface UnitsLayer {
  /** The group every drawn unit hangs off, for raycasting against. */
  root: THREE.Group;
  /** Draw this list, replacing whatever was drawn before. */
  draw: (placements: Placement[]) => Promise<DrawResult>;
  /** The object drawn for a placement key, for selection and picking. */
  objects: Map<string, THREE.Object3D>;
  /**
   * Watch for the end of a pass of drawing, and stop watching with what comes
   * back (issue #1516).
   *
   * A pass empties `objects` the moment it starts and refills it over the next
   * few frames, so anything hanging off a drawn object, which is the selection
   * plate, cannot know when to look for it again. The layer is the only thing
   * that does know, so it says. A pass a later draw abandoned says nothing:
   * whatever is drawn then belongs to the later one.
   */
  onDrawn: (listener: () => void) => () => void;
  dispose: () => void;
}

/** A team colour as three sees it. The launcher's floats are sRGB values, the
 *  same ones it writes into the start script, so they are read as such. */
function colorOf(rgb: Rgb): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

/**
 * The stand-in for a unit whose model could not be read: a hollow box in the
 * team's colour, drawn through the terrain so it cannot be lost in a hillside.
 */
function buildMarker(colour: THREE.Color): BuiltModel {
  const geometry = new THREE.BoxGeometry(
    MARKER_ELMOS,
    MARKER_ELMOS,
    MARKER_ELMOS,
  );
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineBasicMaterial({
    color: colour,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const fill = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const object = new THREE.Group();
  const box = new THREE.Mesh(geometry, fill);
  box.position.y = MARKER_ELMOS / 2;
  const wire = new THREE.LineSegments(edges, line);
  wire.position.y = MARKER_ELMOS / 2;
  wire.renderOrder = 1;
  object.add(box, wire);
  return {
    object,
    box: new THREE.Box3().setFromObject(object),
    dispose: () => {
      geometry.dispose();
      edges.dispose();
      line.dispose();
      fill.dispose();
    },
  };
}

/**
 * Put a scenario's units on a built map scene.
 *
 * Models are built once per unit type per team colour and cloned for every
 * placement, because clones share their geometry and materials: a fifty-strong
 * group of one unit is one model on the GPU. The build cache outlives a redraw,
 * so moving one unit does not re-read every model in the document.
 *
 * `draw` is asynchronous and may be called again before it finishes. A later
 * call abandons the earlier one rather than interleaving with it.
 */
export function createUnitsLayer(deps: UnitsLayerDeps): UnitsLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);

  /** Built models, keyed by `objectname` and colour, or by colour alone for the
   *  marker. Kept across redraws. */
  const prototypes = new Map<string, BuiltModel>();
  const objects = new Map<string, THREE.Object3D>();
  const watchers = new Set<() => void>();
  let generation = 0;
  let disposed = false;

  /**
   * What is drawn where, by name rather than by key (issue #1716).
   *
   * A base's buildings are keyed by their place in its list, so deleting the
   * second of five renames three of them. A name is what a unit is and where it
   * stands, so a delete is one departure and a move is one of each.
   */
  let shown = new Map<
    string,
    { object: THREE.Object3D; def: string; drawable: boolean }
  >();
  /** Units shrinking away, and when each started. */
  let leaving: { object: THREE.Object3D; gone: number }[] = [];
  /** Units growing into place, and when each arrived. */
  let arriving: { object: THREE.Object3D; born: number }[] = [];
  let frame: number | null = null;

  const moving = () => animates && deps.motion?.() !== false;

  /** A unit part way through arriving or leaving, scaled about where it
   *  stands. Models are anchored at their base, so one at half size is standing
   *  on the same ground rather than hovering over it. */
  const sizeAt = (object: THREE.Object3D, at: number) =>
    object.scale.setScalar(handle.scale * at);

  const settle = (now: number): boolean => {
    let busy = false;
    const growing: typeof arriving = [];
    for (const one of arriving) {
      const at = eased(fadeAt(now - one.born, moving() ? ARRIVE_MS : 0));
      sizeAt(one.object, ARRIVE_FROM + (1 - ARRIVE_FROM) * at);
      if (at < 1) {
        growing.push(one);
        busy = true;
      }
    }
    arriving = growing;
    const going: typeof leaving = [];
    for (const one of leaving) {
      const at = 1 - eased(fadeAt(now - one.gone, moving() ? LEAVE_MS : 0));
      if (at <= 0) {
        one.object.removeFromParent();
        continue;
      }
      sizeAt(one.object, at);
      going.push(one);
      busy = true;
    }
    leaving = going;
    return busy;
  };

  const step = () => {
    frame = null;
    const busy = settle(performance.now());
    handle.render();
    if (busy) frame = requestAnimationFrame(step);
  };

  /** Keep the loop going while anything is still growing or shrinking. The
   *  scene renders on demand, so a loop left running costs a frame a second
   *  forever for nothing. */
  const wake = () => {
    const busy = settle(performance.now());
    if (busy && animates && frame === null) frame = requestAnimationFrame(step);
  };

  /**
   * What names one drawn unit, for telling an arrival from a redraw.
   *
   * Everything about it that would make the eye call it a different unit: what
   * it is, whose it is, where it stands and which way it points.
   */
  const nameOf = (placement: Placement) =>
    `${placement.def}|${placement.team}|${placement.pos.x},${placement.pos.z}|${placement.facing}`;

  /**
   * Which defs are standing as marker boxes rather than as models.
   *
   * Read off what is drawn rather than counted as a pass builds it, because a
   * pass that rebuilt nothing still has to say what is on the map: an edit to
   * one building must not clear the note saying three others are units this
   * game has not got.
   */
  const drawnMissing = (): string[] => {
    const out = new Set<string>();
    for (const standing of shown.values()) {
      if (!standing.drawable) out.add(standing.def);
    }
    return [...out];
  };

  const markerFor = (colour: THREE.Color): BuiltModel => {
    const key = `marker|${colour.getHexString()}`;
    const cached = prototypes.get(key);
    if (cached) return cached;
    const marker = buildMarker(colour);
    prototypes.set(key, marker);
    return marker;
  };

  const prototypeFor = async (
    def: string,
    colour: THREE.Color,
  ): Promise<{ built: BuiltModel; drawable: boolean }> => {
    const object = deps.objectName(def);
    if (!object) return { built: markerFor(colour), drawable: false };
    const key = `${object}|${colour.getHexString()}`;
    const cached = prototypes.get(key);
    if (cached) return { built: cached, drawable: true };
    let model: UnitModelResult | null = null;
    try {
      model = await deps.loadModel(object);
    } catch {
      model = null;
    }
    // A model that read but has no pieces draws nothing at all, which is the
    // same problem as a missing one from the map's point of view.
    if (!model?.root) return { built: markerFor(colour), drawable: false };
    const built = buildModel(model, colour);
    prototypes.set(key, built);
    return { built, drawable: true };
  };

  const place = (object: THREE.Object3D, placement: Placement) => {
    const scene = worldToScene(
      placement.pos,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    const height = groundHeight(
      deps.field,
      placement.pos.x,
      placement.pos.z,
      deps.worldWidth,
      deps.worldHeight,
      deps.minHeight,
      deps.maxHeight,
    );
    object.position.set(scene.x, height * handle.scale, scene.z);
    object.rotation.y = facingToYaw(placement.facing);
    // Models are in elmos, one unit each, so the whole instance takes the
    // scene's elmo scale.
    object.scale.setScalar(handle.scale);
    const userData: PlacementUserData = {
      placementKey: placement.key,
      placement,
    };
    object.userData = userData;
  };

  const draw = async (placements: Placement[]): Promise<DrawResult> => {
    generation++;
    const mine = generation;

    // Two units of one type can stand in one place, facing one way, for one
    // team, which is a mistake an author is allowed to make. A name already
    // taken gets a number after it.
    const taken = new Map<string, number>();
    const names = placements.map((placement) => {
      const name = nameOf(placement);
      const seen = taken.get(name) ?? 0;
      taken.set(name, seen + 1);
      return seen === 0 ? name : `${name}#${seen}`;
    });

    // What this pass is not drawing has gone: a unit deleted, or one that moved
    // and is standing somewhere else now.
    const wanted = new Set(names);
    const now = performance.now();
    for (const [name, standing] of [...shown]) {
      if (wanted.has(name)) continue;
      shown.delete(name);
      leaving.push({ object: standing.object, gone: now });
    }

    // Whatever is already standing where this pass wants it stays standing: the
    // same unit, the same team, the same square, the same way round. Only the
    // key it answers to can have changed, because a base's buildings are keyed
    // by their place in its list.
    //
    // Which is what keeps an edit to one building from being an arrival for all
    // of them, and what makes a second pass over the same document free. React
    // runs every effect twice in development, so there is always a second pass.
    objects.clear();
    const fresh: { placement: Placement; name: string }[] = [];
    placements.forEach((placement, at) => {
      const standing = shown.get(names[at]);
      if (!standing) {
        fresh.push({ placement, name: names[at] });
        return;
      }
      standing.object.userData = {
        placementKey: placement.key,
        placement,
      } satisfies PlacementUserData;
      objects.set(placement.key, standing.object);
    });

    // Grouped by unit type and team, so each model is read once and the scene
    // fills in whole formations at a time rather than one unit per frame.
    const batches = new Map<string, typeof fresh>();
    for (const one of fresh) {
      const key = `${one.placement.def}|${one.placement.team}`;
      const batch = batches.get(key);
      if (batch) batch.push(one);
      else batches.set(key, [one]);
    }

    for (const batch of batches.values()) {
      const colour = colorOf(deps.teamColor(batch[0].placement.team));
      const { built, drawable } = await prototypeFor(
        batch[0].placement.def,
        colour,
      );
      if (disposed || mine !== generation) return { missing: drawnMissing() };
      for (const { placement, name } of batch) {
        const instance = built.object.clone();
        place(instance, placement);
        arriving.push({ object: instance, born: performance.now() });
        sizeAt(instance, ARRIVE_FROM);
        root.add(instance);
        shown.set(name, { object: instance, def: placement.def, drawable });
        objects.set(placement.key, instance);
      }
      handle.render();
    }

    wake();
    handle.render();
    for (const watcher of watchers) watcher();
    return { missing: drawnMissing() };
  };

  return {
    root,
    draw,
    objects,
    onDrawn: (listener) => {
      watchers.add(listener);
      return () => {
        watchers.delete(listener);
      };
    },
    dispose: () => {
      disposed = true;
      if (frame !== null && animates) cancelAnimationFrame(frame);
      frame = null;
      arriving = [];
      leaving = [];
      shown = new Map();
      root.clear();
      objects.clear();
      watchers.clear();
      root.removeFromParent();
      for (const built of prototypes.values()) built.dispose();
      prototypes.clear();
    },
  };
}
