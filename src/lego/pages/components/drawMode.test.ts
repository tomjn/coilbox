import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  disposeDrawLayer,
  newDrawLayer,
  nextDrawMode,
  refreshDrawMode,
  showSolid,
} from "./drawMode";

function piece(geometry: THREE.BufferGeometry, material: THREE.Material) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return { group, mesh };
}

function edgesOf(mesh: THREE.Mesh) {
  return mesh.children.filter(
    (child): child is THREE.LineSegments =>
      (child as THREE.LineSegments).isLineSegments === true,
  );
}

describe("nextDrawMode", () => {
  it("cycles solid, wireframe, both, and back", () => {
    expect(nextDrawMode("solid")).toBe("wireframe");
    expect(nextDrawMode("wireframe")).toBe("both");
    expect(nextDrawMode("both")).toBe("solid");
  });
});

describe("refreshDrawMode", () => {
  it("leaves a solid unit alone", () => {
    const material = new THREE.MeshStandardMaterial();
    const { group, mesh } = piece(new THREE.BoxGeometry(2, 2, 2), material);
    const layer = newDrawLayer();

    refreshDrawMode(layer, [group]);

    expect(mesh.material).toBe(material);
    expect(edgesOf(mesh)).toHaveLength(0);
    disposeDrawLayer(layer, [group]);
  });

  it("draws the outline of a block and not the diagonal of each face", () => {
    const { group, mesh } = piece(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial(),
    );
    const layer = newDrawLayer();
    layer.mode = "wireframe";

    refreshDrawMode(layer, [group]);

    const [lines] = edgesOf(mesh);
    // 12 edges of a cube, two vertices each. `material.wireframe` would draw
    // 18, one diagonal across each of the six faces as well.
    expect(lines.geometry.getAttribute("position").count).toBe(24);
    disposeDrawLayer(layer, [group]);
  });

  it("draws a flat face as its four sides", () => {
    const { group, mesh } = piece(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshStandardMaterial(),
    );
    const layer = newDrawLayer();
    layer.mode = "wireframe";

    refreshDrawMode(layer, [group]);

    expect(edgesOf(mesh)[0].geometry.getAttribute("position").count).toBe(8);
    disposeDrawLayer(layer, [group]);
  });

  it("hides the faces without touching the shared material", () => {
    const shared = new THREE.MeshStandardMaterial();
    const a = piece(new THREE.BoxGeometry(1, 1, 1), shared);
    const b = piece(new THREE.BoxGeometry(1, 1, 1), shared);
    const layer = newDrawLayer();
    layer.mode = "wireframe";

    refreshDrawMode(layer, [a.group, b.group]);

    const drawn = a.mesh.material as THREE.Material;
    expect(drawn).not.toBe(shared);
    expect(drawn.visible).toBe(false);
    expect(b.mesh.material).toBe(drawn);
    // Other views draw with this material, so it stays as it was.
    expect(shared.visible).toBe(true);
    disposeDrawLayer(layer, [a.group, b.group]);
  });

  it("still picks a piece by clicking inside its outline", () => {
    const { group, mesh } = piece(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial(),
    );
    const layer = newDrawLayer();
    layer.mode = "wireframe";
    refreshDrawMode(layer, [group]);

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(0, 0, -1),
    );
    const hits = raycaster.intersectObject(group, true);

    expect(hits[0]?.object).toBe(mesh);
    // The lines are not pickable, or a near miss would select by its edge.
    expect(hits.every((hit) => hit.object === mesh)).toBe(true);
    disposeDrawLayer(layer, [group]);
  });

  it("shares one set of edges between pieces on the same geometry", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const a = piece(geometry, material);
    const b = piece(geometry, material);
    const layer = newDrawLayer();
    layer.mode = "wireframe";

    refreshDrawMode(layer, [a.group, b.group]);

    expect(edgesOf(a.mesh)[0].geometry).toBe(edgesOf(b.mesh)[0].geometry);
    expect(layer.edges.size).toBe(1);
    disposeDrawLayer(layer, [a.group, b.group]);
  });

  it("follows a piece whose geometry is swapped, as a baked bake does", () => {
    const first = new THREE.BoxGeometry(1, 1, 1);
    const { group, mesh } = piece(first, new THREE.MeshStandardMaterial());
    const layer = newDrawLayer();
    layer.mode = "wireframe";
    refreshDrawMode(layer, [group]);
    const old = edgesOf(mesh)[0].geometry;
    let freed = false;
    old.addEventListener("dispose", () => {
      freed = true;
    });

    mesh.geometry = new THREE.BoxGeometry(3, 3, 3);
    refreshDrawMode(layer, [group]);

    expect(edgesOf(mesh)).toHaveLength(1);
    expect(edgesOf(mesh)[0].geometry).not.toBe(old);
    expect(freed).toBe(true);
    expect(layer.edges.size).toBe(1);
    disposeDrawLayer(layer, [group]);
  });

  it("takes up a material a caller reassigned under it", () => {
    const first = new THREE.MeshStandardMaterial();
    const second = new THREE.MeshStandardMaterial();
    const { group, mesh } = piece(new THREE.BoxGeometry(1, 1, 1), first);
    const layer = newDrawLayer();
    layer.mode = "wireframe";
    refreshDrawMode(layer, [group]);

    mesh.material = second;
    refreshDrawMode(layer, [group]);
    layer.mode = "solid";
    refreshDrawMode(layer, [group]);

    expect(mesh.material).toBe(second);
    disposeDrawLayer(layer, [group]);
  });

  it("draws faces and edges together with the faces pushed back", () => {
    const map = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map });
    const { group, mesh } = piece(new THREE.BoxGeometry(1, 1, 1), material);
    const layer = newDrawLayer();
    layer.mode = "both";

    refreshDrawMode(layer, [group]);

    const drawn = mesh.material as THREE.MeshStandardMaterial;
    expect(drawn).not.toBe(material);
    expect(drawn.map).toBe(map);
    expect(drawn.visible).toBe(true);
    expect(drawn.polygonOffset).toBe(true);
    expect(edgesOf(mesh)).toHaveLength(1);
    expect(material.polygonOffset).toBe(false);
    disposeDrawLayer(layer, [group]);
  });

  it("gives everything back when the mode goes to solid", () => {
    const material = new THREE.MeshStandardMaterial();
    const { group, mesh } = piece(new THREE.BoxGeometry(1, 1, 1), material);
    const layer = newDrawLayer();
    layer.mode = "both";
    refreshDrawMode(layer, [group]);
    let freed = 0;
    edgesOf(mesh)[0].geometry.addEventListener("dispose", () => {
      freed += 1;
    });
    (mesh.material as THREE.Material).addEventListener("dispose", () => {
      freed += 1;
    });

    layer.mode = "solid";
    refreshDrawMode(layer, [group]);

    expect(mesh.material).toBe(material);
    expect(edgesOf(mesh)).toHaveLength(0);
    expect(layer.edges.size).toBe(0);
    expect(layer.offsetFaces.size).toBe(0);
    expect(freed).toBe(2);
    disposeDrawLayer(layer, [group]);
  });
});

describe("showSolid", () => {
  it("shows the solid unit for a thumbnail and puts the mode back after", () => {
    const material = new THREE.MeshStandardMaterial();
    const { group, mesh } = piece(new THREE.BoxGeometry(1, 1, 1), material);
    const layer = newDrawLayer();
    layer.mode = "wireframe";
    refreshDrawMode(layer, [group]);
    const ghost = mesh.material;

    const restore = showSolid([group]);
    expect(mesh.material).toBe(material);
    expect(edgesOf(mesh)[0].visible).toBe(false);

    restore();
    expect(mesh.material).toBe(ghost);
    expect(edgesOf(mesh)[0].visible).toBe(true);
    disposeDrawLayer(layer, [group]);
  });
});

describe("disposeDrawLayer", () => {
  it("frees the edges, the clones and the shared materials", () => {
    const { group } = piece(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    const layer = newDrawLayer();
    layer.mode = "both";
    refreshDrawMode(layer, [group]);
    let freed = 0;
    for (const material of [layer.ghost, layer.lines]) {
      material.addEventListener("dispose", () => {
        freed += 1;
      });
    }

    disposeDrawLayer(layer, [group]);

    expect(freed).toBe(2);
    expect(layer.edges.size).toBe(0);
    expect(layer.offsetFaces.size).toBe(0);
  });
});
