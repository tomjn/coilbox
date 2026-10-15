//! A chunk is a list of columns, and a column is an array of one type: an
//! integer of some width, or a 32 bit float. On disk a chunk is a zlib stream
//! (RFC 1950) of that list.

use crate::error::{Result, TrackError};
use crate::quant::VALUE_LIMIT;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::collections::BTreeMap;
use std::io::{Read, Write};

/// One array of one type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Column {
    U8(Vec<u8>),
    U16(Vec<u16>),
    S16(Vec<i16>),
    U32(Vec<u32>),
    S32(Vec<i32>),
    /// 32 bit floats, each held as its bits so that a column compares exactly.
    /// `f32::from_bits` gives the number.
    F32(Vec<u32>),
}

impl Column {
    fn type_code(&self) -> u16 {
        match self {
            Self::U8(_) => 1,
            Self::U16(_) => 2,
            Self::S16(_) => 3,
            Self::U32(_) => 4,
            Self::S32(_) => 5,
            Self::F32(_) => 6,
        }
    }

    pub fn len(&self) -> usize {
        match self {
            Self::U8(v) => v.len(),
            Self::U16(v) => v.len(),
            Self::S16(v) => v.len(),
            Self::U32(v) | Self::F32(v) => v.len(),
            Self::S32(v) => v.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// A decoded chunk. A frontend that wants typed arrays reads the columns
/// straight from here.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Chunk {
    columns: BTreeMap<u16, Column>,
}

macro_rules! getter {
    ($name:ident, $variant:ident, $t:ty) => {
        /// The column's values, or none when the chunk has no such column. A
        /// column of another type is an error.
        pub fn $name(&self, id: u16) -> Result<&[$t]> {
            match self.columns.get(&id) {
                None => Ok(&[]),
                Some(Column::$variant(v)) => Ok(v),
                Some(other) => Err(TrackError::corrupt(
                    format!("column {id}"),
                    format!(
                        "it is type {}, not {}",
                        other.type_code(),
                        stringify!($variant)
                    ),
                )),
            }
        }
    };
}

macro_rules! setter {
    ($name:ident, $variant:ident, $t:ty) => {
        pub fn $name(&mut self, id: u16, values: Vec<$t>) {
            self.columns.insert(id, Column::$variant(values));
        }
    };
}

impl Chunk {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn column(&self, id: u16) -> Option<&Column> {
        self.columns.get(&id)
    }

    /// The ids present, in rising order.
    pub fn ids(&self) -> impl Iterator<Item = u16> + '_ {
        self.columns.keys().copied()
    }

    getter!(u8s, U8, u8);
    getter!(u16s, U16, u16);
    getter!(s16s, S16, i16);
    getter!(u32s, U32, u32);
    getter!(s32s, S32, i32);
    getter!(f32_bits, F32, u32);
    setter!(set_u8, U8, u8);
    setter!(set_u16, U16, u16);
    setter!(set_s16, S16, i16);
    setter!(set_u32, U32, u32);
    setter!(set_s32, S32, i32);
    setter!(set_f32_bits, F32, u32);

    /// The chunk as bytes before compression. A column with no values is not
    /// listed. A whole number past [`VALUE_LIMIT`] is an error. A float is
    /// written as it is, since the engine's Lua reads one as the number it
    /// already uses.
    pub fn encode(&self) -> Result<Vec<u8>> {
        let listed: Vec<(&u16, &Column)> =
            self.columns.iter().filter(|(_, c)| !c.is_empty()).collect();
        let mut out = Vec::new();
        out.extend_from_slice(&(listed.len() as u32).to_le_bytes());
        let mut offset = 4 + 12 * listed.len();
        for (id, col) in &listed {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&col.type_code().to_le_bytes());
            out.extend_from_slice(&(offset as u32).to_le_bytes());
            out.extend_from_slice(&(col.len() as u32).to_le_bytes());
            offset += padded(width(col) * col.len());
        }
        for (id, col) in &listed {
            let start = out.len();
            match col {
                Column::U8(v) => out.extend_from_slice(v),
                Column::U16(v) => v
                    .iter()
                    .for_each(|x| out.extend_from_slice(&x.to_le_bytes())),
                Column::S16(v) => v
                    .iter()
                    .for_each(|x| out.extend_from_slice(&x.to_le_bytes())),
                Column::U32(v) => {
                    for x in v {
                        crate::quant::check_limit(|| format!("a value in column {id}"), *x as i64)?;
                        out.extend_from_slice(&x.to_le_bytes());
                    }
                }
                Column::S32(v) => {
                    for x in v {
                        crate::quant::check_limit(|| format!("a value in column {id}"), *x as i64)?;
                        out.extend_from_slice(&x.to_le_bytes());
                    }
                }
                Column::F32(v) => v
                    .iter()
                    .for_each(|x| out.extend_from_slice(&x.to_le_bytes())),
            }
            out.resize(start + padded(out.len() - start), 0);
        }
        out.extend_from_slice(&[0; 4]);
        if out.len() as i64 > VALUE_LIMIT {
            return Err(TrackError::OutOfRange {
                what: "a chunk's length".into(),
                value: out.len() as i64,
                limit: VALUE_LIMIT,
            });
        }
        Ok(out)
    }

    /// Reads a chunk from bytes that are already decompressed.
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let bad = |reason: String| TrackError::corrupt("chunk", reason);
        let word = |at: usize| -> Result<u32> {
            bytes
                .get(at..at + 4)
                .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
                .ok_or_else(|| {
                    bad(format!(
                        "it ends at byte {} but needs {}",
                        bytes.len(),
                        at + 4
                    ))
                })
        };
        let count = word(0)? as usize;
        if count > (bytes.len().saturating_sub(4)) / 12 {
            return Err(bad(format!(
                "it lists {count} columns in {} bytes",
                bytes.len()
            )));
        }
        let mut columns = BTreeMap::new();
        let mut previous: Option<u16> = None;
        for i in 0..count {
            let at = 4 + 12 * i;
            let id = u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap());
            let ty = u16::from_le_bytes(bytes[at + 2..at + 4].try_into().unwrap());
            let offset = word(at + 4)? as usize;
            let n = word(at + 8)? as usize;
            if previous.is_some_and(|p| p >= id) {
                return Err(bad(format!("column {id} is not in rising order")));
            }
            previous = Some(id);
            let size = match ty {
                1 => 1,
                2 | 3 => 2,
                4..=6 => 4,
                // A type this version does not know is skipped, as an
                // unknown id is.
                _ => continue,
            };
            let end = n
                .checked_mul(size)
                .and_then(|len| offset.checked_add(len))
                .filter(|end| *end <= bytes.len())
                .ok_or_else(|| bad(format!("column {id} runs past the end of the chunk")))?;
            let data = &bytes[offset..end];
            let col = match ty {
                1 => Column::U8(data.to_vec()),
                2 => Column::U16(
                    data.as_chunks::<2>()
                        .0
                        .iter()
                        .map(|b| u16::from_le_bytes(*b))
                        .collect(),
                ),
                3 => Column::S16(
                    data.as_chunks::<2>()
                        .0
                        .iter()
                        .map(|b| i16::from_le_bytes(*b))
                        .collect(),
                ),
                4 | 6 => {
                    let words = data
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|b| u32::from_le_bytes(*b))
                        .collect();
                    if ty == 4 {
                        Column::U32(words)
                    } else {
                        Column::F32(words)
                    }
                }
                _ => Column::S32(
                    data.as_chunks::<4>()
                        .0
                        .iter()
                        .map(|b| i32::from_le_bytes(*b))
                        .collect(),
                ),
            };
            columns.insert(id, col);
        }
        Ok(Self { columns })
    }
}

fn width(c: &Column) -> usize {
    match c {
        Column::U8(_) => 1,
        Column::U16(_) | Column::S16(_) => 2,
        Column::U32(_) | Column::S32(_) | Column::F32(_) => 4,
    }
}

fn padded(n: usize) -> usize {
    n.div_ceil(4) * 4
}

/// A zlib stream at level 9. Any level reads the same.
pub fn compress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::new(9));
    enc.write_all(bytes)?;
    Ok(enc.finish()?)
}

/// Inflates a zlib stream, checking its Adler-32. The result is at most
/// [`VALUE_LIMIT`] bytes, as the format says, so a damaged stream cannot make
/// the reader allocate without bound.
pub fn decompress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    ZlibDecoder::new(bytes)
        .take(VALUE_LIMIT as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| TrackError::corrupt("chunk", format!("its zlib stream is bad: {e}")))?;
    if out.len() as i64 > VALUE_LIMIT {
        return Err(TrackError::corrupt(
            "chunk",
            format!("it is longer than {VALUE_LIMIT} bytes when decompressed"),
        ));
    }
    if out.is_empty() {
        return Err(TrackError::corrupt("chunk", "it decompresses to nothing"));
    }
    Ok(out)
}
