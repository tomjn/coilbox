// @vitest-environment happy-dom
/**
 * The one thing worth proving about the `.glb` round trip: coilbox can read
 * what coilbox writes.
 *
 * The writer is three.js's `GLTFExporter` on this side of the IPC and the
 * reader is hand-written Rust on the other, and neither half's own tests say
 * anything about the other. So this runs the real exporter and drops what it
 * produces at `crates/tauri-plugin-coilbox-lego/tests/exported.glb`, which
 * `glb.rs`'s `opens_the_file_coilboxs_own_exporter_writes` opens. Change the
 * exporter and this rewrites the fixture, so `cargo test` is what tells you the
 * reader can no longer keep up.
 *
 * A DOM because `GLTFExporter` reaches for one. No texture, because embedding
 * one goes through a canvas that happy-dom does not have. The embedded picture
 * is covered by `glb.rs`'s own tests, which build a container by hand.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { exportGlb } from "./exportGlb";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";

/** Same fixture as `exportGlb.test.ts`. */
function pack(): LoadedPack {
  const part: LegoPartInfo = {
    id: "tri",
    packId: "lego",
    shapeId: "tri",
    name: "tri",
    category: "grey",
    colourway: "grey",
    shape: "tri",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 3,
    iFirst: 0,
    iCount: 3,
    bbox: { min: [0, 0, 0], max: [1, 0, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
  };
  const vertices = new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1,
  ]);
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [part],
    byId: new Map([["tri", part]]),
    vertices,
    indices: new Uint16Array([0, 1, 2]),
  };
}

function project(pieces: Partial<LegoPiece>[]): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "probe",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-28T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      ...pieces.map((piece, i) => ({
        id: `piece${i}`,
        name: `piece${i}`,
        parentId: "root",
        partId: "tri",
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        ...piece,
      })),
    ],
  };
}

/** Where the Rust reader's test looks for it. */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../crates/tauri-plugin-coilbox-lego/tests/exported.glb",
);

describe("exportGlb", () => {
  it("writes a .glb the Rust importer opens", async () => {
    const doc = project([
      { id: "hull", name: "hull", parentId: "root", position: [1, 2, 3] },
      { id: "gun", name: "gun", parentId: "hull", position: [0, 4, 0] },
    ]);

    const bytes = await exportGlb(doc, pack(), null, null);

    expect(bytes).not.toBeNull();
    const header = new DataView(bytes as ArrayBuffer);
    // "glTF", version 2, and the length the container claims.
    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe((bytes as ArrayBuffer).byteLength);

    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, new Uint8Array(bytes as ArrayBuffer));
  });
});
