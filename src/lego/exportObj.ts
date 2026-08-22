/**
 * A unit as Wavefront `.obj` plus its `.mtl`, for taking a build into Blender
 * either to check it against the `.s3o` or to finish it by hand.
 *
 * Vertices, normals and winding come straight from `bakedPieces`, the same
 * baked form the s3o writer uses, so the two agree on orientation and
 * winding (see s3oBuild.ts). OBJ has no node hierarchy though: unlike glTF,
 * there is no parent-child transform an importer could re-apply. So each
 * piece becomes its own named `o` block, and its vertices are baked to world
 * space by walking the piece's offset chain from the root, rather than left
 * relative to a parent that does not exist in the format.
 */

import { childrenOf, type LegoProject, pieceById } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { bakedPieces } from "./s3oBuild";

export interface ObjBuild {
  obj: string;
  mtl: string;
}

const MATERIAL_NAME = "atlas";

/**
 * Build the `.obj` and `.mtl` text for a unit.
 *
 * `textureName` is the file name the `.mtl` should point `map_Kd` at, which
 * the caller is responsible for actually writing next to the `.obj`: a
 * texture reference to a file that is not there defeats the point of a
 * faithful export. `null` for a unit whose texture could not be found, which
 * gets a material with no map rather than one pointing at nothing.
 *
 * `maskName` is a model's second texture, which an imported unit has and a
 * built one does not. `.mtl` has no slot for it, so it is named in a comment:
 * the file is there beside the `.obj`, and saying so is the difference between
 * leaving it for the reader and quietly dropping it.
 */
export function buildObj(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  options: {
    unitName: string;
    textureName: string | null;
    maskName?: string | null;
  },
): ObjBuild | null {
  if (!pieceById(project, project.rootPieceId)) return null;
  const { pieces } = bakedPieces(project, pack, raw);

  const lines: string[] = [
    `# ${options.unitName}, exported from coilbox's lego unit builder`,
    `mtllib ${options.unitName}.mtl`,
  ];

  // One counter for v, vt and vn together. Every vertex, in every piece,
  // contributes exactly one line to each of the three lists, so the file's
  // three index spaces always advance in lockstep and one running index
  // addresses all three correctly.
  let nextIndex = 1;

  const visit = (pieceId: string, parentWorld: [number, number, number]) => {
    const baked = pieces.get(pieceId);
    if (!baked) return;
    const world: [number, number, number] = [
      parentWorld[0] + baked.offset[0],
      parentWorld[1] + baked.offset[1],
      parentWorld[2] + baked.offset[2],
    ];

    if (baked.vertices.length > 0) {
      const base = nextIndex;
      lines.push(`o ${baked.name}`, `usemtl ${MATERIAL_NAME}`);
      for (const vertex of baked.vertices) {
        lines.push(
          `v ${fmt(vertex.pos[0] + world[0])} ${fmt(vertex.pos[1] + world[1])} ${fmt(vertex.pos[2] + world[2])}`,
        );
      }
      for (const vertex of baked.vertices) {
        lines.push(`vt ${fmt(vertex.uv[0])} ${fmt(vertex.uv[1])}`);
      }
      for (const vertex of baked.vertices) {
        lines.push(
          `vn ${fmt(vertex.normal[0])} ${fmt(vertex.normal[1])} ${fmt(vertex.normal[2])}`,
        );
      }
      for (let i = 0; i + 2 < baked.indices.length; i += 3) {
        const a = base + baked.indices[i];
        const b = base + baked.indices[i + 1];
        const c = base + baked.indices[i + 2];
        lines.push(`f ${face(a)} ${face(b)} ${face(c)}`);
      }
      nextIndex += baked.vertices.length;
    }

    // An empty piece is hierarchy only, same as in an s3o, but obj has
    // nothing to carry it in: only its geometry-bearing descendants show up,
    // baked to where they actually sit.
    for (const child of childrenOf(project, pieceId)) visit(child.id, world);
  };
  visit(project.rootPieceId, [0, 0, 0]);

  const mtl = [
    `newmtl ${MATERIAL_NAME}`,
    "Ka 1.000000 1.000000 1.000000",
    "Kd 1.000000 1.000000 1.000000",
    "Ks 0.000000 0.000000 0.000000",
    "d 1.000000",
    "illum 1",
    ...(options.textureName ? [`map_Kd ${options.textureName}`] : []),
    ...(options.maskName
      ? [
          `# ${options.maskName} sits beside this file. It is the model's second`,
          "# texture, which the engine reads as glow in red, shine in green and",
          "# visibility in alpha. None of that is colour, so nothing here samples",
          "# it.",
        ]
      : []),
    "",
  ].join("\n");

  return { obj: `${lines.join("\n")}\n`, mtl };
}

function face(index: number): string {
  return `${index}/${index}/${index}`;
}

/** `-0` reads as a genuine negative to a human diffing the file. */
function fmt(n: number): string {
  const value = Object.is(n, -0) ? 0 : n;
  return value.toFixed(6);
}
