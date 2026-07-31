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
}
