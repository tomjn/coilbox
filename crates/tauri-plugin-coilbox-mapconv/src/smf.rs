//! Minimal Spring `.smf` header parser — enough to surface basic map data after
//! a decompile. The header is a packed, little-endian C struct (see
//! SpringMapConvNG's SMFMap.h `SMFHeader`); we only read the leading fields.

use serde::Serialize;

/// Basic facts about a map, read from the `.smf` header.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmfInfo {
    pub mapx: i32,        // width in squares (divisible by 128)
    pub mapy: i32,        // height in squares
    pub square_size: i32, // elmos between vertices (8)
    pub min_height: f32,  // world height at heightmap 0
    pub max_height: f32,  // world height at heightmap 0xffff
    pub world_width: i32, // mapx * square_size (elmos)
    pub world_height: i32,
}

/// Field offsets in the packed header (16-byte magic, then 4-byte ints/floats).
const MAGIC: &[u8] = b"spring map file"; // 15 bytes + trailing NUL
const OFF_MAPX: usize = 24;
const OFF_MAPY: usize = 28;
const OFF_SQUARE: usize = 32;
const OFF_MINH: usize = 44;
const OFF_MAXH: usize = 48;
const HEADER_MIN: usize = 52;

/// Parse the leading SMF header fields. Returns an error if the bytes are too
/// short or the magic doesn't match.
pub fn parse_smf_header(bytes: &[u8]) -> Result<SmfInfo, String> {
    if bytes.len() < HEADER_MIN {
        return Err("file too small to be an SMF".into());
    }
    if &bytes[0..MAGIC.len()] != MAGIC {
        return Err("not an SMF file (bad magic)".into());
    }
    let i32at = |o: usize| i32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
    let f32at = |o: usize| f32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
    let mapx = i32at(OFF_MAPX);
    let mapy = i32at(OFF_MAPY);
    let square_size = i32at(OFF_SQUARE);
    Ok(SmfInfo {
        mapx,
        mapy,
        square_size,
        min_height: f32at(OFF_MINH),
        max_height: f32at(OFF_MAXH),
        world_width: mapx.saturating_mul(square_size),
        world_height: mapy.saturating_mul(square_size),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(mapx: i32, mapy: i32, square: i32, minh: f32, maxh: f32) -> Vec<u8> {
        let mut b = vec![0u8; HEADER_MIN];
        b[0..MAGIC.len()].copy_from_slice(MAGIC);
        b[OFF_MAPX..OFF_MAPX + 4].copy_from_slice(&mapx.to_le_bytes());
        b[OFF_MAPY..OFF_MAPY + 4].copy_from_slice(&mapy.to_le_bytes());
        b[OFF_SQUARE..OFF_SQUARE + 4].copy_from_slice(&square.to_le_bytes());
        b[OFF_MINH..OFF_MINH + 4].copy_from_slice(&minh.to_le_bytes());
        b[OFF_MAXH..OFF_MAXH + 4].copy_from_slice(&maxh.to_le_bytes());
        b
    }

    #[test]
    fn parses_dimensions_and_heights() {
        let info = parse_smf_header(&header(512, 256, 8, -10.0, 200.0)).unwrap();
        assert_eq!(info.mapx, 512);
        assert_eq!(info.mapy, 256);
        assert_eq!(info.square_size, 8);
        assert_eq!(info.min_height, -10.0);
        assert_eq!(info.max_height, 200.0);
        assert_eq!(info.world_width, 512 * 8);
        assert_eq!(info.world_height, 256 * 8);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut b = header(128, 128, 8, 0.0, 1.0);
        b[0] = b'X';
        assert!(parse_smf_header(&b).is_err());
    }

    #[test]
    fn rejects_short_input() {
        assert!(parse_smf_header(b"spring map file\0").is_err());
    }
}
