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
}
