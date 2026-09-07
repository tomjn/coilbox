//! Importing an arbitrary `.s3o` as raw geometry.
//!
//! A model that did not come out of the parts pack cannot be turned into parts
//! (see `src/lego/importS3o.ts` for why), so its meshes are kept as they are.
//! They do not go in the document: a document is one JSON file rewritten whole
//! on every autosave and undo keeps sixty copies of it, and the largest model
//! measured is 15.0 MB as JSON against 3.1 MiB packed. The floats go in a
//! sidecar beside the document instead, and the document keeps names, the tree
//! and a key per mesh.
//!
//! The sidecar is the parts pack's blob format with two differences, so it
//! carries what a pack's `pack.json` carries for a part: a directory naming
//! each mesh and its slice, and 32-bit indices, because an imported piece can
//! hold more vertices than a `uint16` can address. Both are why it is blob
//! version 2, which `src/lego/pack.ts` refuses as a parts pack.
//!
//! Layout, inflated, all little endian:
//!
//! | Offset | Size | Field |
//! | --- | --- | --- |
//! | 0 | 8 | magic, `CBLEGO\0\0` |
//! | 8 | 4 | `uint32` version, 2 |
//! | 12 | 4 | `uint32` mesh count |
//! | 16 | 4 | `uint32` offset of the vertex block |
//! | 20 | 4 | `uint32` length of the vertex block |
//! | 24 | 4 | `uint32` offset of the index block |
//! | 28 | 4 | `uint32` length of the index block |
//! | 32 | 4 | `uint32` offset of the directory |
//! | 36 | 4 | `uint32` length of the directory |
//!
//! The vertex block is per-mesh runs of the same 32-byte record the pack and
//! the format share: `float32` x, y, z, nx, ny, nz, u, v. The index block is
//! per-mesh runs of `uint32`, three per triangle, addressing the mesh's own
//! vertices. The directory is UTF-8 JSON, an array of
//! `{ id, vFirst, vCount, iFirst, iCount, bbox }`.

use std::collections::{BTreeMap, BTreeSet};

use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use std::io::Write;

const BLOB_MAGIC: &[u8; 8] = b"CBLEGO\0\0";
const BLOB_VERSION: u32 = 2;
const BLOB_HEADER_SIZE: usize = 40;
const FLOATS_PER_VERTEX: usize = 8;

/// One mesh's slice of the blob, and the box around it.
///
/// The box is computed here rather than on demand because everything that
/// snaps, frames or offers a pivot reads a part's `bbox` off the manifest, and
/// a raw mesh has to answer the same question without a second code path.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshEntry {
    id: String,
    v_first: usize,
    v_count: usize,
    i_first: usize,
    i_count: usize,
    bbox: Bbox,
}

#[derive(Serialize)]
struct Bbox {
    min: [f32; 3],
    max: [f32; 3],
}

/// One piece of the imported model: its name, where it sits, and which mesh it
/// draws. Deliberately not the vertices, which is the whole point of the blob.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPiece {
    pub name: String,
    pub offset: [f32; 3],
    /// `None` for a piece with no geometry: a hierarchy node, a flare or an aim
    /// point, which is how the format carries all three.
    pub mesh_id: Option<String>,
    pub children: Vec<ImportPiece>,
}

/// What one import produced: the tree, the blob, and what had to be converted.
pub struct Imported {
    pub root: ImportPiece,
    pub blob: Vec<u8>,
    pub meshes: usize,
    pub vertices: usize,
    pub triangles: usize,
    /// Pieces whose index list was quads or a strip rather than triangles, so
    /// the import can say it converted them rather than doing it silently.
    pub converted: usize,
    /// Faces a `.3do` names no texture for and whose Total Annihilation
    /// palette entry (`unittextures/tatex/palette.pal`) this could not
    /// resolve, because the file was not found beside the model or the entry
    /// named is outside the 256 it holds. They are drawn plain and counted
    /// rather than guessed at. A face whose entry did resolve is drawn in its
    /// real colour and is not counted here.
    pub palette_faces: usize,
    /// Texture names the model asks for that nothing on disk matched. Their
    /// faces are drawn plain, and saying which ones is the only way anybody
    /// works out what is missing.
    pub missing_textures: Vec<String>,
    /// `.3do` child pieces dropped as dead duplicates of an earlier sibling.
    /// Always 0 for an `.s3o`. See `is_dead_duplicate` for the exact rule.
    pub dropped_pieces: usize,
}

/// Flatten a model into a geometry blob and the tree that indexes it.
///
/// Every piece with triangles gets a mesh, keyed by its position in the
/// depth-first walk. The key is not the piece name: names in a shipped model
/// repeat, and the document's own names are normalised and made unique after
/// this, so a key derived from either would move under the geometry.
pub fn import(model: &coilbox_s3o::Model) -> Result<Imported, String> {
    let mut state = Walk::default();
    let root = walk(&model.root, &mut state);
    finish(root, state)
}

/// Flatten a `.3do` into the same blob, with every face's corners mapped onto
/// the sheet its tiles were packed into.
///
/// The pieces come out as one mesh each, unlike the viewer's flattening, which
/// keeps one batch per distinct texture a piece uses. After the packing there
/// is only one texture, so there is only one batch, and a lego piece draws one
/// mesh.
pub fn import_3do(model: &coilbox_3do::Model, rects: &Rects) -> Result<Imported, String> {
    let mut state = Walk::default();
    let root = walk_3do(&model.root, rects, &mut state);
    finish(root, state)
}

/// Flatten a `.glb` into the same blob, with each node's rotation and scale
/// baked into its own vertices.
///
/// A glTF node carries a full transform and an `.s3o` piece carries a
/// translation and nothing else, so the rest of it has to go somewhere. It goes
/// into the vertices, which is what `bakedPieces` in `src/lego/s3oBuild.ts` does
/// on the way out and what Upspring does on save. Doing it here rather than
/// putting a rotation on the document's piece keeps an imported `.glb` exactly
/// the shape an imported `.s3o` is: geometry at a translation, with nothing left
/// to inherit.
pub fn import_glb(model: &crate::glb::Model) -> Result<Imported, String> {
    let mut state = Walk {
        // Strips and fans were turned into triangles by the reader, and the
        // count means the same thing here as it does for an `.s3o`.
        converted: model.converted,
        ..Walk::default()
    };
    let root = walk_glb(&model.root, &crate::glb::IDENTITY, [0.0; 3], &mut state);
    finish(root, state)
}

/// Flatten one `.glb` node, and everything under it, into the blob.
fn walk_glb(
    node: &crate::glb::Node,
    parent_world: &[f32; 16],
    parent_translation: [f32; 3],
    state: &mut Walk,
) -> ImportPiece {
    let id = format!("m{}", state.next);
    state.next += 1;

    let world = crate::glb::multiply(parent_world, &node.matrix);
    let translation = [world[12], world[13], world[14]];
    // The rotation and scale without the translation, which is what the
    // vertices are baked with and why the offset below is a plain subtraction.
    let linear = linear_part(&world);

    let mut mesh_id = None;
    if let Some(mesh) = &node.mesh {
        let v_first = state.vertices.len() / FLOATS_PER_VERTEX;
        let i_first = state.indices.len();
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];

        // A normal goes through the inverse transpose, because a non-uniform
        // scale skews it if the matrix is applied to it directly.
        let normal_matrix = inverse_transpose(&linear);
        let plain = linear == IDENTITY_LINEAR;
        for (i, position) in mesh.positions.iter().enumerate() {
            let pos = apply(&linear, *position);
            // A mesh under an untransformed node is copied rather than
            // recomputed. Renormalising a normal that is not quite unit length
            // changes bytes for no reason, the same call `bakeGeometry` makes.
            let normal = if plain {
                mesh.normals[i]
            } else {
                normalise(apply(&normal_matrix, mesh.normals[i]))
            };
            for axis in 0..3 {
                min[axis] = min[axis].min(pos[axis]);
                max[axis] = max[axis].max(pos[axis]);
            }
            state.vertices.extend_from_slice(&pos);
            state.vertices.extend_from_slice(&normal);
            state.vertices.extend_from_slice(&mesh.uvs[i]);
        }

        // A mirroring transform turns every triangle inside out, so the winding
        // is reversed to match. Without it the piece is drawn back to front and
        // lit from inside.
        if determinant(&linear) < 0.0 {
            for face in mesh.indices.chunks(3) {
                match face {
                    [a, b, c] => state.indices.extend_from_slice(&[*a, *c, *b]),
                    rest => state.indices.extend_from_slice(rest),
                }
            }
        } else {
            state.indices.extend_from_slice(&mesh.indices);
        }

        state.directory.push(MeshEntry {
            id: id.clone(),
            v_first,
            v_count: mesh.positions.len(),
            i_first,
            i_count: mesh.indices.len(),
            bbox: Bbox { min, max },
        });
        mesh_id = Some(id);
    }

    ImportPiece {
        name: node.name.clone(),
        offset: [
            translation[0] - parent_translation[0],
            translation[1] - parent_translation[1],
            translation[2] - parent_translation[2],
        ],
        mesh_id,
        children: node
            .children
            .iter()
            .map(|child| walk_glb(child, &world, translation, state))
            .collect(),
    }
}

/// The 3x3 identity, column-major, as [`linear_part`] returns one.
const IDENTITY_LINEAR: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

/// A 4x4's rotation and scale without its translation, column-major.
fn linear_part(m: &[f32; 16]) -> [f32; 9] {
    [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
}

fn apply(m: &[f32; 9], v: [f32; 3]) -> [f32; 3] {
    [
        m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
        m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
        m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ]
}

fn determinant(m: &[f32; 9]) -> f32 {
    m[0] * (m[4] * m[8] - m[7] * m[5]) - m[3] * (m[1] * m[8] - m[7] * m[2])
        + m[6] * (m[1] * m[5] - m[4] * m[2])
}

/// The matrix a normal goes through, which is the inverse transpose of the one
/// a position goes through. A singular matrix has no inverse, and a node scaled
/// flat to nothing is the only way to get one, so its normals are left as they
/// are rather than turned into infinities.
fn inverse_transpose(m: &[f32; 9]) -> [f32; 9] {
    let det = determinant(m);
    if det.abs() < f32::EPSILON {
        return *m;
    }
    let inv = 1.0 / det;
    // The adjugate, transposed back, is the inverse transpose in one step: this
    // is the cofactor matrix scaled by 1/det.
    [
        (m[4] * m[8] - m[5] * m[7]) * inv,
        (m[5] * m[6] - m[3] * m[8]) * inv,
        (m[3] * m[7] - m[4] * m[6]) * inv,
        (m[2] * m[7] - m[1] * m[8]) * inv,
        (m[0] * m[8] - m[2] * m[6]) * inv,
        (m[1] * m[6] - m[0] * m[7]) * inv,
        (m[1] * m[5] - m[2] * m[4]) * inv,
        (m[2] * m[3] - m[0] * m[5]) * inv,
        (m[0] * m[4] - m[1] * m[3]) * inv,
    ]
}

fn normalise(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if length > 0.0 {
        [v[0] / length, v[1] / length, v[2] / length]
    } else {
        v
    }
}

/// Pack a finished walk into the gzipped sidecar.
fn finish(root: ImportPiece, state: Walk) -> Result<Imported, String> {
    let mut blob = Vec::with_capacity(
        BLOB_HEADER_SIZE + state.vertices.len() * 4 + state.indices.len() * 4 + 64,
    );
    let directory = serde_json::to_vec(&state.directory)
        .map_err(|e| format!("could not index the model: {e}"))?;

    let vertex_offset = BLOB_HEADER_SIZE;
    let vertex_bytes = state.vertices.len() * 4;
    let index_offset = vertex_offset + vertex_bytes;
    let index_bytes = state.indices.len() * 4;
    let directory_offset = index_offset + index_bytes;

    blob.extend_from_slice(BLOB_MAGIC);
    for value in [
        BLOB_VERSION,
        state.directory.len() as u32,
        vertex_offset as u32,
        vertex_bytes as u32,
        index_offset as u32,
        index_bytes as u32,
        directory_offset as u32,
        directory.len() as u32,
    ] {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    for value in &state.vertices {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    for value in &state.indices {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    blob.extend_from_slice(&directory);

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&blob)
        .and_then(|()| encoder.finish())
        .map(|packed| Imported {
            root,
            blob: packed,
            meshes: state.directory.len(),
            vertices: state.vertices.len() / FLOATS_PER_VERTEX,
            triangles: state.indices.len() / 3,
            converted: state.converted,
            palette_faces: state.palette_faces,
            missing_textures: state.missing.into_iter().collect(),
            dropped_pieces: state.dropped_pieces,
        })
        .map_err(|e| format!("could not pack the geometry: {e}"))
}

#[derive(Default)]
struct Walk {
    vertices: Vec<f32>,
    indices: Vec<u32>,
    directory: Vec<MeshEntry>,
    converted: usize,
    next: usize,
    palette_faces: usize,
    missing: BTreeSet<String>,
    dropped_pieces: usize,
}

fn walk(piece: &coilbox_s3o::Piece, state: &mut Walk) -> ImportPiece {
    let id = format!("m{}", state.next);
    state.next += 1;

    let indices = piece.triangles();
    let mesh_id = if indices.is_empty() || piece.vertices.is_empty() {
        None
    } else {
        if piece.primitive_type != coilbox_s3o::PrimitiveType::Triangles {
            state.converted += 1;
        }
        let v_first = state.vertices.len() / FLOATS_PER_VERTEX;
        let i_first = state.indices.len();
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for vertex in &piece.vertices {
            for axis in 0..3 {
                min[axis] = min[axis].min(vertex.pos[axis]);
                max[axis] = max[axis].max(vertex.pos[axis]);
            }
            state.vertices.extend_from_slice(&vertex.pos);
            state.vertices.extend_from_slice(&vertex.normal);
            state.vertices.extend_from_slice(&vertex.uv);
        }
        state.indices.extend_from_slice(&indices);
        state.directory.push(MeshEntry {
            id: id.clone(),
            v_first,
            v_count: piece.vertices.len(),
            i_first,
            i_count: indices.len(),
            bbox: Bbox { min, max },
        });
        Some(id)
    };

    ImportPiece {
        name: piece.name.clone(),
        offset: piece.offset,
        mesh_id,
        children: piece.children.iter().map(|c| walk(c, state)).collect(),
    }
}

/// Where each of a `.3do`'s tiles ended up on the packed sheet.
pub type Rects = BTreeMap<String, crate::atlas3do::Rect>;

/// The corners a `.3do` face takes on its tile.
///
/// The format stores no texture coordinates at all: a face is stretched over
/// the whole of the tile it names. Faces with more than four corners wrap,
/// which is what the engine's own quad-oriented mapping does.
const CORNER_UV: [[f32; 2]; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];

/// Flatten one `.3do` piece into a single mesh.
///
/// Every corner of every face becomes its own vertex. It has to: the format
/// shares a vertex between faces that name different tiles, and a shared vertex
/// can only carry one texture coordinate.
fn walk_3do(piece: &coilbox_3do::Piece, rects: &Rects, state: &mut Walk) -> ImportPiece {
    let id = format!("m{}", state.next);
    state.next += 1;

    let v_first = state.vertices.len() / FLOATS_PER_VERTEX;
    let i_first = state.indices.len();
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    let mut vertices = 0usize;

    for prim in &piece.primitives {
        let rect = match &prim.texture {
            // A name that is present but empty resolves to nothing, so it is
            // the flat-colour case in everything but how the file stores it.
            coilbox_3do::Texture::Name(name) if !name.is_empty() => {
                match rects.get(name.as_str()) {
                    Some(rect) => *rect,
                    None => {
                        state.missing.insert(name.clone());
                        state.palette_faces += 1;
                        rects[crate::atlas3do::PALETTE_TILE]
                    }
                }
            }
            // A resolved entry got its own tile, coloured from
            // `palette.pal`, under this same name, before packing (see
            // `lib.rs`'s `palette_tiles`). One nothing could resolve, because
            // there was no palette beside the model or the entry named is
            // outside the 256 it holds, falls back to the fallback tile.
            coilbox_3do::Texture::Palette(entry) => {
                match rects.get(&crate::atlas3do::palette_tile_name(*entry)) {
                    Some(rect) => *rect,
                    None => {
                        state.palette_faces += 1;
                        rects[crate::atlas3do::PALETTE_TILE]
                    }
                }
            }
            _ => {
                state.palette_faces += 1;
                rects[crate::atlas3do::PALETTE_TILE]
            }
        };

        let base = vertices as u32;
        for (corner, &index) in prim.indices.iter().enumerate() {
            let Some(pos) = piece.vertices.get(index as usize).copied() else {
                continue;
            };
            let normal = prim
                .vertex_normals
                .get(corner)
                .copied()
                .unwrap_or(prim.normal);
            let [u, v] = CORNER_UV[corner % 4];
            for axis in 0..3 {
                min[axis] = min[axis].min(pos[axis]);
                max[axis] = max[axis].max(pos[axis]);
            }
            state.vertices.extend_from_slice(&pos);
            state.vertices.extend_from_slice(&normal);
            state.vertices.extend_from_slice(&rect.at(u, v));
            vertices += 1;
        }
        // A face of any corner count is a fan around its first corner. The
        // reader has already dropped everything with fewer than three.
        //
        // Wound backwards, because the engine derives a `.3do` face normal as
        // the negative of the usual right-handed cross product. Winding the fan
        // forwards would make the side the normals point at the back face, and
        // every lit face would come out dark.
        for i in 1..prim.indices.len().saturating_sub(1) {
            state
                .indices
                .extend_from_slice(&[base, base + i as u32 + 1, base + i as u32]);
        }
    }

    let mesh_id = if vertices == 0 {
        None
    } else {
        state.directory.push(MeshEntry {
            id: id.clone(),
            v_first,
            v_count: vertices,
            i_first,
            i_count: state.indices.len() - i_first,
            bbox: Bbox { min, max },
        });
        Some(id)
    };

    ImportPiece {
        name: piece.name.clone(),
        offset: piece.offset,
        mesh_id,
        children: piece
            .children
            .iter()
            .enumerate()
            .filter_map(|(i, child)| {
                if is_dead_duplicate(child, &piece.children[..i]) {
                    state.dropped_pieces += 1;
                    None
                } else {
                    Some(walk_3do(child, rects, state))
                }
            })
            .collect(),
    }
}

/// Whether `candidate` is an inert duplicate of one of the sibling pieces
/// that came before it in the file.
///
/// The comparison is the piece's name, not its position or vertex data. Real
/// `.3do`s reuse identical geometry deliberately: a unit's script shows one of
/// two same-shaped pieces at a time to fake a flicker (BA's `cortitan` and
/// `corhurc` both carry a `thrusta1`/`thrusta2` pair this way), or gives one
/// point two jobs under two names (`armatl`'s `flare`/`bubbles` share a
/// position because the same point serves as both a muzzle flash and an
/// underwater trail origin). Both are exact copies of a sibling by position
/// and vertices, and both are pieces the model still needs. Dropping either
/// would be exactly the "removing real geometry" mistake this pass exists to
/// avoid.
///
/// A repeated *name* is different: `S3DModel::FindPiece` in the engine's
/// `3DModel.cpp` resolves a piece name to the first match in file order, so a
/// later sibling sharing an earlier one's name can never be the one a unit
/// script or weapon definition reaches by that name. Nothing that depends on
/// addressing it by name could ever have worked, so removing it changes
/// nothing the engine could have shown anybody.
///
/// That is also why the candidate must draw nothing (`primitives` empty) and
/// root nothing (`children` empty) before it is dropped: a same-named piece
/// that has faces of its own still renders them, because rendering walks the
/// tree rather than looking pieces up by name, and a same-named piece with
/// children would take its whole subtree with it. `.3do` piece names are
/// lower-cased on read, so the comparison needs no further normalising.
///
/// Measured against the `.3do`s in Balanced Annihilation v15.9.8, Basically
/// OTA 1.7 beta 10.1 and XTA 9.65 (2,042 files, 12,306 pieces): 14 sibling
/// pairs share identical position and vertex data, and every one of them is a
/// legitimate reuse like the two above, not junk. Exactly 2 pieces, in
/// `ARM_T1_HOV_Constructor.3do` and its XTA equivalent, share a name with an
/// empty, childless earlier sibling (both called `beam`, under `nanogun`) and
/// are caught by this rule.
fn is_dead_duplicate(
    candidate: &coilbox_3do::Piece,
    earlier_siblings: &[coilbox_3do::Piece],
) -> bool {
    candidate.children.is_empty()
        && candidate.primitives.is_empty()
        && earlier_siblings
            .iter()
            .any(|sibling| sibling.name == candidate.name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;
    use std::io::Read;

    fn vertex(x: f32) -> coilbox_s3o::Vertex {
        coilbox_s3o::Vertex {
            pos: [x, x * 2.0, x * 3.0],
            normal: [0.0, 1.0, 0.0],
            uv: [x, 1.0 - x],
        }
    }

    fn piece(
        name: &str,
        vertices: Vec<coilbox_s3o::Vertex>,
        indices: Vec<u32>,
    ) -> coilbox_s3o::Piece {
        coilbox_s3o::Piece {
            name: name.to_string(),
            primitive_type: coilbox_s3o::PrimitiveType::Triangles,
            offset: [1.0, 2.0, 3.0],
            vertices,
            indices,
            children: Vec::new(),
        }
    }

    fn model(root: coilbox_s3o::Piece) -> coilbox_s3o::Model {
        coilbox_s3o::Model {
            radius: 1.0,
            height: 1.0,
            mid: [0.0; 3],
            texture1: "a.dds".into(),
            texture2: String::new(),
            root,
        }
    }

    fn inflate(packed: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        GzDecoder::new(packed)
            .read_to_end(&mut out)
            .expect("inflate");
        out
    }

    fn u32_at(blob: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(blob[at..at + 4].try_into().expect("four bytes"))
    }

    fn f32_at(blob: &[u8], at: usize) -> f32 {
        f32::from_le_bytes(blob[at..at + 4].try_into().expect("four bytes"))
    }

    #[test]
    fn the_blob_carries_the_header_the_frontend_reads() {
        let out = import(&model(piece(
            "body",
            vec![vertex(0.0), vertex(0.5), vertex(1.0)],
            vec![0, 1, 2],
        )))
        .expect("import");
        let blob = inflate(&out.blob);

        assert_eq!(&blob[0..8], BLOB_MAGIC);
        assert_eq!(u32_at(&blob, 8), BLOB_VERSION);
        assert_eq!(u32_at(&blob, 12), 1);
        assert_eq!(u32_at(&blob, 16) as usize, BLOB_HEADER_SIZE);
        assert_eq!(u32_at(&blob, 20), (3 * FLOATS_PER_VERTEX * 4) as u32);
        assert_eq!(u32_at(&blob, 28), 3 * 4);
        // The directory sits after both blocks and is the rest of the file.
        let at = u32_at(&blob, 32) as usize;
        assert_eq!(at + u32_at(&blob, 36) as usize, blob.len());
        assert!(String::from_utf8_lossy(&blob[at..]).contains("\"vCount\":3"));
    }

    #[test]
    fn a_piece_with_no_geometry_gets_no_mesh() {
        let mut root = piece("base", Vec::new(), Vec::new());
        root.children.push(piece(
            "body",
            vec![vertex(0.0), vertex(0.5), vertex(1.0)],
            vec![0, 1, 2],
        ));
        let out = import(&model(root)).expect("import");

        assert_eq!(out.root.mesh_id, None);
        assert_eq!(out.root.children[0].mesh_id.as_deref(), Some("m1"));
        assert_eq!(out.meshes, 1);
        assert_eq!(out.vertices, 3);
        assert_eq!(out.triangles, 1);
    }

    #[test]
    fn quads_are_converted_and_counted() {
        let mut root = piece(
            "body",
            vec![vertex(0.0), vertex(0.3), vertex(0.6), vertex(1.0)],
            vec![0, 1, 2, 3],
        );
        root.primitive_type = coilbox_s3o::PrimitiveType::Quads;
        let out = import(&model(root)).expect("import");

        assert_eq!(out.converted, 1);
        assert_eq!(out.triangles, 2);
    }

    #[test]
    fn a_mesh_carries_the_box_around_its_own_vertices() {
        let out = import(&model(piece(
            "body",
            vec![vertex(0.0), vertex(0.5), vertex(1.0)],
            vec![0, 1, 2],
        )))
        .expect("import");
        let blob = inflate(&out.blob);
        let at = u32_at(&blob, 32) as usize;
        let directory = String::from_utf8_lossy(&blob[at..]).to_string();

        assert!(
            directory.contains("\"min\":[0.0,0.0,0.0]"),
            "got: {directory}"
        );
        assert!(
            directory.contains("\"max\":[1.0,2.0,3.0]"),
            "got: {directory}"
        );
    }

    // ------------------------------------------------------------- glb

    mod binary_gltf {
        use super::*;
        use crate::glb;

        fn mesh() -> glb::Mesh {
            glb::Mesh {
                positions: vec![[1.0, 2.0, 3.0], [0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
                normals: vec![[0.0, 1.0, 0.0]; 3],
                uvs: vec![[0.0, 0.0]; 3],
                indices: vec![0, 1, 2],
            }
        }

        fn node(name: &str, matrix: [f32; 16], mesh: Option<glb::Mesh>) -> glb::Node {
            glb::Node {
                name: name.to_string(),
                matrix,
                mesh,
                children: Vec::new(),
            }
        }

        fn model(root: glb::Node) -> glb::Model {
            glb::Model {
                root,
                image: None,
                missing_image: None,
                skipped: 0,
                converted: 0,
                flat_shaded: 0,
                images_used: 0,
                invented_root: false,
            }
        }

        /// A matrix that scales then translates, column-major the way glTF and
        /// this both store one.
        fn scale_and_move(scale: [f32; 3], at: [f32; 3]) -> [f32; 16] {
            [
                scale[0], 0.0, 0.0, 0.0, //
                0.0, scale[1], 0.0, 0.0, //
                0.0, 0.0, scale[2], 0.0, //
                at[0], at[1], at[2], 1.0,
            ]
        }

        /// The vertex block, three positions then three normals then two UVs
        /// per vertex, as the frontend reads it.
        fn vertex(blob: &[u8], index: usize, component: usize) -> f32 {
            f32_at(
                blob,
                BLOB_HEADER_SIZE + (index * FLOATS_PER_VERTEX + component) * 4,
            )
        }

        /// The whole point of the bake: an `.s3o` piece holds a translation and
        /// nothing else, so a node's scale has to end up in its vertices while
        /// its translation stays an offset.
        #[test]
        fn bakes_a_nodes_scale_into_its_vertices_and_keeps_its_translation() {
            let out = import_glb(&model(node(
                "body",
                scale_and_move([2.0, 2.0, 2.0], [10.0, 0.0, 0.0]),
                Some(mesh()),
            )))
            .expect("import");
            let blob = inflate(&out.blob);

            assert_eq!(out.root.offset, [10.0, 0.0, 0.0]);
            assert_eq!(
                [
                    vertex(&blob, 0, 0),
                    vertex(&blob, 0, 1),
                    vertex(&blob, 0, 2)
                ],
                [2.0, 4.0, 6.0]
            );
        }

        /// A child's offset is from its parent, and the parent's own transform
        /// is what its children sit inside. Getting this wrong puts every piece
        /// of a rotated subtree somewhere else.
        #[test]
        fn measures_a_childs_offset_inside_its_turned_parent() {
            // Half a turn about y, which is a rotation this can write out by
            // hand and check without trusting a quaternion.
            let half_turn = [
                -1.0, 0.0, 0.0, 0.0, //
                0.0, 1.0, 0.0, 0.0, //
                0.0, 0.0, -1.0, 0.0, //
                10.0, 0.0, 0.0, 1.0,
            ];
            let mut root = node("base", half_turn, None);
            root.children.push(node(
                "barrel",
                scale_and_move([1.0; 3], [0.0, 0.0, 4.0]),
                Some(mesh()),
            ));
            let out = import_glb(&model(root)).expect("import");

            assert_eq!(out.root.offset, [10.0, 0.0, 0.0]);
            assert_eq!(out.root.mesh_id, None);
            // The child sits four along its parent's z, and its parent faces
            // the other way, so it lands four back along the world's.
            assert_eq!(out.root.children[0].offset, [0.0, 0.0, -4.0]);
        }

        /// A mirroring transform turns every triangle inside out. Without the
        /// flip the piece is drawn back to front and lit from inside, which is
        /// the failure that looks fine in a viewport and wrong in the game.
        #[test]
        fn reverses_the_winding_under_a_mirroring_scale() {
            let out = import_glb(&model(node(
                "body",
                scale_and_move([-1.0, 1.0, 1.0], [0.0; 3]),
                Some(mesh()),
            )))
            .expect("import");
            let blob = inflate(&out.blob);
            let at = u32_at(&blob, 24) as usize;
            let indices: Vec<u32> = (0..3).map(|i| u32_at(&blob, at + i * 4)).collect();

            assert_eq!(indices, vec![0, 2, 1]);
        }

        /// A normal goes through the inverse transpose, not the matrix itself.
        /// Applied directly, a non-uniform scale skews it and the piece lights
        /// wrongly everywhere it is not flat.
        #[test]
        fn sends_a_normal_through_the_inverse_transpose() {
            let mut mesh = mesh();
            mesh.normals = vec![[1.0, 1.0, 0.0]; 3];
            let out = import_glb(&model(node(
                "body",
                scale_and_move([2.0, 1.0, 1.0], [0.0; 3]),
                Some(mesh),
            )))
            .expect("import");
            let blob = inflate(&out.blob);

            // Halved along x by the inverse, then renormalised: (0.5, 1, 0)
            // over its own length. Applying the matrix itself would have
            // doubled x instead, giving 0.894 and 0.447.
            let length: f32 = (0.25f32 + 1.0).sqrt();
            assert!((vertex(&blob, 0, 3) - 0.5 / length).abs() < 1e-6);
            assert!((vertex(&blob, 0, 4) - 1.0 / length).abs() < 1e-6);
        }

        /// A mesh under an untransformed node is copied rather than recomputed,
        /// the same call `bakeGeometry` makes: renormalising a normal that is
        /// not quite unit length changes bytes for no reason.
        #[test]
        fn copies_an_untransformed_mesh_verbatim() {
            let mut mesh = mesh();
            mesh.normals = vec![[0.0, 0.5, 0.0]; 3];
            let out = import_glb(&model(node("body", glb::IDENTITY, Some(mesh)))).expect("import");
            let blob = inflate(&out.blob);

            assert_eq!(vertex(&blob, 0, 4), 0.5);
        }

        /// The end to end shape: a real container comes out as the same blob
        /// and tree an `.s3o` import produces, so nothing downstream has to
        /// know which format the unit came in through.
        #[test]
        fn a_read_file_produces_the_same_blob_an_s3o_import_does() {
            let model = glb::read(
                &crate::glb::tests::two_pieces(),
                std::path::Path::new("/tmp/unit.glb"),
            )
            .expect("read");
            let out = import_glb(&model).expect("import");
            let blob = inflate(&out.blob);

            assert_eq!(&blob[0..8], BLOB_MAGIC);
            assert_eq!(u32_at(&blob, 8), BLOB_VERSION);
            assert_eq!(out.meshes, 1);
            assert_eq!(out.triangles, 1);
            assert_eq!(out.root.name, "base");
            assert_eq!(out.root.mesh_id, None);
            assert_eq!(out.root.children[0].mesh_id.as_deref(), Some("m1"));
            assert_eq!(out.root.children[0].offset, [1.0, 2.0, 3.0]);
        }
    }

    // ------------------------------------------------------------- 3do

    mod three_do {
        use super::*;
        use crate::atlas3do::{self, Rect};

        fn rects() -> Rects {
            let mut out = Rects::new();
            out.insert(
                "arm2".into(),
                Rect {
                    u0: 0.0,
                    v0: 0.0,
                    u1: 0.5,
                    v1: 0.5,
                },
            );
            out.insert(
                atlas3do::PALETTE_TILE.into(),
                Rect {
                    u0: 0.5,
                    v0: 0.5,
                    u1: 1.0,
                    v1: 1.0,
                },
            );
            out
        }

        fn face(indices: Vec<u32>, texture: coilbox_3do::Texture) -> coilbox_3do::Primitive {
            let normals = vec![[0.0, 1.0, 0.0]; indices.len()];
            coilbox_3do::Primitive {
                indices,
                texture,
                normal: [0.0, 1.0, 0.0],
                vertex_normals: normals,
            }
        }

        fn piece3(name: &str, primitives: Vec<coilbox_3do::Primitive>) -> coilbox_3do::Piece {
            coilbox_3do::Piece {
                name: name.to_string(),
                offset: [1.0, 2.0, 3.0],
                vertices: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [1.0, 0.0, 1.0],
                    [0.0, 0.0, 1.0],
                ],
                primitives,
                children: Vec::new(),
            }
        }

        fn model3(root: coilbox_3do::Piece) -> coilbox_3do::Model {
            coilbox_3do::Model {
                radius: 1.0,
                height: 2.0,
                mid: [0.0, 1.0, 0.0],
                root,
            }
        }

        fn textured(indices: Vec<u32>) -> coilbox_3do::Primitive {
            face(indices, coilbox_3do::Texture::Name("arm2".into()))
        }

        #[test]
        fn turns_a_face_into_triangles() {
            let out = import_3do(
                &model3(piece3("body", vec![textured(vec![0, 1, 2])])),
                &rects(),
            )
            .expect("import");

            assert_eq!(out.triangles, 1);
            assert_eq!(out.vertices, 3);
        }

        /// A quad is a fan around its first corner, the same as any other face.
        #[test]
        fn turns_a_four_cornered_face_into_two_triangles() {
            let out = import_3do(
                &model3(piece3("body", vec![textured(vec![0, 1, 2, 3])])),
                &rects(),
            )
            .expect("import");

            assert_eq!(out.triangles, 2);
        }

        /// The format shares a vertex between faces naming different tiles, and
        /// a shared vertex can only carry one texture coordinate. So every
        /// corner becomes its own vertex, even where the positions repeat.
        #[test]
        fn gives_every_corner_its_own_vertex() {
            let out = import_3do(
                &model3(piece3(
                    "body",
                    vec![textured(vec![0, 1, 2]), textured(vec![0, 2, 3])],
                )),
                &rects(),
            )
            .expect("import");

            assert_eq!(out.vertices, 6);
        }

        /// The whole point of the conversion: a face stretched over a tile
        /// comes out with real coordinates onto the packed sheet.
        #[test]
        fn maps_a_faces_corners_onto_its_tile() {
            let out = import_3do(
                &model3(piece3("body", vec![textured(vec![0, 1, 2, 3])])),
                &rects(),
            )
            .expect("import");
            let blob = inflate(&out.blob);

            let uvs: Vec<[f32; 2]> = (0..4)
                .map(|i| {
                    let at = BLOB_HEADER_SIZE + i * FLOATS_PER_VERTEX * 4 + 24;
                    [f32_at(&blob, at), f32_at(&blob, at + 4)]
                })
                .collect();
            assert_eq!(uvs, vec![[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]);
        }

        /// A palette entry `rects` holds no tile for, because the caller found
        /// no `palette.pal` beside the model or the entry is outside the 256
        /// it holds, is drawn plain and counted, the same as a named texture
        /// nothing on disk matched.
        #[test]
        fn draws_an_unresolved_palette_face_plain_and_counts_it() {
            let out = import_3do(
                &model3(piece3(
                    "body",
                    vec![face(vec![0, 1, 2], coilbox_3do::Texture::Palette(3))],
                )),
                &rects(),
            )
            .expect("import");

            assert_eq!(out.palette_faces, 1);
            assert_eq!(out.triangles, 1);
        }

        /// The specimen this exists for: a palette entry the caller did
        /// resolve to a colour gets its own tile under `rects`, drawn like any
        /// other texture and not counted as a face that came out plain.
        #[test]
        fn draws_a_resolved_palette_face_in_its_own_tile() {
            let mut rects = rects();
            rects.insert(
                atlas3do::palette_tile_name(3),
                Rect {
                    u0: 0.25,
                    v0: 0.25,
                    u1: 0.75,
                    v1: 0.75,
                },
            );
            let out = import_3do(
                &model3(piece3(
                    "body",
                    vec![face(vec![0, 1, 2, 3], coilbox_3do::Texture::Palette(3))],
                )),
                &rects,
            )
            .expect("import");

            assert_eq!(out.palette_faces, 0);
            let blob = inflate(&out.blob);
            let at = BLOB_HEADER_SIZE + FLOATS_PER_VERTEX * 4 + 24;
            assert_eq!([f32_at(&blob, at), f32_at(&blob, at + 4)], [0.75, 0.25]);
        }

        /// Naming which tile is missing is the only way anybody works out what
        /// went wrong, and the rest of the unit still imports.
        #[test]
        fn names_a_tile_nothing_on_disk_matched() {
            let out = import_3do(
                &model3(piece3(
                    "body",
                    vec![face(
                        vec![0, 1, 2],
                        coilbox_3do::Texture::Name("nosuchtile".into()),
                    )],
                )),
                &rects(),
            )
            .expect("import");

            assert_eq!(out.missing_textures, vec!["nosuchtile".to_string()]);
            assert_eq!(out.triangles, 1);
        }

        /// A piece with one or two vertices and no faces is a flare or an aim
        /// point, and the format carries all of them this way.
        #[test]
        fn leaves_a_piece_with_no_faces_without_a_mesh() {
            let mut root = piece3("base", Vec::new());
            root.children
                .push(piece3("body", vec![textured(vec![0, 1, 2])]));
            let out = import_3do(&model3(root), &rects()).expect("import");

            assert_eq!(out.root.mesh_id, None);
            assert_eq!(out.root.children[0].mesh_id.as_deref(), Some("m1"));
            assert_eq!(out.meshes, 1);
        }

        /// The real specimen this rule was written for: `ARM_T1_HOV_Constructor`
        /// (Basically OTA) and its XTA equivalent both carry a `nanogun` piece
        /// with two empty children both called `beam`. The engine can only ever
        /// reach the first by that name, so the second is inert clutter.
        #[test]
        fn drops_a_later_sibling_that_shares_an_earlier_ones_name() {
            let mut root = piece3("nanogun", Vec::new());
            root.children.push(piece3("beam", Vec::new()));
            root.children.push(piece3("beam", Vec::new()));
            let out = import_3do(&model3(root), &rects()).expect("import");

            assert_eq!(out.root.children.len(), 1);
            assert_eq!(out.dropped_pieces, 1);
        }

        /// A same-named piece that still has faces of its own is not dropped:
        /// removing it would remove geometry the tree walk still renders, since
        /// rendering does not go by name.
        #[test]
        fn keeps_a_same_named_sibling_that_has_faces() {
            let mut root = piece3("base", Vec::new());
            root.children
                .push(piece3("flare", vec![textured(vec![0, 1, 2])]));
            root.children
                .push(piece3("flare", vec![textured(vec![0, 1, 2])]));
            let out = import_3do(&model3(root), &rects()).expect("import");

            assert_eq!(out.root.children.len(), 2);
            assert_eq!(out.dropped_pieces, 0);
        }

        /// A same-named piece that roots children is not dropped: dropping it
        /// would take its whole subtree with it.
        #[test]
        fn keeps_a_same_named_sibling_that_has_children() {
            let mut root = piece3("base", Vec::new());
            let mut has_child = piece3("mount", Vec::new());
            has_child.children.push(piece3("barrel", Vec::new()));
            root.children.push(piece3("mount", Vec::new()));
            root.children.push(has_child);
            let out = import_3do(&model3(root), &rects()).expect("import");

            assert_eq!(out.root.children.len(), 2);
            assert_eq!(out.dropped_pieces, 0);
        }

        /// Identical position and vertex data under two different names is not
        /// junk: BA's `cortitan` and `corhurc` both toggle a `thrusta1`/
        /// `thrusta2` pair to fake a flicker, and `armatl` gives one point two
        /// jobs as `flare` and `bubbles`. Neither is reachable-but-shadowed the
        /// way a same-named duplicate is, so both are kept.
        #[test]
        fn keeps_distinctly_named_siblings_with_identical_geometry() {
            let mut root = piece3("base", Vec::new());
            root.children.push(piece3("thrusta1", Vec::new()));
            root.children.push(piece3("thrusta2", Vec::new()));
            let out = import_3do(&model3(root), &rects()).expect("import");

            assert_eq!(out.root.children.len(), 2);
            assert_eq!(out.dropped_pieces, 0);
        }
    }
}
