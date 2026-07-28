/**
 * Reads a Wings3D `.wings` file into plain objects.
 *
 * Container: a 15-byte header, a 4-byte big-endian payload size, then a term in
 * the Erlang external term format. Wings compresses the term, so the payload
 * starts `0x83 0x50`.
 *
 * The term is `{wings, Version, {Objects, Materials, Props}}`, where each object
 * is `{object, Name, {winged, Edges, Faces, Verts, HardEdges}, Props}`.
 */

import { decodeTerm } from "./etf.mjs";

const MAGIC = "#!WINGS-1.0\r\n";

/** Field order of the `{edge, ...}` record, from Wings' `export_edge`. */
const EDGE_FIELDS = ["vs", "ve", "lf", "rf", "ltpr", "ltsu", "rtpr", "rtsu"];

/**
 * @typedef {object} WingsEdge
 * @property {number} vs start vertex
 * @property {number} ve end vertex
 * @property {number} lf left face
 * @property {number} rf right face
 * @property {number} ltpr left traversal predecessor
 * @property {number} ltsu left traversal successor
 * @property {number} rtpr right traversal predecessor
 * @property {number} rtsu right traversal successor
 * @property {[number, number] | null} uvLt uv at `vs`, present only when the
 *   left face was unwrapped
 * @property {[number, number] | null} uvRt uv at `ve`, same for the right face
 */

/**
 * @typedef {object} WingsObject
 * @property {string} name
 * @property {WingsEdge[]} edges
 * @property {string[]} faceMaterials indexed by face id
 * @property {Array<[number, number, number]>} vertices
 * @property {Set<number>} hardEdges
 */

/**
 * @param {Uint8Array} bytes
 * @returns {{ version: number, objects: WingsObject[], materials: string[] }}
 */
export function readWings(bytes) {
  const head = Buffer.from(bytes.subarray(0, MAGIC.length)).toString("latin1");
  if (head !== MAGIC) {
    throw new Error("not a .wings file: header magic does not match");
  }

  const declared = new DataView(
    bytes.buffer,
    bytes.byteOffset + MAGIC.length,
    4,
  ).getUint32(0);
  const payload = bytes.subarray(MAGIC.length + 4);
  if (payload.length < declared) {
    throw new Error(
      `payload is ${payload.length} bytes, header declares ${declared}`,
    );
  }

  const term = decodeTerm(payload);
  if (!Array.isArray(term) || term[0] !== "wings") {
    throw new Error("payload is not a wings term");
  }

  const [, version, content] = term;
  const [rawObjects, rawMaterials] = content;

  return {
    version,
    objects: rawObjects.map(readObject),
    materials: rawMaterials.map(([name]) => latin1(name)),
  };
}

/** @returns {WingsObject} */
function readObject(record) {
  const [, name, winged] = record;
  const [, rawEdges, rawFaces, rawVertices, rawHardEdges] = winged;

  return {
    name: latin1(name),
    edges: rawEdges.map(readEdge),
    faceMaterials: rawFaces.map(readFaceMaterial),
    vertices: rawVertices.map(readVertex),
    hardEdges: new Set(rawHardEdges),
  };
}

/** @returns {WingsEdge} */
function readEdge(entries) {
  const edge = { uvLt: null, uvRt: null };
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    switch (entry[0]) {
      case "edge":
        EDGE_FIELDS.forEach((field, i) => {
          edge[field] = entry[i + 1];
        });
        break;
      case "uv_lt":
        edge.uvLt = readUv(entry[1]);
        break;
      case "uv_rt":
        edge.uvRt = readUv(entry[1]);
        break;
      default:
        // Vertex colours and other per-edge attributes are not used here.
        break;
    }
  }
  if (edge.vs === undefined) {
    throw new Error("edge record has no {edge, ...} tuple");
  }
  return edge;
}

/**
 * Wings writes an unnamed material as an empty property list, which means the
 * default material.
 */
function readFaceMaterial(entries) {
  for (const entry of entries) {
    if (Array.isArray(entry) && entry[0] === "material")
      return latin1(entry[1]);
  }
  return "default";
}

function readVertex(entries) {
  for (const entry of entries) {
    if (entry instanceof Uint8Array) {
      const view = new DataView(
        entry.buffer,
        entry.byteOffset,
        entry.byteLength,
      );
      return [view.getFloat64(0), view.getFloat64(8), view.getFloat64(16)];
    }
  }
  throw new Error("vertex record has no position binary");
}

function readUv(binary) {
  const view = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  return [view.getFloat64(0), view.getFloat64(8)];
}

/** Atoms decode to strings already; names arrive as Erlang strings. */
function latin1(value) {
  if (typeof value === "string") return value;
  return Buffer.from(value).toString("latin1");
}
