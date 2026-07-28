/**
 * Reads the Wavefront OBJ the parts library ships as.
 *
 * Only what a parts library uses: positions, texture coordinates, normals,
 * object groups, materials and faces. No smoothing groups, no curves, no
 * relative indices beyond the negative form.
 *
 * Faces keep their own corners rather than being triangulated here, because a
 * corner carries three separate indices and losing that pairing is how UVs end
 * up on the wrong vertex.
 */

/**
 * @typedef {object} ObjCorner
 * @property {number} v index into `positions`
 * @property {number | null} vt index into `uvs`
 * @property {number | null} vn index into `normals`
 */

/**
 * @typedef {object} ObjObject
 * @property {string} name
 * @property {Array<{ material: string, corners: ObjCorner[] }>} faces
 */

/**
 * @param {string} text
 * @returns {{
 *   positions: Array<[number, number, number]>,
 *   uvs: Array<[number, number]>,
 *   normals: Array<[number, number, number]>,
 *   objects: ObjObject[],
 *   materialLibs: string[],
 * }}
 */
export function readObj(text) {
  const positions = [];
  const uvs = [];
  const normals = [];
  const objects = [];
  const materialLibs = [];
  let material = "default";
  let current = null;
  let seenObject = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const space = line.indexOf(" ");
    if (space === -1) continue;
    const keyword = line.slice(0, space);
    const rest = line.slice(space + 1).trim();

    switch (keyword) {
      case "v":
        positions.push(numbers(rest, 3));
        break;
      case "vt": {
        const [u, v] = numbers(rest, 2);
        uvs.push([u, v]);
        break;
      }
      case "vn":
        normals.push(numbers(rest, 3));
        break;
      case "mtllib":
        materialLibs.push(rest);
        break;
      case "usemtl":
        material = rest;
        break;
      case "o":
        current = { name: rest, faces: [] };
        objects.push(current);
        seenObject = true;
        break;
      case "g": {
        // Wings writes `o <Part>` then `g <Part>_<Material>`, so a group is a
        // material run inside a part rather than a part of its own. Treating it
        // as one would split every part in two. Files that use only groups still
        // work, because then no `o` has been seen.
        if (seenObject) break;
        current = { name: rest, faces: [] };
        objects.push(current);
        break;
      }
      case "f": {
        if (!current) {
          current = { name: "unnamed", faces: [] };
          objects.push(current);
        }
        current.faces.push({
          material,
          corners: rest
            .split(/\s+/)
            .map((token) => corner(token, positions, uvs, normals)),
        });
        break;
      }
      default:
        // Smoothing groups, curves and anything else a parts library does not
        // need are skipped rather than treated as an error.
        break;
    }
  }

  return { positions, uvs, normals, objects, materialLibs };
}

/**
 * `v`, `v/vt`, `v//vn` or `v/vt/vn`. Indices are one based, and negative means
 * counting back from the end of whatever has been read so far.
 */
function corner(token, positions, uvs, normals) {
  const [v, vt, vn] = token.split("/");
  return {
    v: resolve(v, positions.length),
    vt: vt ? resolve(vt, uvs.length) : null,
    vn: vn ? resolve(vn, normals.length) : null,
  };
}

function resolve(text, count) {
  const index = Number.parseInt(text, 10);
  if (!Number.isFinite(index) || index === 0) {
    throw new Error(`bad index ${text} in a face`);
  }
  return index > 0 ? index - 1 : count + index;
}

function numbers(text, count) {
  const parts = text.split(/\s+/).slice(0, count).map(Number);
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`expected ${count} numbers, got ${JSON.stringify(text)}`);
  }
  return parts;
}
