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
import {
  type BuiltModel,
  buildModel,
  prepareTextureAtlas,
} from "@/content/unitModel";
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

/** One unit standing on the map: what it is, what colour it is in, where it is,
 *  and the model drawn for it. */
interface Standing {
  object: THREE.Object3D;
  def: string;
  /**
   * The colour it is painted in, rather than the team it belongs to.
   *
   * A model is built per unit type and colour, so two placements can share one
   * only if both agree. The team id cannot stand in for the colour: the
   * blueprint editor builds its document afresh on every edit, so every
   * building's team id changes on every edit while the colour stays exactly
   * what it was (issue #1716).
   */
  colour: string;
  /** Where it stands and which way it points, as {@link standingAt} writes
   *  it. */
  at: string;
  /** Whether that model is the unit's own or the marker box a unit this game
   *  has not got is drawn as. */
  drawable: boolean;
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
 * Each of those models is merged down to one mesh per material as it is built,
 * so a placement costs a draw call a texture rather than a draw call a piece
 * (issue #2293). Every placement is still its own object, which is what picking,
 * the selection plate, dragging and the arrive and leave animations all hang
 * off.
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
   * What is standing on the map, by the key it answers to (issue #1716).
   *
   * Never replaced, only changed, because a pass reads models off disk and a
   * second pass can start while the first is waiting. React runs every effect
   * twice in development, so it always does.
   */
  const shown = new Map<string, Standing>();
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

  /** Where a unit stands and which way it points, for recognising one that has
   *  not moved. */
  const standingAt = (placement: Placement) =>
    `${placement.pos.x},${placement.pos.z}|${placement.facing}`;

  /** What colour a placement's team paints its units, which is what decides
   *  whether two of them can share a model. */
  const colourOf = (placement: Placement) =>
    colorOf(deps.teamColor(placement.team)).getHexString();

  /** The whole of a unit as the eye sees it, for recognising one whose key
   *  changed under it. */
  const looksLike = (one: { def: string; colour: string; at: string }) =>
    `${one.def}|${one.colour}|${one.at}`;

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
    // Merged, because a model on the map is only ever drawn standing still and
    // its piece tree costs a draw call a piece for every unit placed (#2293).
    //
    // The sheet is waited for rather than swapped in later: the merged model is
    // cloned once per placement, and a clone keeps the meshes it was made with,
    // so a sheet arriving afterwards would reach none of them (#2311). An
    // `.s3o` has nothing to pack and answers immediately.
    const atlas = await prepareTextureAtlas(model);
    const built = buildModel(model, colour, { merge: true, atlas });
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

    /**
     * Which drawn unit each placement is, out of the ones already standing.
     *
     * Twice over, because a unit can keep its key and move, or keep everything
     * about itself and lose its key: a base's buildings are keyed by their place
     * in its list, so deleting the second of five renumbers three of them.
     *
     * A unit that has not changed at all is claimed first, so deleting one of
     * five identical solars leaves the four that did not move exactly where they
     * are and the fifth object over. Only then does a key claim a unit, which is
     * what a move and a turn are: the same building, somewhere else.
     */
    const spare = new Map(shown);
    const claimed = new Map<string, Standing>();
    const alike = new Map<string, string[]>();
    for (const [key, one] of spare) {
      const look = looksLike(one);
      const keys = alike.get(look);
      if (keys) keys.push(key);
      else alike.set(look, [key]);
    }
    const colours = new Map(placements.map((p) => [p.key, colourOf(p)]));
    for (const placement of placements) {
      const look = looksLike({
        def: placement.def,
        colour: colours.get(placement.key) ?? "",
        at: standingAt(placement),
      });
      const key = alike.get(look)?.shift();
      const one = key === undefined ? undefined : spare.get(key);
      if (key === undefined || !one) continue;
      spare.delete(key);
      claimed.set(placement.key, one);
    }
    for (const placement of placements) {
      if (claimed.has(placement.key)) continue;
      const one = spare.get(placement.key);
      // The same unit in the same colour, or it is a different thing that has
      // been given the key rather than the building that used to hold it.
      if (
        !one ||
        one.def !== placement.def ||
        one.colour !== colours.get(placement.key)
      ) {
        continue;
      }
      spare.delete(placement.key);
      claimed.set(placement.key, one);
    }

    // Whatever nothing claimed has gone: a unit deleted, or one replaced by
    // something else at its key.
    const now = performance.now();
    for (const one of spare.values()) {
      leaving.push({ object: one.object, gone: now });
    }

    // Everything claimed keeps standing, moved and turned to where this pass
    // wants it, which is what makes a move a move rather than one building
    // vanishing and another appearing. A second pass over the same document
    // claims all of it and does nothing at all.
    shown.clear();
    objects.clear();
    const fresh: Placement[] = [];
    for (const placement of placements) {
      const one = claimed.get(placement.key);
      if (!one) {
        fresh.push(placement);
        continue;
      }
      place(one.object, placement);
      shown.set(placement.key, { ...one, at: standingAt(placement) });
      objects.set(placement.key, one.object);
    }

    // Grouped by unit type and team, so each model is read once and the scene
    // fills in whole formations at a time rather than one unit per frame.
    const batches = new Map<string, Placement[]>();
    for (const placement of fresh) {
      const key = `${placement.def}|${placement.team}`;
      const batch = batches.get(key);
      if (batch) batch.push(placement);
      else batches.set(key, [placement]);
    }

    for (const batch of batches.values()) {
      const colour = colorOf(deps.teamColor(batch[0].team));
      const { built, drawable } = await prototypeFor(batch[0].def, colour);
      if (disposed || mine !== generation) return { missing: drawnMissing() };
      for (const placement of batch) {
        const instance = built.object.clone();
        place(instance, placement);
        arriving.push({ object: instance, born: performance.now() });
        sizeAt(instance, ARRIVE_FROM);
        root.add(instance);
        shown.set(placement.key, {
          object: instance,
          def: placement.def,
          colour: colours.get(placement.key) ?? "",
          at: standingAt(placement),
          drawable,
        });
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
      shown.clear();
      root.clear();
      objects.clear();
      watchers.clear();
      root.removeFromParent();
      for (const built of prototypes.values()) built.dispose();
      prototypes.clear();
    },
  };
}
