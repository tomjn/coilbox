//! The `.smf` feature block: every feature a map places, by type name and world
//! position (issue #1733).
//!
//! unitsync exposes a map's infomaps, its options and its `mapinfo.lua`, and
//! nothing at all about the things standing on the ground. Those are in the map
//! file itself, in a block the header points at, so this reads the bytes.
//!
//! ## Reading them all rather than the ones that look interesting
//!
//! [`features`] returns every feature with the name the map gave it. What counts
//! as a geothermal vent is [`is_geovent`], and it is a question about the answer
//! rather than about the read: a filter inside the parser would make a map whose
//! vents are named unexpectedly indistinguishable from a map with none.
//!
//! ## The layout, from the engine's own `SMFFormat.h`
//!
//! At `featurePtr` sits a `MapFeatureHeader`, two little endian `int`s: how many
//! type names follow, then how many features. The names are NUL terminated and
//! run one after another, and the features follow as fixed 24 byte records of an
//! `int` type index and five `float`s.
//!
//! There is a second parser of this file in
//! `crates/tauri-plugin-coilbox-mapconv/src/smf.rs`, which reads the header's
//! dimensions and height range for the map editor. The two read different fields
//! for different callers and neither can reach the other: that one runs in a
//! Tauri plugin and this one in a sidecar binary.

/// Largest `.smf` this will read. The tiles live in the `.smt` beside it, so an
/// `.smf` is the heightmap, the minimap, two infomaps and the tile indices: this
/// library's largest is 21 MB and its median is 2 MB. The cap is what stops a
/// malformed header turning into an allocation.
pub const MAX_SMF_BYTES: usize = 64 * 1024 * 1024;

/// Where `featurePtr` sits in the header, from `SMFHeader`: sixteen bytes of
/// magic, then seven `int`s, two `float`s, and five more `int`s before it.
const OFF_FEATURE_PTR: usize = 72;

const MAGIC: &[u8] = b"spring map file";

/// The name a map gives a feature the engine turns into a geothermal vent.
///
/// The engine's own rule, and a substring match rather than an equality one
/// because the engine's is: `CFeatureDefHandler::LoadFeatureDefsFromMap`
/// lowercases each of the map's feature type names and gives a default geo def
/// to any that *contains* `geovent`, the same way it gives a default tree def to
/// any containing `treetype`. So `GeoVent`, `geovent1` and `BIGGEOVENT` are all
/// vents to the engine, and matching only the exact word would miss maps the
/// engine does not.
const GEOVENT: &str = "geovent";

/// One feature the map places: what it is, and where.
#[derive(Debug, Clone, PartialEq)]
pub struct MapFeature {
    /// The type name exactly as the map wrote it, case and all. Not lowercased,
    /// because it is what the entry reports and a reader deserves the map's own
    /// spelling.
    pub kind: String,
    /// World coordinates in elmos, the same space start positions are in. `y` is
    /// the height.
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Why a map's features could not be read. A map with none is not one of these:
/// it is an empty list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmfError {
    /// The bytes are not an `.smf` at all.
    NotAnSmf,
    /// The header points past the end of the file, or a record runs off it. A
    /// truncated or corrupt map.
    Truncated,
}

/// Whether a map feature type is a geothermal vent, by the engine's rule.
pub fn is_geovent(kind: &str) -> bool {
    kind.to_lowercase().contains(GEOVENT)
}

/// Every feature the map places, in the order the file lists them.
///
/// That order is the map's own and is stable across reads, which is what lets an
/// entry's points be compared by a digest.
///
/// A map with a feature block of zero features gives an empty list, which is the
/// ordinary case: half of this library's maps place nothing at all.
pub fn features(smf: &[u8]) -> Result<Vec<MapFeature>, SmfError> {
    if smf.len() < OFF_FEATURE_PTR + 4 || !smf.starts_with(MAGIC) {
        return Err(SmfError::NotAnSmf);
    }
    let feature_ptr = read_i32(smf, OFF_FEATURE_PTR).ok_or(SmfError::Truncated)?;
    let start = usize::try_from(feature_ptr).map_err(|_| SmfError::Truncated)?;

    let type_count = read_i32(smf, start).ok_or(SmfError::Truncated)?;
    let feature_count = read_i32(smf, start + 4).ok_or(SmfError::Truncated)?;
    if type_count < 0 || feature_count < 0 {
        return Err(SmfError::Truncated);
    }

    // The names, each ending at its own NUL. A name that never ends is a
    // truncated file rather than a name that runs to the end of the map.
    let mut names: Vec<String> = Vec::with_capacity(type_count as usize);
    let mut at = start + 8;
    for _ in 0..type_count {
        let end = smf
            .get(at..)
            .and_then(|rest| rest.iter().position(|&b| b == 0))
            .ok_or(SmfError::Truncated)?;
        names.push(String::from_utf8_lossy(&smf[at..at + end]).into_owned());
        at += end + 1;
    }

    let mut placed = Vec::with_capacity(feature_count as usize);
    for index in 0..feature_count as usize {
        let record = at + index * FEATURE_RECORD;
        // The whole record has to be there, not just the four fields read out of
        // it. A file that stops halfway through one is short of what its own
        // header promised, whichever half this happens to want.
        if record
            .checked_add(FEATURE_RECORD)
            .is_none_or(|end| end > smf.len())
        {
            return Err(SmfError::Truncated);
        }
        let kind = read_i32(smf, record).ok_or(SmfError::Truncated)?;
        let x = read_f32(smf, record + 4).ok_or(SmfError::Truncated)?;
        let y = read_f32(smf, record + 8).ok_or(SmfError::Truncated)?;
        let z = read_f32(smf, record + 12).ok_or(SmfError::Truncated)?;
        // A type index outside the names is a map that disagrees with itself.
        // The feature is still somewhere, so it is kept under a name that says
        // what happened rather than dropped silently.
        let kind = usize::try_from(kind)
            .ok()
            .and_then(|index| names.get(index).cloned())
            .unwrap_or_else(|| format!("unknown-feature-type-{kind}"));
        placed.push(MapFeature { kind, x, y, z });
    }
    Ok(placed)
}

/// One `MapFeatureStruct`: an `int` type index and five `float`s, of which the
/// rotation and the relative size are not read.
const FEATURE_RECORD: usize = 4 + 5 * 4;

/// Where the fields the infomap reads need sit in `SMFHeader`.
const OFF_MAPX: usize = 24;
const OFF_MAPY: usize = 28;
const OFF_MIN_HEIGHT: usize = 44;
const OFF_MAX_HEIGHT: usize = 48;
const OFF_HEIGHTMAP_PTR: usize = 52;
const OFF_METALMAP_PTR: usize = 68;

/// The parts of an `.smf` header that say where the height and metal grids are
/// and how big they are.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SmfHeader {
    /// The map's size in squares, which is eight elmos each.
    pub mapx: u32,
    pub mapy: u32,
    /// The world heights a height word of 0 and of 65535 stand for, before any
    /// `mapinfo.lua` override.
    pub min_height: f32,
    pub max_height: f32,
    heightmap_ptr: usize,
    metalmap_ptr: usize,
}

impl SmfHeader {
    /// The height grid's size, one sample more than the squares each way, as
    /// `CSMFMapFile::GetInfoMapSize` gives it for `height`.
    pub fn height_size(&self) -> (u32, u32) {
        (self.mapx + 1, self.mapy + 1)
    }

    /// The metal grid's size, one sample per two squares, as
    /// `CSMFMapFile::GetInfoMapSize` gives it for `metal`.
    pub fn metal_size(&self) -> (u32, u32) {
        (self.mapx / 2, self.mapy / 2)
    }
}

/// Read an `.smf` header.
pub fn header(smf: &[u8]) -> Result<SmfHeader, SmfError> {
    if smf.len() < OFF_FEATURE_PTR + 4 || !smf.starts_with(MAGIC) {
        return Err(SmfError::NotAnSmf);
    }
    let size = |at| {
        read_i32(smf, at)
            .and_then(|v| u32::try_from(v).ok())
            .filter(|&v| v > 0)
            .ok_or(SmfError::Truncated)
    };
    let ptr = |at| {
        read_i32(smf, at)
            .and_then(|v| usize::try_from(v).ok())
            .ok_or(SmfError::Truncated)
    };
    Ok(SmfHeader {
        mapx: size(OFF_MAPX)?,
        mapy: size(OFF_MAPY)?,
        min_height: read_f32(smf, OFF_MIN_HEIGHT).ok_or(SmfError::Truncated)?,
        max_height: read_f32(smf, OFF_MAX_HEIGHT).ok_or(SmfError::Truncated)?,
        heightmap_ptr: ptr(OFF_HEIGHTMAP_PTR)?,
        metalmap_ptr: ptr(OFF_METALMAP_PTR)?,
    })
}

/// The height grid as little endian `u16` words, row major, the same samples
/// unitsync's `GetInfoMap "height"` gives.
pub fn heights(smf: &[u8], header: &SmfHeader) -> Result<Vec<u16>, SmfError> {
    let (w, h) = header.height_size();
    let len = w as usize * h as usize * 2;
    let bytes = smf
        .get(header.heightmap_ptr..header.heightmap_ptr.saturating_add(len))
        .ok_or(SmfError::Truncated)?;
    Ok(bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect())
}

/// The metal grid as one byte a sample, row major, the same samples unitsync's
/// `GetInfoMap "metal"` gives.
pub fn metal(smf: &[u8], header: &SmfHeader) -> Result<Vec<u8>, SmfError> {
    let (w, h) = header.metal_size();
    let len = w as usize * h as usize;
    smf.get(header.metalmap_ptr..header.metalmap_ptr.saturating_add(len))
        .map(<[u8]>::to_vec)
        .ok_or(SmfError::Truncated)
}

fn read_i32(bytes: &[u8], at: usize) -> Option<i32> {
    let four: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
    Some(i32::from_le_bytes(four))
}

fn read_f32(bytes: &[u8], at: usize) -> Option<f32> {
    let four: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
    Some(f32::from_le_bytes(four))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An `.smf` with only the header this reads and a feature block after it.
    fn smf_with(types: &[&str], placed: &[(i32, f32, f32, f32)]) -> Vec<u8> {
        let mut bytes = vec![0u8; OFF_FEATURE_PTR + 8];
        bytes[..MAGIC.len()].copy_from_slice(MAGIC);
        let feature_ptr = bytes.len() as i32;
        bytes[OFF_FEATURE_PTR..OFF_FEATURE_PTR + 4].copy_from_slice(&feature_ptr.to_le_bytes());

        bytes.extend_from_slice(&(types.len() as i32).to_le_bytes());
        bytes.extend_from_slice(&(placed.len() as i32).to_le_bytes());
        for name in types {
            bytes.extend_from_slice(name.as_bytes());
            bytes.push(0);
        }
        for (kind, x, y, z) in placed {
            bytes.extend_from_slice(&kind.to_le_bytes());
            bytes.extend_from_slice(&x.to_le_bytes());
            bytes.extend_from_slice(&y.to_le_bytes());
            bytes.extend_from_slice(&z.to_le_bytes());
            bytes.extend_from_slice(&0f32.to_le_bytes()); // rotation
            bytes.extend_from_slice(&1f32.to_le_bytes()); // relativeSize
        }
        bytes
    }

    /// An `.smf` of `mapx` by `mapy` squares with its height and metal grids
    /// after the header, each sample its own index so a misplaced read shows.
    fn smf_grids(mapx: i32, mapy: i32) -> Vec<u8> {
        let mut bytes = vec![0u8; OFF_FEATURE_PTR + 8];
        bytes[..MAGIC.len()].copy_from_slice(MAGIC);
        bytes[OFF_MAPX..OFF_MAPX + 4].copy_from_slice(&mapx.to_le_bytes());
        bytes[OFF_MAPY..OFF_MAPY + 4].copy_from_slice(&mapy.to_le_bytes());
        bytes[OFF_MIN_HEIGHT..OFF_MIN_HEIGHT + 4].copy_from_slice(&(-40f32).to_le_bytes());
        bytes[OFF_MAX_HEIGHT..OFF_MAX_HEIGHT + 4].copy_from_slice(&300f32.to_le_bytes());
        let heights_at = bytes.len() as i32;
        bytes[OFF_HEIGHTMAP_PTR..OFF_HEIGHTMAP_PTR + 4].copy_from_slice(&heights_at.to_le_bytes());
        for word in 0..((mapx + 1) * (mapy + 1)) as u16 {
            bytes.extend_from_slice(&word.to_le_bytes());
        }
        let metal_at = bytes.len() as i32;
        bytes[OFF_METALMAP_PTR..OFF_METALMAP_PTR + 4].copy_from_slice(&metal_at.to_le_bytes());
        bytes.extend((0..(mapx / 2 * mapy / 2)).map(|i| i as u8));
        bytes
    }

    #[test]
    fn reads_the_grids_the_header_points_at() {
        let smf = smf_grids(4, 2);
        let header = header(&smf).unwrap();
        assert_eq!((header.min_height, header.max_height), (-40.0, 300.0));
        assert_eq!(header.height_size(), (5, 3));
        assert_eq!(header.metal_size(), (2, 1));
        assert_eq!(
            heights(&smf, &header).unwrap(),
            (0..15).collect::<Vec<u16>>()
        );
        assert_eq!(metal(&smf, &header).unwrap(), vec![0, 1]);
    }

    #[test]
    fn a_grid_that_runs_off_the_file_is_truncated() {
        let mut smf = smf_grids(4, 2);
        smf.truncate(smf.len() - 1);
        let header = header(&smf).unwrap();
        assert_eq!(metal(&smf, &header), Err(SmfError::Truncated));
        assert!(heights(&smf, &header).is_ok());
    }

    #[test]
    fn a_header_with_no_squares_is_refused() {
        let smf = smf_grids(0, 2);
        assert_eq!(header(&smf), Err(SmfError::Truncated));
        assert_eq!(header(b"not a map"), Err(SmfError::NotAnSmf));
    }

    #[test]
    fn reads_every_feature_at_its_own_coordinates() {
        let smf = smf_with(
            &["TreeType0", "GeoVent"],
            &[
                (0, 100.0, 20.0, 200.0),
                (1, 1068.0, 45.5, 5026.0),
                (1, 5244.0, 45.5, 1047.0),
            ],
        );
        let found = features(&smf).unwrap();
        assert_eq!(found.len(), 3);
        assert_eq!(
            found[1],
            MapFeature {
                kind: "GeoVent".into(),
                x: 1068.0,
                y: 45.5,
                z: 5026.0,
            }
        );
        let vents: Vec<&MapFeature> = found.iter().filter(|f| is_geovent(&f.kind)).collect();
        assert_eq!(vents.len(), 2);
    }

    /// Half of this machine's maps place nothing, and the block still declares
    /// its type names. That is an empty answer rather than a failure.
    #[test]
    fn a_map_that_places_nothing_reads_as_no_features() {
        let smf = smf_with(&["TreeType0", "GeoVent"], &[]);
        assert_eq!(features(&smf).unwrap(), Vec::new());
    }

    /// The engine gives a default geo def to any type name containing `geovent`,
    /// so matching the exact word would miss maps the engine does not.
    #[test]
    fn a_vent_is_named_the_way_the_engine_matches_it() {
        for name in ["GeoVent", "geovent", "GEOVENT", "geovent1", "BigGeoVent"] {
            assert!(is_geovent(name), "{name}");
        }
        for name in ["TreeType0", "geo", "vent", "ad0_bushes_m_2", "GeoVen"] {
            assert!(!is_geovent(name), "{name}");
        }
    }

    /// A map whose feature block points past its own end is corrupt, and saying
    /// so beats reading whatever happens to be at that offset.
    #[test]
    fn a_block_that_runs_off_the_end_is_refused() {
        let mut smf = smf_with(&["GeoVent"], &[(0, 1.0, 2.0, 3.0)]);
        smf.truncate(smf.len() - 4);
        assert_eq!(features(&smf), Err(SmfError::Truncated));

        let mut past = smf_with(&["GeoVent"], &[]);
        past[OFF_FEATURE_PTR..OFF_FEATURE_PTR + 4].copy_from_slice(&i32::MAX.to_le_bytes());
        assert_eq!(features(&past), Err(SmfError::Truncated));
    }

    #[test]
    fn something_that_is_not_a_map_file_is_refused() {
        assert_eq!(features(b"not a map at all"), Err(SmfError::NotAnSmf));
        assert_eq!(features(&[]), Err(SmfError::NotAnSmf));
    }

    /// A feature naming a type the map did not declare keeps its position and
    /// says what it is, rather than disappearing or taking another type's name.
    #[test]
    fn a_feature_pointing_at_no_type_is_kept_and_labelled() {
        let smf = smf_with(&["GeoVent"], &[(7, 10.0, 0.0, 20.0)]);
        let found = features(&smf).unwrap();
        assert_eq!(found[0].kind, "unknown-feature-type-7");
        assert!(!is_geovent(&found[0].kind));
    }
}
