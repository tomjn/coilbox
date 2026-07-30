use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::{Model, Piece, Primitive, Texture, OBJECT_SIZE, PRIMITIVE_SIZE, SCALE, VERSION};

/// Guards against a piece tree deep enough to blow the stack. Real models are a
/// handful of levels, so anything past this is corrupt or hostile.
const MAX_DEPTH: usize = 64;

/// Two faces count as one smooth surface when their normals agree by at least
/// this much, about 63 degrees apart. From `S3DOPiece::CalcNormals`.
const SMOOTH_DOT: f32 = 0.45;

/// A base plate has to be at least 30 units along each of two edges, squared
/// here because the engine compares squared lengths.
const BASE_PLATE_MIN_EDGE_SQ: f32 = 900.0;

/// Below this squared length the engine leaves a vector unnormalised rather
/// than dividing by nearly zero. `float3::nrm_eps`.
const NORMALIZE_EPS: f32 = 1e-12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    TooShort {
        need: usize,
        got: usize,
    },
    /// A `.3do` has no magic number, so a file that is not one usually fails
    /// here.
    BadVersion(i32),
    OutOfBounds {
        what: &'static str,
        offset: usize,
    },
    /// A negative count or a negative offset where the engine would read one as
    /// unsigned and walk off into the file.
    Negative {
        what: &'static str,
        value: i32,
    },
    UnterminatedString(usize),
    /// A face that names a vertex the piece does not have. The engine reads
    /// past the end of its own array here, so it cannot be trusted to say the
    /// file is fine.
    IndexOutOfRange {
        piece: String,
        index: u32,
        vertices: usize,
    },
    TooDeep,
    /// An object offset appears twice, so the tree is not a tree.
    Cycle(usize),
    /// The root has a sibling, which has no parent to be a child of. The engine
    /// dereferences a null parent here.
    RootHasSibling,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort { need, got } => {
                write!(f, "file is {got} bytes, need at least {need}")
            }
            Self::BadVersion(v) => {
                write!(
                    f,
                    "not a 3do file: version signature is {v}, expected {VERSION}"
                )
            }
            Self::OutOfBounds { what, offset } => {
                write!(f, "{what} at offset {offset} runs past the end of the file")
            }
            Self::Negative { what, value } => write!(f, "{what} is negative: {value}"),
            Self::UnterminatedString(offset) => {
                write!(f, "string at offset {offset} has no terminating NUL")
            }
            Self::IndexOutOfRange {
                piece,
                index,
                vertices,
            } => write!(
                f,
                "face in piece {piece:?} uses vertex {index}, but the piece has {vertices}"
            ),
            Self::TooDeep => write!(f, "piece tree deeper than {MAX_DEPTH} levels"),
            Self::Cycle(offset) => write!(f, "object at offset {offset} is referenced twice"),
            Self::RootHasSibling => write!(f, "the root object has a sibling and no parent"),
        }
    }
}

impl std::error::Error for Error {}

/// Parse a `.3do` file.
pub fn read(buf: &[u8]) -> Result<Model, Error> {
    if buf.len() < OBJECT_SIZE {
        return Err(Error::TooShort {
            need: OBJECT_SIZE,
            got: buf.len(),
        });
    }

    let mut seen = HashSet::new();
    let (root, sibling) = read_object(buf, 0, 0, &mut seen, true)?;
    if sibling != 0 {
        return Err(Error::RootHasSibling);
    }

    let (min, max) = bounds(&root, [0.0; 3]).unwrap_or(([0.0; 3], [0.0; 3]));
    Ok(Model {
        radius: length(sub(max, min)) * 0.5,
        height: max[1] - min[1],
        mid: [
            (max[0] + min[0]) * 0.5,
            (max[1] + min[1]) * 0.5,
            (max[2] + min[2]) * 0.5,
        ],
        root,
    })
}

/// Reads one object and its child chain, and reports where its own next
/// sibling starts. Siblings are read as a loop rather than by recursing, so a
/// long flat list of pieces cannot exhaust the stack.
fn read_object(
    buf: &[u8],
    pos: usize,
    depth: usize,
    seen: &mut HashSet<usize>,
    is_root: bool,
) -> Result<(Piece, usize), Error> {
    if depth >= MAX_DEPTH {
        return Err(Error::TooDeep);
    }
    if !seen.insert(pos) {
        return Err(Error::Cycle(pos));
    }
    if pos.saturating_add(OBJECT_SIZE) > buf.len() {
        return Err(Error::OutOfBounds {
            what: "object",
            offset: pos,
        });
    }

    let version = i32_at(buf, pos)?;
    if version != VERSION {
        return Err(Error::BadVersion(version));
    }

    let num_vertices = count_at(buf, pos + 4, "vertex count")?;
    let num_primitives = count_at(buf, pos + 8, "primitive count")?;
    let selection = i32_at(buf, pos + 12)?;
    // Z is negated because the engine's Z runs the other way to Total
    // Annihilation's.
    let offset = [
        i32_at(buf, pos + 16)? as f32 * SCALE,
        i32_at(buf, pos + 20)? as f32 * SCALE,
        -(i32_at(buf, pos + 24)? as f32) * SCALE,
    ];
    let name_offset = count_at(buf, pos + 28, "name offset")?;
    // 32 is Always_0, which every installed model has as 0.
    let sibling = link_at(buf, pos + 44)?;
    let child = link_at(buf, pos + 48)?;

    let name = cstr_at(buf, name_offset)?.to_ascii_lowercase();

    // The offsets are only read when the matching count is above zero, as the
    // engine does, so a stale pointer on an empty piece is not an error.
    let vertices = if num_vertices > 0 {
        read_vertices(
            buf,
            count_at(buf, pos + 36, "vertex array offset")?,
            num_vertices,
        )?
    } else {
        Vec::new()
    };
    let mut primitives = if num_primitives > 0 {
        read_primitives(
            buf,
            count_at(buf, pos + 40, "primitive array offset")?,
            num_primitives,
            is_root.then_some(selection),
            &vertices,
            &name,
        )?
    } else {
        Vec::new()
    };
    smooth_normals(&mut primitives, vertices.len());

    let mut children = Vec::new();
    let mut at = child;
    while at != 0 {
        let (piece, next) = read_object(buf, at, depth + 1, seen, false)?;
        children.push(piece);
        at = next;
    }

    Ok((
        Piece {
            name,
            offset,
            vertices,
            primitives,
            children,
        },
        sibling,
    ))
}

fn read_vertices(buf: &[u8], at: usize, count: usize) -> Result<Vec<[f32; 3]>, Error> {
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let v = at + i * 12;
        out.push([
            i32_at(buf, v)? as f32 * SCALE,
            i32_at(buf, v + 4)? as f32 * SCALE,
            -(i32_at(buf, v + 8)? as f32) * SCALE,
        ]);
    }
    Ok(out)
}

/// Reads the faces the engine would draw. Three of its four load-time culls are
/// here, each one a face it never renders, and each one noted with why.
fn read_primitives(
    buf: &[u8],
    at: usize,
    count: usize,
    selection: Option<i32>,
    vertices: &[[f32; 3]],
    piece: &str,
) -> Result<Vec<Primitive>, Error> {
    let mut out: Vec<Primitive> = Vec::with_capacity(count);
    // Duplicate faces with different textures are how 3do models animate. The
    // engine draws only the last of a set, so the earlier one is replaced in
    // place rather than appended.
    let mut by_corners: HashMap<Vec<u32>, usize> = HashMap::new();

    for i in 0..count {
        // The root's selection primitive is the flat face drawn under a
        // selected unit, so it is never part of the model.
        if selection == Some(i as i32) {
            continue;
        }

        let p = at + i * PRIMITIVE_SIZE;
        let palette = i32_at(buf, p)?;
        let num_indices = count_at(buf, p + 4, "index count")?;
        // 8 is Always_0.
        let index_array = count_at(buf, p + 12, "index array offset")?;
        let texture_offset = count_at(buf, p + 16, "texture name offset")?;
        // 20, 24 and 28 hold colour data the engine does not read.

        // Fewer than three corners is not a face. Around 6400 of these are in
        // the installed models, and some of them name vertices that do not
        // exist, so they are dropped before their indices are looked at.
        if num_indices < 3 {
            continue;
        }

        let mut indices = Vec::with_capacity(num_indices);
        for c in 0..num_indices {
            let index = u16_at(buf, index_array + c * 2)? as u32;
            if index as usize >= vertices.len() {
                return Err(Error::IndexOutOfRange {
                    piece: piece.to_string(),
                    index,
                    vertices: vertices.len(),
                });
            }
            indices.push(index);
        }

        let texture = if texture_offset == 0 {
            Texture::Palette(palette)
        } else {
            Texture::Name(cstr_at(buf, texture_offset)?.to_ascii_lowercase())
        };

        // The engine negates the cross product of the first two edges, the
        // opposite of the usual right-handed convention. With the negation, 85
        // percent of the faces in the installed games point away from the
        // middle of their own piece. Without it, 15 percent do.
        let corner = |n: usize| vertices[indices[n] as usize];
        let normal = normalize(negate(cross(
            sub(corner(1), corner(0)),
            sub(corner(2), corner(0)),
        )));

        let primitive = Primitive {
            vertex_normals: vec![[0.0; 3]; indices.len()],
            indices,
            texture,
            normal,
        };

        // Some models carry several base plates, which are selection faces the
        // exporter left behind rather than geometry.
        if is_base_plate(&primitive, vertices) {
            continue;
        }

        let mut corners = primitive.indices.clone();
        corners.sort_unstable();
        match by_corners.get(&corners) {
            Some(&earlier) => out[earlier] = primitive,
            None => {
                by_corners.insert(corners, out.len());
                out.push(primitive);
            }
        }
    }

    Ok(out)
}

/// A large flat quad facing straight down with nothing above the origin: the
/// footprint an exporter leaves for the selection box.
fn is_base_plate(primitive: &Primitive, vertices: &[[f32; 3]]) -> bool {
    if primitive.normal[1] >= -0.99 {
        return false;
    }
    if primitive.indices.len() != 4 {
        return false;
    }

    let corner = |n: usize| vertices[primitive.indices[n] as usize];
    if square_length(sub(corner(0), corner(1))) < BASE_PLATE_MIN_EDGE_SQ
        || square_length(sub(corner(1), corner(2))) < BASE_PLATE_MIN_EDGE_SQ
    {
        return false;
    }

    primitive
        .indices
        .iter()
        .all(|&i| vertices[i as usize][1] <= 0.0)
}

/// Averages each corner's normal over the faces meeting there, skipping any
/// that turn away too sharply. Without this a model looks faceted, and the
/// file has no normals of its own for a consumer to fall back on.
fn smooth_normals(primitives: &mut [Primitive], num_vertices: usize) {
    let mut faces_at: Vec<Vec<usize>> = vec![Vec::new(); num_vertices];
    for (i, primitive) in primitives.iter().enumerate() {
        for &index in &primitive.indices {
            faces_at[index as usize].push(i);
        }
    }

    let face_normals: Vec<[f32; 3]> = primitives.iter().map(|p| p.normal).collect();
    for primitive in primitives.iter_mut() {
        let mut smoothed = Vec::with_capacity(primitive.indices.len());
        for &index in &primitive.indices {
            let mut sum = [0.0; 3];
            for &face in &faces_at[index as usize] {
                if dot(primitive.normal, face_normals[face]) > SMOOTH_DOT {
                    sum = add(sum, face_normals[face]);
                }
            }
            smoothed.push(normalize(sum));
        }
        primitive.vertex_normals = smoothed;
    }
}

/// Box around every piece that has geometry, in model space. `None` when the
/// model has no vertices at all, where the engine's own answer is a box 20000
/// units across.
fn bounds(piece: &Piece, parent: [f32; 3]) -> Option<([f32; 3], [f32; 3])> {
    let at = add(parent, piece.offset);
    let mut extent = piece.vertices.iter().fold(None, |acc, v| {
        let v = add(at, *v);
        Some(match acc {
            None => (v, v),
            Some((min, max)) => (component_min(min, v), component_max(max, v)),
        })
    });

    for child in &piece.children {
        extent = match (extent, bounds(child, at)) {
            (Some((amin, amax)), Some((bmin, bmax))) => {
                Some((component_min(amin, bmin), component_max(amax, bmax)))
            }
            (some, None) | (None, some) => some,
        };
    }
    extent
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

fn i32_at(buf: &[u8], offset: usize) -> Result<i32, Error> {
    buf.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .map(i32::from_le_bytes)
        .ok_or(Error::OutOfBounds {
            what: "int32",
            offset,
        })
}

fn u16_at(buf: &[u8], offset: usize) -> Result<u16, Error> {
    buf.get(offset..offset + 2)
        .and_then(|s| s.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or(Error::OutOfBounds {
            what: "vertex index",
            offset,
        })
}

/// A count or an offset, which the file stores signed and the engine uses
/// unsigned.
fn count_at(buf: &[u8], offset: usize, what: &'static str) -> Result<usize, Error> {
    let value = i32_at(buf, offset)?;
    usize::try_from(value).map_err(|_| Error::Negative { what, value })
}

/// A link to another object. The engine treats anything at or below zero as
/// absent, so a negative one is not corruption.
fn link_at(buf: &[u8], offset: usize) -> Result<usize, Error> {
    Ok(i32_at(buf, offset)?.max(0) as usize)
}

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn negate(a: [f32; 3]) -> [f32; 3] {
    [-a[0], -a[1], -a[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn square_length(a: [f32; 3]) -> f32 {
    dot(a, a)
}

fn length(a: [f32; 3]) -> f32 {
    square_length(a).sqrt()
}

fn normalize(a: [f32; 3]) -> [f32; 3] {
    let square = square_length(a);
    if square > NORMALIZE_EPS {
        let scale = 1.0 / square.sqrt();
        [a[0] * scale, a[1] * scale, a[2] * scale]
    } else {
        a
    }
}

fn component_min(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])]
}

fn component_max(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])]
}
