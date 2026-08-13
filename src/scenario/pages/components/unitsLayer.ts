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
 */

import * as THREE from "three";

import type { UnitModelResult } from "@/content/bindings";
import { type BuiltModel, buildModel } from "@/content/unitModel";
import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import { worldToScene } from "@/placement/scene";
import type { Rgb } from "@/play/config";
import { facingToYaw, type Placement } from "./placements";
import { groundHeight, type HeightField } from "./terrain";

/** How wide the stand-in for a unit with no model is, in elmos. Roughly a
 *  medium tank, so it reads as a unit-sized hole rather than scenery. */
const MARKER_ELMOS = 40;

/** What a scenario's units are drawn under, so the layer can be found and
 *  removed as one thing. */
const ROOT_NAME = "scenario-units";

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
  let generation = 0;
  let disposed = false;

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
    root.clear();
    objects.clear();
    const missing: string[] = [];

    // Grouped by unit type and team, so each model is read once and the scene
    // fills in whole formations at a time rather than one unit per frame.
    const batches = new Map<string, Placement[]>();
    for (const placement of placements) {
      const key = `${placement.def}|${placement.team}`;
      const batch = batches.get(key);
      if (batch) batch.push(placement);
      else batches.set(key, [placement]);
    }

    for (const batch of batches.values()) {
      const colour = colorOf(deps.teamColor(batch[0].team));
      const { built, drawable } = await prototypeFor(batch[0].def, colour);
      if (disposed || mine !== generation) return { missing };
      if (!drawable) missing.push(batch[0].def);
      for (const placement of batch) {
        const instance = built.object.clone();
        place(instance, placement);
        root.add(instance);
        objects.set(placement.key, instance);
      }
      handle.render();
    }

    handle.render();
    return { missing: [...new Set(missing)] };
  };

  return {
    root,
    draw,
    objects,
    dispose: () => {
      disposed = true;
      root.clear();
      objects.clear();
      root.removeFromParent();
      for (const built of prototypes.values()) built.dispose();
      prototypes.clear();
    },
  };
}
