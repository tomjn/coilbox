use std::fmt;

use crate::{Model, Piece, PrimitiveType, HEADER_SIZE, MAGIC, PIECE_SIZE, VERSION, VERTEX_SIZE};

/// Marks the end of a strip. Only legal in a `TriangleStrip` piece, where it is
/// deliberately not a vertex index.
const END_OF_STRIP: u32 = 0xffff_ffff;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteError {
    /// An index does not address a vertex in its own piece, so the engine would
    /// read whatever happens to sit next in memory.
    IndexOutOfRange {
        piece: String,
        index: u32,
        vertices: usize,
    },
    /// A triangle list must be a whole number of triangles, a quad list a whole
    /// number of quads.
    RaggedIndexList {
        piece: String,
        count: usize,
        per_primitive: usize,
    },
    /// Piece names are NUL terminated in the file, so an interior NUL would
    /// silently truncate the name.
    NameContainsNul(String),
}

impl fmt::Display for WriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IndexOutOfRange {
                piece,
                index,
                vertices,
            } => write!(
                f,
                "piece \"{piece}\" has index {index} but only {vertices} vertices"
            ),
            Self::RaggedIndexList {
                piece,
                count,
                per_primitive,
            } => write!(
                f,
                "piece \"{piece}\" has {count} indices, not a multiple of {per_primitive}"
            ),
            Self::NameContainsNul(name) => {
                write!(f, "piece name {name:?} contains a NUL byte")
            }
        }
    }
}

impl std::error::Error for WriteError {}

/// Serialise a model to `.s3o` bytes.
///
/// The layout is dense and deterministic: header, then every piece struct in
/// depth-first pre-order, then names, child tables, vertices, index tables and
/// the two texture names. Other tools order the sections differently, so
/// re-writing a third-party file moves bytes around without changing meaning.
pub fn write(model: &Model) -> Result<Vec<u8>, WriteError> {
    let mut pieces = Vec::new();
    let mut children = Vec::new();
    flatten(&model.root, &mut pieces, &mut children);

    let mut names = Vec::with_capacity(pieces.len());
    for piece in &pieces {
        validate(piece)?;
        names.push(piece.name.as_bytes());
    }

    // Pass one: assign every offset, so pass two can emit in one go.
    let mut cursor = HEADER_SIZE + pieces.len() * PIECE_SIZE;
    let mut name_offsets = Vec::with_capacity(pieces.len());
    for name in &names {
        name_offsets.push(cursor);
        cursor += name.len() + 1;
    }
    let mut child_offsets = Vec::with_capacity(pieces.len());
    for kids in &children {
        child_offsets.push(section_offset(&mut cursor, kids.len() * 4));
    }
    let mut vertex_offsets = Vec::with_capacity(pieces.len());
    for piece in &pieces {
        vertex_offsets.push(section_offset(
            &mut cursor,
            piece.vertices.len() * VERTEX_SIZE,
        ));
    }
    let mut index_offsets = Vec::with_capacity(pieces.len());
    for piece in &pieces {
        index_offsets.push(section_offset(&mut cursor, piece.indices.len() * 4));
    }
    let texture1_offset = section_offset(&mut cursor, string_len(&model.texture1));
    let texture2_offset = section_offset(&mut cursor, string_len(&model.texture2));

    // Pass two: emit.
    let mut buf = Vec::with_capacity(cursor);
    buf.extend_from_slice(MAGIC);
    buf.extend_from_slice(&VERSION.to_le_bytes());
    buf.extend_from_slice(&model.radius.to_le_bytes());
    buf.extend_from_slice(&model.height.to_le_bytes());
    for v in model.mid {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    push_u32(&mut buf, HEADER_SIZE);
    push_u32(&mut buf, 0); // collisionData, must be 0
    push_u32(&mut buf, texture1_offset);
    push_u32(&mut buf, texture2_offset);

    for (i, piece) in pieces.iter().enumerate() {
        push_u32(&mut buf, name_offsets[i]);
        push_u32(&mut buf, children[i].len());
        push_u32(&mut buf, child_offsets[i]);
        push_u32(&mut buf, piece.vertices.len());
        push_u32(&mut buf, vertex_offsets[i]);
        push_u32(&mut buf, 0); // vertexType, always 0
        buf.extend_from_slice(&piece.primitive_type.to_raw().to_le_bytes());
        push_u32(&mut buf, piece.indices.len());
        push_u32(&mut buf, index_offsets[i]);
        push_u32(&mut buf, 0); // collisionData, must be 0
        for v in piece.offset {
            buf.extend_from_slice(&v.to_le_bytes());
        }
    }

    for name in &names {
        buf.extend_from_slice(name);
        buf.push(0);
    }
    for kids in &children {
        for &kid in kids {
            push_u32(&mut buf, HEADER_SIZE + kid * PIECE_SIZE);
        }
    }
    for piece in &pieces {
        for vertex in &piece.vertices {
            for v in vertex.pos.iter().chain(&vertex.normal).chain(&vertex.uv) {
                buf.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    for piece in &pieces {
        for &index in &piece.indices {
            buf.extend_from_slice(&index.to_le_bytes());
        }
    }
    push_string(&mut buf, &model.texture1);
    push_string(&mut buf, &model.texture2);

    debug_assert_eq!(buf.len(), cursor);
    Ok(buf)
}

fn validate(piece: &Piece) -> Result<(), WriteError> {
    if piece.name.as_bytes().contains(&0) {
        return Err(WriteError::NameContainsNul(piece.name.clone()));
    }

    let per_primitive = match piece.primitive_type {
        PrimitiveType::Triangles => 3,
        PrimitiveType::Quads => 4,
        // A strip is any length and carries end-of-strip markers.
        PrimitiveType::TriangleStrip => 1,
    };
    if !piece.indices.len().is_multiple_of(per_primitive) {
        return Err(WriteError::RaggedIndexList {
            piece: piece.name.clone(),
            count: piece.indices.len(),
            per_primitive,
        });
    }

    let strip = piece.primitive_type == PrimitiveType::TriangleStrip;
    for &index in &piece.indices {
        if strip && index == END_OF_STRIP {
            continue;
        }
        if index as usize >= piece.vertices.len() {
            return Err(WriteError::IndexOutOfRange {
                piece: piece.name.clone(),
                index,
                vertices: piece.vertices.len(),
            });
        }
    }
    Ok(())
}

/// Reserve `len` bytes and return their offset, or 0 for an empty section. The
/// engine never dereferences an offset whose count is zero.
fn section_offset(cursor: &mut usize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let at = *cursor;
    *cursor += len;
    at
}

fn string_len(s: &str) -> usize {
    if s.is_empty() {
        0
    } else {
        s.len() + 1
    }
}

fn push_string(buf: &mut Vec<u8>, s: &str) {
    if s.is_empty() {
        return;
    }
    buf.extend_from_slice(s.as_bytes());
    buf.push(0);
}

fn push_u32(buf: &mut Vec<u8>, value: usize) {
    buf.extend_from_slice(&(value as u32).to_le_bytes());
}

/// Depth-first pre-order. `children[i]` holds the flat indices of piece `i`'s
/// children, which is what the child table stores as file offsets.
fn flatten<'a>(
    piece: &'a Piece,
    out: &mut Vec<&'a Piece>,
    children: &mut Vec<Vec<usize>>,
) -> usize {
    let me = out.len();
    out.push(piece);
    children.push(Vec::new());
    let ids: Vec<usize> = piece
        .children
        .iter()
        .map(|child| flatten(child, out, children))
        .collect();
    children[me] = ids;
    me
}
