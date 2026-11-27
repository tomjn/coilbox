/**
 * Draws written OBJ files with their PNG textures from three-quarter view,
 * reading both back from disk, to check the UVs land on the right texels.
 * RENDER is a comma-separated list of folder/model/texture.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "vitest";

const OUT = new URL("../../docs/reports/town-models/out/", import.meta.url)
  .pathname;

function readPng(path: string): { w: number; h: number; px: Uint8Array } {
  const b = readFileSync(path);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    if (b.toString("ascii", o + 4, o + 8) === "IDAT")
      idat.push(b.subarray(o + 8, o + 8 + len));
    o += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 3 + 1)] !== 0) throw new Error("only filter 0 is written");
    px.set(raw.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1)), y * w * 3);
  }
  return { w, h, px };
}

function writePng(path: string, px: Uint8Array, w: number, h: number) {
  // Reuse the same minimal encoder shape as the exporter, unfiltered RGB.
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    Buffer.from(px.subarray(y * w * 3, (y + 1) * w * 3)).copy(
      raw,
      y * (w * 3 + 1) + 1,
    );
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (d: Buffer) => {
    let c = 0xffffffff;
    for (const x of d) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const td = Buffer.concat([Buffer.from(t), d]);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function render(
  folder: string,
  model: string,
  texture: string,
  size = 512,
): Uint8Array {
  const dir = `${OUT}${folder}/${model}/`;
  const v: number[][] = [];
  const vt: number[][] = [];
  const faces: [number, number][][] = [];
  for (const line of readFileSync(`${dir}${model}.obj`, "utf8").split("\n")) {
    const p = line.split(" ");
    if (p[0] === "v") v.push(p.slice(1).map(Number));
    else if (p[0] === "vt") vt.push(p.slice(1).map(Number));
    else if (p[0] === "f")
      faces.push(
        p
          .slice(1)
          .map(
            (s) => s.split("/").map((x) => Number(x) - 1) as [number, number],
          ),
      );
  }
  const tex = readPng(`${dir}textures/${texture}.png`);
  // Z up: look from the south-east and above.
  const yaw = Math.PI / 4,
    pitch = 0.5;
  const view = (p: number[]) => {
    const x = p[0] * Math.cos(yaw) - p[1] * Math.sin(yaw);
    const y = p[0] * Math.sin(yaw) + p[1] * Math.cos(yaw);
    return [
      x,
      p[2] * Math.cos(pitch) + y * Math.sin(pitch),
      y * Math.cos(pitch) - p[2] * Math.sin(pitch),
    ];
  };
  const pv = v.map(view);
  const lo = [Infinity, Infinity],
    hi = [-Infinity, -Infinity];
  for (const p of pv)
    for (let d = 0; d < 2; d++) {
      lo[d] = Math.min(lo[d], p[d]);
      hi[d] = Math.max(hi[d], p[d]);
    }
  const scale = (size * 0.9) / Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const sx = (p: number[]) => [
    size / 2 + (p[0] - (lo[0] + hi[0]) / 2) * scale,
    size / 2 - (p[1] - (lo[1] + hi[1]) / 2) * scale,
    p[2],
  ];
  const img = new Uint8Array(size * size * 3).fill(40);
  const depth = new Float32Array(size * size).fill(Infinity);
  const sun = [0.4, -0.3, 0.86];
  for (const f of faces) {
    const [a, b, c] = f.map(([i]) => sx(pv[i]));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) continue;
    const [A, B, C] = f.map(([i]) => v[i]);
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
      e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const nl = Math.hypot(...n) || 1;
    const light =
      0.45 +
      0.55 * Math.abs((n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / nl);
    const uvs = f.map(([, t]) => vt[t]);
    for (
      let y = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      y <= Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
        x <= Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        x++
      ) {
        const w1 =
          ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / area;
        const w2 =
          ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / area;
        const w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = a[2] * w0 + b[2] * w1 + c[2] * w2;
        const o = y * size + x;
        if (z >= depth[o]) continue;
        depth[o] = z;
        const u = uvs[0][0] * w0 + uvs[1][0] * w1 + uvs[2][0] * w2;
        const t = uvs[0][1] * w0 + uvs[1][1] * w1 + uvs[2][1] * w2;
        const tx = Math.min(tex.w - 1, Math.max(0, Math.floor(u * tex.w)));
        const ty = Math.min(
          tex.h - 1,
          Math.max(0, Math.floor((1 - t) * tex.h)),
        );
        for (let k = 0; k < 3; k++)
          img[o * 3 + k] = Math.min(
            255,
            tex.px[(ty * tex.w + tx) * 3 + k] * light,
          );
      }
  }
  return img;
}

test("render", () => {
  const picks = (process.env.RENDER ?? "").split(",").filter(Boolean);
  const size = 384;
  const sheet = new Uint8Array(size * picks.length * size * 3);
  picks.forEach((pick, i) => {
    const [folder, model, texture] = pick.split("/");
    const img = render(folder, model, texture, size);
    for (let y = 0; y < size; y++)
      sheet.set(
        img.subarray(y * size * 3, (y + 1) * size * 3),
        (y * size * picks.length + i * size) * 3,
      );
  });
  writePng(`${OUT}render.png`, sheet, size * picks.length, size);
});
