import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { type LegoPackManifest, type LoadedPack, mergePacks } from "./pack";

export function bundledPack(): LoadedPack {
  const dir = fileURLToPath(
    new URL("../../src-tauri/legoparts/", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${dir}pack.json`, "utf8"),
  ) as LegoPackManifest;
  const blob = new Uint8Array(gunzipSync(readFileSync(`${dir}parts.bin.gz`)));
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const vo = view.getUint32(16, true),
    vb = view.getUint32(20, true),
    io = view.getUint32(24, true),
    ib = view.getUint32(28, true);
  const vertices = new Float32Array(blob.slice(vo, vo + vb).buffer);
  const indices = new Uint16Array(blob.slice(io, io + ib).buffer);
  const merged = mergePacks([{ manifest, vertices, indices }]);
  return {
    ...merged,
    vertices,
    indices,
    library: { packs: [manifest], atlases: [], dir: "", problems: [] },
  };
}
