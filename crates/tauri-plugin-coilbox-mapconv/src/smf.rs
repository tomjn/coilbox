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
const OFF_HEIGHTMAP_PTR: usize = 52;
const OFF_METALMAP_PTR: usize = 68;
/// The header up to and including `metalmapPtr`.
const HEADER_READ: usize = 72;

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

/// Where a compiled map's metal map is: `mapx / 2` by `mapy / 2` bytes at
/// `metalmapPtr`, one per 16 by 16 elmo cell, as `CSMFMapFile::ReadInfoMap`
/// reads them.
pub struct SmfMetal {
    offset: u64,
    pub len: usize,
    pub width: i32,
    pub height: i32,
}

/// Where a compiled map's heights are: the header, and the byte offset and
/// length of the `(mapx + 1) * (mapy + 1)` little endian 16 bit words at
/// `heightmapPtr`, as the engine reads them in `CSMFMapFile::ReadHeightmap`.
/// The words must lie inside the file, so a corrupt header cannot ask for more
/// memory than the file holds.
///
/// `metal` is `None` when the metal map does not lie inside the file. The
/// heights are still good then, so that is the caller's to report rather than a
/// reason to refuse the map.
pub struct SmfHeights {
    pub info: SmfInfo,
    offset: u64,
    pub len: usize,
    pub metal: Option<SmfMetal>,
}

pub fn locate_smf_heights(path: &std::path::Path) -> Result<SmfHeights, String> {
    use std::io::Read;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let size = file
        .metadata()
        .map_err(|e| format!("could not read {}: {e}", path.display()))?
        .len();
    let mut head = [0u8; HEADER_READ];
    file.read_exact(&mut head)
        .map_err(|_| "file too small to be an SMF".to_string())?;
    let info = parse_smf_header(&head)?;
    if info.mapx <= 0 || info.mapy <= 0 {
        return Err(format!(
            "the SMF says it is {} by {} squares",
            info.mapx, info.mapy
        ));
    }
    let pointer = |at: usize| {
        u64::from(u32::from_le_bytes([
            head[at],
            head[at + 1],
            head[at + 2],
            head[at + 3],
        ]))
    };
    let offset = pointer(OFF_HEIGHTMAP_PTR);
    let len = (info.mapx as u64 + 1) * (info.mapy as u64 + 1) * 2;
    if offset + len > size {
        return Err("the SMF ends before its heightmap does".to_string());
    }
    let metal_offset = pointer(OFF_METALMAP_PTR);
    let (width, height) = (info.mapx / 2, info.mapy / 2);
    let metal_len = width as u64 * height as u64;
    // A zero pointer is a map with no metal block, and would read the header.
    let metal = (metal_offset != 0 && metal_offset + metal_len <= size).then_some(SmfMetal {
        offset: metal_offset,
        len: metal_len as usize,
        width,
        height,
    });
    Ok(SmfHeights {
        info,
        offset,
        len: len as usize,
        metal,
    })
}

/// The heightmap words `locate_smf_heights` found.
pub fn read_smf_heights(path: &std::path::Path, at: &SmfHeights) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let mut words = vec![0u8; at.len];
    file.seek(SeekFrom::Start(at.offset))
        .and_then(|_| file.read_exact(&mut words))
        .map_err(|_| "the SMF ends before its heightmap does".to_string())?;
    Ok(words)
}

/// The metal map bytes `locate_smf_heights` found.
pub fn read_smf_metal(path: &std::path::Path, at: &SmfMetal) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let mut bytes = vec![0u8; at.len];
    file.seek(SeekFrom::Start(at.offset))
        .and_then(|_| file.read_exact(&mut bytes))
        .map_err(|_| "the SMF ends before its metal map does".to_string())?;
    Ok(bytes)
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

    #[test]
    fn reads_the_heightmap_words_at_the_pointer() {
        let mut b = header(2, 1, 8, -10.0, 200.0);
        b.resize(80, 0);
        b[OFF_HEIGHTMAP_PTR..OFF_HEIGHTMAP_PTR + 4].copy_from_slice(&80u32.to_le_bytes());
        let words: Vec<u16> = (0..6).map(|i| i * 1000).collect();
        for w in &words {
            b.extend_from_slice(&w.to_le_bytes());
        }
        let path =
            std::env::temp_dir().join(format!("coilbox-smf-heights-{}.smf", std::process::id()));
        std::fs::write(&path, &b).unwrap();
        let at = locate_smf_heights(&path).unwrap();
        let bytes = read_smf_heights(&path, &at).unwrap();
        assert_eq!((at.info.mapx, at.info.mapy), (2, 1));
        assert_eq!(bytes.len(), 12);
        assert_eq!(u16::from_le_bytes([bytes[10], bytes[11]]), 5000);

        // Cut short inside the heightmap.
        std::fs::write(&path, &b[..b.len() - 1]).unwrap();
        assert!(locate_smf_heights(&path).is_err());

        // A header claiming a huge map is refused before anything is read.
        let mut huge = b.clone();
        huge[OFF_MAPX..OFF_MAPX + 4].copy_from_slice(&i32::MAX.to_le_bytes());
        std::fs::write(&path, &huge).unwrap();
        assert!(locate_smf_heights(&path).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn reads_the_metal_map_at_its_pointer() {
        // 4 by 2 squares: a 2 by 1 metal map and 5 by 3 height words.
        let mut b = header(4, 2, 8, 0.0, 1.0);
        b.resize(80, 0);
        b[OFF_METALMAP_PTR..OFF_METALMAP_PTR + 4].copy_from_slice(&80u32.to_le_bytes());
        b[OFF_HEIGHTMAP_PTR..OFF_HEIGHTMAP_PTR + 4].copy_from_slice(&82u32.to_le_bytes());
        b.extend_from_slice(&[7, 200]);
        b.extend_from_slice(&[0u8; 30]);
        let path =
            std::env::temp_dir().join(format!("coilbox-smf-metal-{}.smf", std::process::id()));
        std::fs::write(&path, &b).unwrap();
        let at = locate_smf_heights(&path).unwrap();
        let metal = at.metal.as_ref().expect("the metal map is inside the file");
        assert_eq!((metal.width, metal.height, metal.len), (2, 1, 2));
        assert_eq!(read_smf_metal(&path, metal).unwrap(), vec![7, 200]);

        // A null pointer is no metal map, not the header read as one.
        b[OFF_METALMAP_PTR..OFF_METALMAP_PTR + 4].copy_from_slice(&0u32.to_le_bytes());
        std::fs::write(&path, &b).unwrap();
        assert!(locate_smf_heights(&path).unwrap().metal.is_none());

        // The metal map pointing past the end leaves the heights readable.
        b[OFF_METALMAP_PTR..OFF_METALMAP_PTR + 4].copy_from_slice(&1000u32.to_le_bytes());
        std::fs::write(&path, &b).unwrap();
        let at = locate_smf_heights(&path).unwrap();
        assert!(at.metal.is_none());
        assert_eq!(read_smf_heights(&path, &at).unwrap().len(), 30);
        let _ = std::fs::remove_file(&path);
    }
}
