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

/// What to report a [`Texture::Name`] as when the string it carries is empty.
///
/// An empty name is not "no name": `S3DOPiece::GetTexture`
/// (`rts/Rendering/Models/3DOParser.cpp`) resolves it exactly like any other,
/// appending `00` unless the name is in the game's `teamtex.txt`, which it
/// never can be (`teamtex.txt` holds no blank lines), so it always becomes
/// this (issue #2610).
///
/// A resolver still needs the true empty string, not this constant, to
/// compute that suffix and to match a map a caller already built keyed by the
/// raw name: substituting `"00"` before resolving would look up `"0000"`
/// instead. Use this only where a name is about to be reported to a caller,
/// such as a texture list, a missing-texture report or an import summary,
/// after resolution has already run.
pub const EMPTY_TEXTURE_NAME: &str = "00";

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

/// The 256-entry Total Annihilation palette a [`Texture::Palette`] indexes
/// into: RGB per entry, in file order.
pub type Palette = [[u8; 3]; 256];

/// Parse `unittextures/tatex/palette.pal`'s bytes into the table
/// [`Texture::Palette`]'s index looks up.
///
/// `None` for anything shorter than 256 entries of 4 bytes, which is either not
/// this file or a truncated read. There is no partial answer worth giving back.
/// A file longer than that, which none of the games checked ship, is read for
/// its first 256 entries and no further.
///
/// Matches `CTAPalette::Init` (`rts/Rendering/Textures/TAPalette.cpp` in
/// RecoilEngine): four bytes an entry, and the fourth is discarded rather than
/// read as alpha (`CTAPalette::Init` overwrites it to 255 immediately after the
/// read). `C3DOTextureHandler::LoadTexFiles`
/// (`rts/Rendering/Textures/3DOTextureHandler.cpp`) then builds one dummy
/// texture an entry, `ta_color<N>`, from this table's RGB with alpha forced to
/// zero, so a palette face never takes the player's colour.
pub fn read_palette(bytes: &[u8]) -> Option<Palette> {
    if bytes.len() < 256 * 4 {
        return None;
    }
    let mut out = [[0u8; 3]; 256];
    let (chunks, _) = bytes.as_chunks::<4>();
    for (entry, chunk) in out.iter_mut().zip(chunks) {
        *entry = [chunk[0], chunk[1], chunk[2]];
    }
    Some(out)
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

#[cfg(test)]
mod palette_tests {
    use super::read_palette;

    /// Three whole entries: opaque red, a colour whose stored alpha is not 255,
    /// and black. The middle one is what proves the fourth byte is ignored
    /// rather than kept as alpha.
    fn bytes() -> Vec<u8> {
        let mut out = vec![0xff, 0, 0, 0xff];
        out.extend_from_slice(&[0, 0xff, 0, 0x42]);
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.resize(256 * 4, 0);
        out
    }

    #[test]
    fn reads_rgb_and_drops_the_stored_alpha_byte() {
        let palette = read_palette(&bytes()).expect("256 entries");

        assert_eq!(palette[0], [0xff, 0, 0]);
        assert_eq!(palette[1], [0, 0xff, 0]);
        assert_eq!(palette[2], [0, 0, 0]);
    }

    #[test]
    fn refuses_anything_shorter_than_256_entries() {
        assert_eq!(read_palette(&bytes()[..1023]), None);
        assert_eq!(read_palette(&[]), None);
    }

    #[test]
    fn reads_only_the_first_256_entries_of_a_longer_file() {
        let mut long = bytes();
        long.extend_from_slice(&[9, 9, 9, 9]);

        assert_eq!(read_palette(&long), read_palette(&bytes()));
    }
}
