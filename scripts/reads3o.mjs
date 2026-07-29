/**
 * Read an s3o back and report what an engine would find.
 *
 * Usage: bun run lego:reads3o <file.s3o>
 *
 * Written from docs/s3o-format.md alone, and deliberately sharing no code with
 * `crates/coilbox-s3o`. Our reader agreeing with our writer proves very little,
 * so this is a second opinion: if the two disagree, one of them is wrong and
 * the disagreement is the finding.
 *
 * That is not hypothetical. This is how the collision radius bug was found: the
 * builder measured `radius` from the world origin, where a shipped model
 * measures it from `mid`, giving anything built off-centre a collision sphere
 * far larger than its geometry.
 *
 * It checks the two conventions a generator can silently get wrong, winding
 * against the vertex normals and UVs outside the atlas, and prints the numbers
 * worth eyeballing. Run it on a known-good model as well as your own output:
 *
 *   bun run lego:reads3o crates/coilbox-s3o/tests/fixtures/ammobox2.s3o
 *
 * Not a test. It reports, and leaves the judgement to a person.
 */

import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun run lego:reads3o <file.s3o>");
  process.exit(2);
}

const buf = readFileSync(path);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const magic = buf.subarray(0, 12).toString("latin1");
const header = {
  version: view.getInt32(12, true),
  radius: view.getFloat32(16, true),
  height: view.getFloat32(20, true),
  mid: [24, 28, 32].map((at) => view.getFloat32(at, true)),
  rootPiece: view.getUint32(36, true),
  collision: view.getUint32(40, true),
  texture1: view.getUint32(44, true),
  texture2: view.getUint32(48, true),
};

/** A NUL-terminated string anywhere in the file. Offset 0 means absent. */
function cstring(at) {
  if (at === 0) return "";
  let end = at;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(at, end).toString("latin1");
}

const problems = [];
const world = [];
let vertexCount = 0;
let triangleCount = 0;
let flipped = 0;
const uvMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
const uvMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

function readPiece(at, depth, parentOrigin) {
  const nameAt = view.getUint32(at, true);
  const childCount = view.getUint32(at + 4, true);
  const childTable = view.getUint32(at + 8, true);
  const vertCount = view.getUint32(at + 12, true);
  const vertAt = view.getUint32(at + 16, true);
  const vertexType = view.getUint32(at + 20, true);
  const primitiveType = view.getUint32(at + 24, true);
  const indexCount = view.getUint32(at + 28, true);
  const indexAt = view.getUint32(at + 32, true);
  const collision = view.getUint32(at + 36, true);
  const offset = [40, 44, 48].map((o) => view.getFloat32(at + o, true));

  const name = cstring(nameAt);
  const origin = offset.map((value, axis) => value + parentOrigin[axis]);

  if (vertexType !== 0) problems.push(`${name}: vertex type ${vertexType}`);
  if (primitiveType !== 0) {
    problems.push(
      `${name}: primitive type ${primitiveType}, expected triangles`,
    );
  }
  if (collision !== 0) problems.push(`${name}: collision offset must be 0`);
  if (indexCount % 3 !== 0) {
    problems.push(`${name}: ${indexCount} indices is not whole triangles`);
  }

  const vertices = [];
  for (let i = 0; i < vertCount; i++) {
    const at2 = vertAt + i * 32;
    const pos = [0, 4, 8].map((o) => view.getFloat32(at2 + o, true));
    const normal = [12, 16, 20].map((o) => view.getFloat32(at2 + o, true));
    const uv = [24, 28].map((o) => view.getFloat32(at2 + o, true));
    vertices.push({ pos, normal, uv });

    for (let axis = 0; axis < 2; axis++) {
      uvMin[axis] = Math.min(uvMin[axis], uv[axis]);
      uvMax[axis] = Math.max(uvMax[axis], uv[axis]);
    }
    world.push(pos.map((value, axis) => value + origin[axis]));
    if (!Number.isFinite(pos[0] + normal[0] + uv[0])) {
      problems.push(`${name}: vertex ${i} is not a finite number`);
    }
  }
  vertexCount += vertCount;

  const indices = [];
  for (let i = 0; i < indexCount; i++) {
    const index = view.getUint32(indexAt + i * 4, true);
    if (index === 0xffffffff) {
      problems.push(`${name}: end-of-strip marker in a triangle list`);
    } else if (index >= vertCount) {
      problems.push(`${name}: index ${index} addresses nothing`);
    }
    indices.push(index);
  }

  // Front faces wind counter-clockwise, so the face normal from the winding
  // should agree with the normals the vertices carry.
  let backwards = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = vertices[indices[i]];
    const b = vertices[indices[i + 1]];
    const c = vertices[indices[i + 2]];
    if (!a || !b || !c) continue;
    const ab = b.pos.map((value, axis) => value - a.pos[axis]);
    const ac = c.pos.map((value, axis) => value - a.pos[axis]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const mean = [0, 1, 2].map(
      (axis) => (a.normal[axis] + b.normal[axis] + c.normal[axis]) / 3,
    );
    const dot = cross[0] * mean[0] + cross[1] * mean[1] + cross[2] * mean[2];
    if (dot < 0) backwards++;
    triangleCount++;
  }
  flipped += backwards;

  const indent = "  ".repeat(depth);
  const size = `verts=${vertCount} tris=${indexCount / 3}`;
  const warn = backwards ? `  WOUND BACKWARDS: ${backwards}` : "";
  console.log(
    `${indent}${name}  offset=[${offset.map((n) => n.toFixed(3))}]  ${size}${warn}`,
  );

  for (let i = 0; i < childCount; i++) {
    readPiece(view.getUint32(childTable + i * 4, true), depth + 1, origin);
  }
}

console.log("header", {
  ...header,
  texture1: cstring(header.texture1),
  texture2: cstring(header.texture2),
});
console.log("\npieces:");
readPiece(header.rootPiece, 0, [0, 0, 0]);

let furthestFromOrigin = 0;
let furthestFromMid = 0;
const box = { min: [...world[0]], max: [...world[0]] };
for (const point of world) {
  furthestFromOrigin = Math.max(furthestFromOrigin, Math.hypot(...point));
  furthestFromMid = Math.max(
    furthestFromMid,
    Math.hypot(...point.map((value, axis) => value - header.mid[axis])),
  );
  for (let axis = 0; axis < 3; axis++) {
    box.min[axis] = Math.min(box.min[axis], point[axis]);
    box.max[axis] = Math.max(box.max[axis], point[axis]);
  }
}

console.log("\ntotals:", { vertices: vertexCount, triangles: triangleCount });
console.log(
  "world bbox:",
  box.min.map((n) => n.toFixed(3)),
  "to",
  box.max.map((n) => n.toFixed(3)),
);
console.log("header radius:            ", header.radius.toFixed(4));
// radius pairs with mid, so this is the one that should match the header.
console.log("furthest vertex from mid: ", furthestFromMid.toFixed(4));
console.log("furthest from the origin: ", furthestFromOrigin.toFixed(4));
console.log(
  "header height:",
  header.height.toFixed(4),
  "geometry top:",
  box.max[1].toFixed(4),
);
console.log(
  `uv range: u ${uvMin[0].toFixed(4)} to ${uvMax[0].toFixed(4)}, v ${uvMin[1].toFixed(4)} to ${uvMax[1].toFixed(4)}`,
);
console.log(
  `triangles wound against their normals: ${flipped} of ${triangleCount}`,
);

if (magic !== "Spring unit\0")
  problems.push(`magic is ${JSON.stringify(magic)}`);
if (header.version !== 0) problems.push(`version ${header.version}`);
if (header.collision !== 0) problems.push("header collision offset must be 0");

console.log(`\nproblems: ${problems.length === 0 ? "none" : problems.length}`);
for (const problem of problems) console.log(" -", problem);
process.exit(problems.length === 0 ? 0 : 1);
