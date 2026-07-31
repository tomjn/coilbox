//! Reader and writer for the Spring/Recoil `.s3o` model format.
//!
//! Field layout is taken from `rts/Rendering/Models/s3o.h` in RecoilEngine and
//! cross-checked against shipped models. `docs/s3o-format.md` records the
//! conventions the engine relies on but does not state in the struct: vertex
//! positions are used verbatim with no axis negation, front faces wind
//! counter-clockwise, and a `Triangles` piece has a flat index list with no
//! end-of-primitive markers.
//!
//! Everything is little endian. The engine byte-swaps on big-endian hosts, so
//! files themselves are always little endian.

mod read;
mod write;

pub use read::{read, Error};
pub use write::{write, WriteError};

/// Leading bytes of every `.s3o` file, including the terminating NUL.
pub const MAGIC: &[u8; 12] = b"Spring unit\0";

/// Only version the engine accepts.
pub const VERSION: i32 = 0;

pub const HEADER_SIZE: usize = 52;
pub const PIECE_SIZE: usize = 52;
pub const VERTEX_SIZE: usize = 32;

/// How a piece's index list is interpreted.
///
/// The engine converts strips and quads to triangles on load, so writing
/// `Triangles` is always safe and is what the builder emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrimitiveType {
    Triangles,
    TriangleStrip,
    Quads,
}

impl PrimitiveType {
    fn from_raw(raw: u32) -> Option<Self> {
        match raw {
            0 => Some(Self::Triangles),
            1 => Some(Self::TriangleStrip),
            2 => Some(Self::Quads),
            _ => None,
        }
    }

    fn to_raw(self) -> u32 {
        match self {
            Self::Triangles => 0,
            Self::TriangleStrip => 1,
            Self::Quads => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vertex {
    /// Position relative to the piece origin.
    pub pos: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
}

#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// Lower case by convention: unit scripts address pieces by this name.
    pub name: String,
    pub primitive_type: PrimitiveType,
    /// Translation from the parent piece. The format has no rotation or scale,
    /// so an exporter must bake those into `vertices`.
    pub offset: [f32; 3],
    /// Empty for a piece that only marks a point, such as a flare or aim point.
    pub vertices: Vec<Vertex>,
    /// Indices into this piece's own `vertices`.
    pub indices: Vec<u32>,
    pub children: Vec<Piece>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    /// Collision sphere radius. The engine computes its own when this is
    /// `<= 0.01`, which is a deliberate way to defer to it.
    pub radius: f32,
    /// Total height. Same `<= 0.01` rule as `radius`.
    pub height: f32,
    /// Offset from the origin, which sits on the ground plane, to the middle of
    /// the collision sphere.
    pub mid: [f32; 3],
    pub texture1: String,
    pub texture2: String,
    pub root: Piece,
}

impl Piece {
    /// Depth-first pre-order walk, the order pieces are written in.
    pub fn walk(&self) -> Vec<&Piece> {
        let mut out = Vec::new();
        let mut stack = vec![self];
        while let Some(piece) = stack.pop() {
            out.push(piece);
            for child in piece.children.iter().rev() {
                stack.push(child);
            }
        }
        out
    }

    /// This piece's index list as triangles, whichever primitive type it uses.
    ///
    /// The engine converts strips and quads on load, so anything that draws a
    /// shipped model has to do the same: 72 of the 124 third-party models
    /// checked are one or the other, and reading their index lists as triangles
    /// draws noise. An index past the end of `vertices` drops its whole
    /// primitive rather than the piece, which is what keeps one bad triangle in
    /// a shipped model from costing the piece it is in.
    pub fn triangles(&self) -> Vec<u32> {
        let valid = |i: &u32| (*i as usize) < self.vertices.len();
        match self.primitive_type {
            PrimitiveType::Triangles => self
                .indices
                .chunks_exact(3)
                .filter(|t| t.iter().all(valid))
                .flatten()
                .copied()
                .collect(),
            PrimitiveType::Quads => self
                .indices
                .chunks_exact(4)
                .filter(|q| q.iter().all(valid))
                .flat_map(|q| [q[0], q[1], q[2], q[0], q[2], q[3]])
                .collect(),
            PrimitiveType::TriangleStrip => {
                let mut out = Vec::new();
                for (i, w) in self.indices.windows(3).enumerate() {
                    // A strip turns a corner by repeating a vertex, which makes
                    // a triangle with no area. Dropping those is what stops the
                    // turn showing up as a spike.
                    if w[0] == w[1] || w[1] == w[2] || w[0] == w[2] {
                        continue;
                    }
                    if !w.iter().all(valid) {
                        continue;
                    }
                    // Every other triangle in a strip is wound the other way.
                    if i % 2 == 0 {
                        out.extend_from_slice(&[w[0], w[1], w[2]]);
                    } else {
                        out.extend_from_slice(&[w[0], w[2], w[1]]);
                    }
                }
                out
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(primitive_type: PrimitiveType, vertices: usize, indices: &[u32]) -> Piece {
        Piece {
            name: "p".to_string(),
            primitive_type,
            offset: [0.0; 3],
            vertices: vec![
                Vertex {
                    pos: [0.0; 3],
                    normal: [0.0; 3],
                    uv: [0.0; 2],
                };
                vertices
            ],
            indices: indices.to_vec(),
            children: Vec::new(),
        }
    }

    #[test]
    fn triangles_pass_through_and_a_ragged_tail_is_dropped() {
        let p = piece(PrimitiveType::Triangles, 4, &[0, 1, 2, 3]);
        assert_eq!(p.triangles(), vec![0, 1, 2]);
    }

    #[test]
    fn a_quad_becomes_two_triangles_sharing_a_diagonal() {
        let p = piece(PrimitiveType::Quads, 4, &[0, 1, 2, 3]);
        assert_eq!(p.triangles(), vec![0, 1, 2, 0, 2, 3]);
    }

    #[test]
    fn a_strip_alternates_winding_and_drops_degenerate_turns() {
        let p = piece(PrimitiveType::TriangleStrip, 6, &[0, 1, 2, 3, 3, 4, 5]);
        assert_eq!(p.triangles(), vec![0, 1, 2, 1, 3, 2, 3, 4, 5]);
        // A strip that only ever turns a corner has no area anywhere in it.
        let flat = piece(PrimitiveType::TriangleStrip, 3, &[0, 1, 1, 2]);
        assert_eq!(flat.triangles(), Vec::<u32>::new());
    }

    #[test]
    fn an_index_past_the_end_drops_only_its_own_primitive() {
        let p = piece(PrimitiveType::Triangles, 3, &[0, 1, 2, 0, 1, 9]);
        assert_eq!(p.triangles(), vec![0, 1, 2]);
    }
}
