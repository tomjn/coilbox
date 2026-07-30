//! Reader for `.3do`, the Total Annihilation model format Spring and Recoil
//! still load. Most units in Balanced Annihilation, Metal Factions, XTA and
//! Spring 1944 are `.3do`, so anything that shows a real game's models needs
//! this as well as the `coilbox-s3o` crate.
//!
//! Read only, and there will never be a writer: editing a `.3do` ends in saving
//! an `.s3o`, so the format only travels one way. That decides a design
//! question. Because nothing is ever written back, fidelity to the bytes buys
//! nothing, and fidelity to the model the engine draws buys everything. So this
//! mirrors `rts/Rendering/Models/3DOParser.cpp` including the faces it drops on
//! load, each marked below with the engine's reason.
//!
//! Field layout is taken from `3DOParser.h` and checked against the 3633 `.3do`
//! files in the games installed on the author's machine. `docs/3do-format.md`
//! records what the struct does not state.
//!
//! Everything is little endian, and every offset is absolute from the start of
//! the file.

mod read;

pub use read::{read, Error};

/// An object header: 13 `int32` fields.
pub const OBJECT_SIZE: usize = 52;

/// A primitive record: 8 `int32` fields.
pub const PRIMITIVE_SIZE: usize = 32;

/// The only version signature in any installed model. The engine reads the
/// field and ignores it, but a `.3do` has no magic number, so this is the only
/// thing that tells a `.3do` from a file that is not one.
pub const VERSION: i32 = 1;

/// File coordinates are integers in 1/65536ths of an engine unit.
pub const SCALE: f32 = 1.0 / 65536.0;

/// How a face is coloured.
///
/// Unlike `.s3o`, texturing is per face and there is no UV: a face is stretched
/// over the whole of its texture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Texture {
    /// The name as stored, lower cased, with no extension.
    ///
    /// The engine appends `00` unless the name appears in the game's
    /// `unittextures/tatex/teamtex.txt`, then looks it up in the atlas built
    /// from `unittextures/tatex/`. That needs the archive, which a reader given
    /// a byte slice does not have, so the name is left as the file has it.
    Name(String),
    /// A face with no texture name, drawn in a flat colour: entry `n` of the
    /// Total Annihilation palette, which the engine looks up as `ta_colorN`.
    Palette(i32),
}

/// One face. Triangles and quads are almost everything, and the installed
/// models also contain fans of up to 32 corners.
#[derive(Debug, Clone, PartialEq)]
pub struct Primitive {
    /// Indices into the owning piece's `vertices`.
    pub indices: Vec<u32>,
    pub texture: Texture,
    /// Face normal. Not in the file: the engine derives it, and every consumer
    /// would otherwise have to derive it the same way.
    pub normal: [f32; 3],
    /// One normal per entry in `indices`, smoothed across the faces that meet
    /// at that corner at less than about 63 degrees. This is per corner rather
    /// than per vertex because two faces sharing a vertex across a hard edge
    /// get different normals for it.
    pub vertex_normals: Vec<[f32; 3]>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Piece {
    /// Lower cased, as the engine does, because unit scripts address pieces by
    /// name and `.3do` tooling was inconsistent about case.
    pub name: String,
    /// Translation from the parent piece. There is no rotation or scale.
    pub offset: [f32; 3],
    /// Positions relative to the piece origin. A piece with one or two
    /// vertices and no faces is a point or a direction, such as a flare.
    pub vertices: Vec<[f32; 3]>,
    pub primitives: Vec<Primitive>,
    pub children: Vec<Piece>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    /// Radius of the sphere around the whole model, measured from `mid`. The
    /// file does not store one, so this is the engine's own figure: half the
    /// diagonal of the bounding box.
    pub radius: f32,
    /// Height of the bounding box.
    pub height: f32,
    /// Middle of the bounding box, relative to the origin, which sits on the
    /// ground plane.
    pub mid: [f32; 3],
    pub root: Piece,
}

impl Piece {
    /// Depth-first pre-order walk, the order the file stores pieces in.
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
