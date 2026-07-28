use std::collections::HashSet;
use std::fmt;

use crate::{
    Model, Piece, PrimitiveType, Vertex, HEADER_SIZE, MAGIC, PIECE_SIZE, VERSION, VERTEX_SIZE,
};

/// Guards against a piece tree deep enough to blow the stack. Real models are a
/// handful of levels, so anything past this is corrupt or hostile.
const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    TooShort {
        need: usize,
        got: usize,
    },
    BadMagic,
    BadVersion(i32),
    OutOfBounds {
        what: &'static str,
        offset: usize,
    },
    UnterminatedString(usize),
    BadPrimitiveType(u32),
    TooDeep,
    /// A piece offset appears twice, so the tree is not a tree.
    Cycle(usize),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort { need, got } => {
                write!(f, "file is {got} bytes, need at least {need}")
            }
            Self::BadMagic => write!(f, "not an s3o file: magic is not \"Spring unit\""),
            Self::BadVersion(v) => write!(f, "unsupported s3o version {v}, expected {VERSION}"),
            Self::OutOfBounds { what, offset } => {
                write!(f, "{what} at offset {offset} runs past the end of the file")
            }
            Self::UnterminatedString(offset) => {
                write!(f, "string at offset {offset} has no terminating NUL")
            }
            Self::BadPrimitiveType(raw) => {
                write!(f, "unknown primitive type {raw}, expected 0, 1 or 2")
            }
            Self::TooDeep => write!(f, "piece tree deeper than {MAX_DEPTH} levels"),
            Self::Cycle(offset) => write!(f, "piece at offset {offset} is referenced twice"),
        }
    }
}

impl std::error::Error for Error {}

/// Parse a `.s3o` file.
pub fn read(buf: &[u8]) -> Result<Model, Error> {
    if buf.len() < HEADER_SIZE {
        return Err(Error::TooShort {
            need: HEADER_SIZE,
            got: buf.len(),
        });
    }
    if &buf[..12] != MAGIC {
        return Err(Error::BadMagic);
    }

    let version = i32_at(buf, 12)?;
    if version != VERSION {
        return Err(Error::BadVersion(version));
    }

    let radius = f32_at(buf, 16)?;
    let height = f32_at(buf, 20)?;
    let mid = [f32_at(buf, 24)?, f32_at(buf, 28)?, f32_at(buf, 32)?];
    let root_offset = u32_at(buf, 36)? as usize;
    // 40 is collisionData, which the engine requires to be 0 and ignores.
    let texture1 = texture_at(buf, u32_at(buf, 44)? as usize)?;
    let texture2 = texture_at(buf, u32_at(buf, 48)? as usize)?;

    let mut seen = HashSet::new();
    let root = read_piece(buf, root_offset, 0, &mut seen)?;

    Ok(Model {
        radius,
        height,
        mid,
        texture1,
        texture2,
        root,
    })
}

fn read_piece(
    buf: &[u8],
    offset: usize,
    depth: usize,
    seen: &mut HashSet<usize>,
) -> Result<Piece, Error> {
    if depth >= MAX_DEPTH {
        return Err(Error::TooDeep);
    }
    if !seen.insert(offset) {
        return Err(Error::Cycle(offset));
    }
    if offset.saturating_add(PIECE_SIZE) > buf.len() {
        return Err(Error::OutOfBounds {
            what: "piece",
            offset,
        });
    }

    let name_offset = u32_at(buf, offset)? as usize;
    let num_children = u32_at(buf, offset + 4)? as usize;
    let children_offset = u32_at(buf, offset + 8)? as usize;
    let num_vertices = u32_at(buf, offset + 12)? as usize;
    let vertices_offset = u32_at(buf, offset + 16)? as usize;
    // 20 is vertexType, which is always 0.
    let raw_primitive = u32_at(buf, offset + 24)?;
    let num_indices = u32_at(buf, offset + 28)? as usize;
    let indices_offset = u32_at(buf, offset + 32)? as usize;
    // 36 is collisionData, which the engine requires to be 0 and ignores.
    let piece_offset = [
        f32_at(buf, offset + 40)?,
        f32_at(buf, offset + 44)?,
        f32_at(buf, offset + 48)?,
    ];

    let primitive_type =
        PrimitiveType::from_raw(raw_primitive).ok_or(Error::BadPrimitiveType(raw_primitive))?;

    // The engine only dereferences these pointers when the matching count is
    // non-zero, because s3o tools are known to leave stale offsets behind on
    // empty pieces. Match that, or valid files fail to load.
    let mut vertices = Vec::with_capacity(num_vertices);
    for i in 0..num_vertices {
        let at = vertices_offset + i * VERTEX_SIZE;
        if at.saturating_add(VERTEX_SIZE) > buf.len() {
            return Err(Error::OutOfBounds {
                what: "vertex",
                offset: at,
            });
        }
        vertices.push(Vertex {
            pos: [f32_at(buf, at)?, f32_at(buf, at + 4)?, f32_at(buf, at + 8)?],
            normal: [
                f32_at(buf, at + 12)?,
                f32_at(buf, at + 16)?,
                f32_at(buf, at + 20)?,
            ],
            uv: [f32_at(buf, at + 24)?, f32_at(buf, at + 28)?],
        });
    }

    let mut indices = Vec::with_capacity(num_indices);
    for i in 0..num_indices {
        indices.push(u32_at(buf, indices_offset + i * 4)?);
    }

    let mut children = Vec::with_capacity(num_children);
    for i in 0..num_children {
        let child_offset = u32_at(buf, children_offset + i * 4)? as usize;
        children.push(read_piece(buf, child_offset, depth + 1, seen)?);
    }

    Ok(Piece {
        name: cstr_at(buf, name_offset)?,
        primitive_type,
        offset: piece_offset,
        vertices,
        indices,
        children,
    })
}

/// A texture offset of 0 means "no texture", which is distinct from an empty
/// string sitting at a real offset.
fn texture_at(buf: &[u8], offset: usize) -> Result<String, Error> {
    if offset == 0 {
        return Ok(String::new());
    }
    cstr_at(buf, offset)
}

fn cstr_at(buf: &[u8], offset: usize) -> Result<String, Error> {
    if offset >= buf.len() {
        return Err(Error::OutOfBounds {
            what: "string",
            offset,
        });
    }
    let end = buf[offset..]
        .iter()
        .position(|&b| b == 0)
        .ok_or(Error::UnterminatedString(offset))?;
    Ok(String::from_utf8_lossy(&buf[offset..offset + end]).into_owned())
}

fn bytes_at(buf: &[u8], offset: usize, what: &'static str) -> Result<[u8; 4], Error> {
    buf.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(Error::OutOfBounds { what, offset })
}

fn u32_at(buf: &[u8], offset: usize) -> Result<u32, Error> {
    Ok(u32::from_le_bytes(bytes_at(buf, offset, "u32")?))
}

fn i32_at(buf: &[u8], offset: usize) -> Result<i32, Error> {
    Ok(i32::from_le_bytes(bytes_at(buf, offset, "i32")?))
}

fn f32_at(buf: &[u8], offset: usize) -> Result<f32, Error> {
    Ok(f32::from_le_bytes(bytes_at(buf, offset, "f32")?))
}
