import * as THREE from "three";

/**
 * How the unit is drawn (issue #3342): as solid parts, as edges only so you can
 * see through it, or as solid parts with the edges drawn over them.
 *
 * A view setting. It is not in the project, is not exported, and the thumbnail
 * ignores it: see `showSolid`.
 *
 * Edges are `THREE.EdgesGeometry` lines rather than `material.wireframe`. The
 * wireframe flag draws every triangle, so each flat face of a block shows the
 * diagonal that splits it in two. `EdgesGeometry` draws only the edges where two
 * faces meet at a sharp angle, which is the outline a person means by an edge.
 *
 * The faces of a wireframe unit are hidden by swapping in a material that does
 * not draw, never by changing the unit's own material: those are shared with
 * the part pickers, and a hidden face is still a face for the raycaster, so
 * clicking inside a piece's outline still selects it.
 *
 * Nothing here is wired to the callers that assign a piece's material or
 * geometry. `refreshDrawMode` runs before every frame and takes up whatever
 * they left, which is what keeps the mode on while an animation or a script
 * preview rebuilds the pieces.
 */

export type DrawMode = "solid" | "wireframe" | "both";

const ORDER: DrawMode[] = ["solid", "wireframe", "both"];

/** The mode a press of the button or the shortcut moves to. */
export function nextDrawMode(mode: DrawMode): DrawMode {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
}

/** The mode the next viewport opens in, so switching unit does not reset it. */
let remembered: DrawMode = "solid";

export function rememberedDrawMode(): DrawMode {
  return remembered;
}

export function rememberDrawMode(mode: DrawMode) {
  remembered = mode;
}

/**
 * The angle between two faces, in degrees, past which their shared edge is
 * drawn. Past the default of one degree a low-poly cylinder shows every facet
 * as a line. At this angle a block, a wedge and the rim of a stud are drawn and
 * a gently curved surface is not.
 */
export const EDGE_ANGLE = 30;

const EDGE_COLOUR = 0xa5d8ff;

export interface DrawLayer {
  mode: DrawMode;
  /** One set of edges per geometry, shared by every piece drawn from it. */
  edges: Map<THREE.BufferGeometry, THREE.EdgesGeometry>;
  /** A copy of each solid material with its faces pushed back, so the edges
   *  drawn over them do not flicker through. Made only for `both`. */
  offsetFaces: Map<THREE.Material, THREE.Material>;
  /** What a wireframe unit's faces draw with: nothing, but still hit by a ray. */
  ghost: THREE.MeshBasicMaterial;
  lines: THREE.LineBasicMaterial;
}

export function newDrawLayer(): DrawLayer {
  return {
    mode: "solid",
    edges: new Map(),
    offsetFaces: new Map(),
    // Both sides, so a ray that enters a piece the way a solid one is entered
    // from outside and one from inside both land, as an imported model's
    // double sided material does.
    ghost: new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide,
    }),
    lines: new THREE.LineBasicMaterial({ color: EDGE_COLOUR }),
  };
}

function meshOf(group: THREE.Object3D): THREE.Mesh | undefined {
  return group.children.find((child) => child instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
}

function edgeLinesOf(mesh: THREE.Mesh): THREE.LineSegments | undefined {
  return mesh.children.find((child) => child.userData.drawEdges) as
    | THREE.LineSegments
    | undefined;
}

function offsetFacesOf(layer: DrawLayer, solid: THREE.Material) {
  let copy = layer.offsetFaces.get(solid);
  if (copy) return copy;
  copy = solid.clone();
  copy.polygonOffset = true;
  copy.polygonOffsetFactor = 1;
  copy.polygonOffsetUnits = 1;
  // Not copied by `clone`, and what cuts out the pixels an `.s3o` masks off.
  copy.onBeforeCompile = solid.onBeforeCompile;
  copy.customProgramCacheKey = solid.customProgramCacheKey;
  layer.offsetFaces.set(solid, copy);
  return copy;
}

/**
 * Put every piece's mesh in the layer's mode.
 *
 * Cheap enough to run on every frame: one pass over the pieces that does
 * nothing when nothing has changed. Frees the edges and copies no piece uses.
 */
export function refreshDrawMode(
  layer: DrawLayer,
  groups: Iterable<THREE.Object3D>,
) {
  // The usual case, every frame: solid, with nothing left over to put back.
  if (
    layer.mode === "solid" &&
    layer.edges.size === 0 &&
    layer.offsetFaces.size === 0
  ) {
    return;
  }
  const ours = new Set<THREE.Material>([
    layer.ghost,
    ...layer.offsetFaces.values(),
  ]);
  const usedGeometry = new Set<THREE.BufferGeometry>();
  const usedSolid = new Set<THREE.Material>();

  for (const group of groups) {
    const mesh = meshOf(group);
    if (!mesh) continue;

    // Whatever is on the mesh and is not ours is a material a caller just
    // assigned, and is the one to give back in solid.
    if (!Array.isArray(mesh.material) && !ours.has(mesh.material)) {
      mesh.userData.solid = mesh.material;
    }
    const solid = mesh.userData.solid as THREE.Material | undefined;
    if (!solid) continue;
    usedSolid.add(solid);

    const lines = edgeLinesOf(mesh);
    if (layer.mode === "solid") {
      mesh.material = solid;
      lines?.removeFromParent();
      continue;
    }
    mesh.material =
      layer.mode === "wireframe" ? layer.ghost : offsetFacesOf(layer, solid);

    let edges = layer.edges.get(mesh.geometry);
    if (!edges) {
      edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE);
      layer.edges.set(mesh.geometry, edges);
    }
    usedGeometry.add(mesh.geometry);
    if (lines) {
      if (lines.geometry !== edges) lines.geometry = edges;
      lines.visible = true;
    } else {
      const added = new THREE.LineSegments(edges, layer.lines);
      added.userData.drawEdges = true;
      // Never picked: a click is decided by the faces, so a near miss of an
      // edge does not select, and an edge does not hide a piece behind it.
      added.raycast = () => {};
      mesh.add(added);
    }
  }

  for (const [geometry, edges] of layer.edges) {
    if (usedGeometry.has(geometry)) continue;
    edges.dispose();
    layer.edges.delete(geometry);
  }
  for (const [solid, copy] of layer.offsetFaces) {
    // The solid material is patched a frame after it is first drawn, once its
    // texture is known to carry a team colour mask. The copy follows.
    if (copy.onBeforeCompile !== solid.onBeforeCompile) {
      copy.onBeforeCompile = solid.onBeforeCompile;
      copy.customProgramCacheKey = solid.customProgramCacheKey;
      copy.needsUpdate = true;
    }
    if (layer.mode === "both" && usedSolid.has(solid)) continue;
    copy.dispose();
    layer.offsetFaces.delete(solid);
  }
}

/**
 * Show the unit solid until the returned function is called, for a thumbnail or
 * a build picture, which always show the solid unit whatever mode is on.
 */
export function showSolid(groups: Iterable<THREE.Object3D>): () => void {
  const undo: (() => void)[] = [];
  for (const group of groups) {
    const mesh = meshOf(group);
    const solid = mesh?.userData.solid as THREE.Material | undefined;
    if (!mesh || !solid) continue;
    const drawn = mesh.material;
    mesh.material = solid;
    const lines = edgeLinesOf(mesh);
    const wasVisible = lines?.visible ?? false;
    if (lines) lines.visible = false;
    undo.push(() => {
      mesh.material = drawn;
      if (lines) lines.visible = wasVisible;
    });
  }
  return () => {
    for (const restore of undo) restore();
  };
}

/** Return the pieces to solid and free everything the layer made. */
export function disposeDrawLayer(
  layer: DrawLayer,
  groups: Iterable<THREE.Object3D>,
) {
  layer.mode = "solid";
  refreshDrawMode(layer, groups);
  layer.ghost.dispose();
  layer.lines.dispose();
}
