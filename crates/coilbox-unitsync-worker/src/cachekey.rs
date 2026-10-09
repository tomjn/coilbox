//! The names of the entries the worker keeps on disk, built in one place.
//!
//! Both halves of coilbox need these names. The worker writes an entry under one
//! when it reads an archive, and the plugin looks an entry up under one so it can
//! answer without starting a worker at all (issue #3714). A name built twice is a
//! name two builds can disagree about, and a disagreement is either a miss that
//! never ends or, worse, a hit on the wrong entry. So the plugin and the worker
//! both call the functions below and nothing else builds a key.
//!
//! Every key is a hash of an archive's [`ArchiveStamp`]: its path, size and
//! modified time. A changed archive has a new stamp and so a new key, which is
//! how a stale entry is never returned. The stamp is read from the file system by
//! [`ArchiveStamp::of`], and the plugin always does that itself rather than
//! trusting a size or time a caller remembers.
//!
//! The functions reproduce, byte for byte, the keys the worker wrote before they
//! lived here, so the entries already on a machine are still found. The tests
//! pin that with values taken from the old code.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Bump when the cached `GameInfoOutput` / `MapInfoOutput` / `UnitDatasetOutput`
/// shape *or* the way its contents are produced changes, so stale entries from an
/// older build are ignored. v4: game info gained the Lua-shim unit fallback. v5:
/// the unit dataset gained the per-unit `mobile` flag. v6: the unit dataset
/// gained the per-unit `objectName`. v7: unit lists no longer come back through
/// unitsync's 100,000 byte string buffer, so a big game's cached list of one
/// bogus unit has to be re-read. v8: the def-script shim now supplies
/// `Game.mapName`, so a game whose cached list is empty because its defs raised
/// on the missing field has to be re-read. v9: the unit dataset gained each
/// unit's footprint. v10: the unit dataset gained each unit's `maxSlope` and
/// whether it floats, which is what decides if a building will stand on a piece
/// of ground. v11: the unit dataset gained each unit's `minWaterDepth`,
/// `maxWaterDepth` and `waterline`, which is the other half of the same
/// question. v12: the unit dataset gained each unit's declared stats, so a
/// cached blob from before them would leave a game's whole encyclopedia blank
/// with nothing to say why. v13: a game that names its units in a localisation
/// file rather than in its unitdefs is now read (#1925), and a blob cached
/// before that holds def keys where Beyond All Reason's unit names should be.
/// v14: a read that failed outright used to be cached as though it were the
/// answer (#1927), and an install that hit one has a blob saying the game is
/// empty. Nothing but this bump gets rid of it, because the key is otherwise
/// the archive's own identity and that has not changed. v15: the unit dataset
/// gained each unit's morph targets (#2063), and a game already scanned would
/// otherwise report no morphs for ever, since the cache is keyed on file
/// identity and knows nothing about a shim change. v16: the unit-defs read
/// gained the game's `language/en/units.json` names and descriptions (#2650),
/// which a game scanned under v15 has no entry for at all. v17: that read now
/// covers every `language/<code>/units.json` the game ships and is keyed by
/// language code (#2672), so a v16 blob holds the old one-locale shape, which
/// deserialises as no translations at all rather than as English. v18: a unit
/// whose def hands its name lookup to another unit is now read under that
/// unit's key (#2686), so a blob cached under v17 holds `armcomcon` where
/// Armada Commander belongs. The payload's shape is unchanged, its contents are
/// not, and the key is otherwise the archive's own identity. v19: the game info
/// read now names its units out of the game's localisation file too, not just
/// the unit dataset (#2690), so a Beyond All Reason blob cached under either v17
/// or v18 holds a unit list with no names and four sides whose start units are
/// def keys. v20: the unit dataset now reads every numbered build option rather
/// than stopping at the first gap in the numbering, so a Tech Annihilation blob
/// cached under v19 holds builders with most of their menu missing. v21: the
/// unit-defs read now says what the game's post files changed (#3054), and a
/// blob cached under v20 has no answer, so every copy made from it would go on
/// taking the post-processed values. v22: the unit-defs read now carries the
/// game's armour classes from `gamedata/armordefs.lua` (#2645), and a blob
/// cached under v21 has none, which reads as a game with no armour classes at
/// all rather than as a field that was never asked for.
pub const INFO_CACHE_VERSION: u32 = 22;

/// Salts the unit model cache's keys and file names. Bump when the way a model
/// is flattened or a texture is transcoded changes, so every entry is read again.
/// The plugin's startup sweep reads this number too, to tell a current file from
/// an orphan.
pub const MODEL_CACHE_VERSION: u32 = 3;

/// Salts the buildpic cache key, independent of the header cache so this cache can
/// be invalidated on its own. Bump when the icon encoding, cache format, or the
/// name/buildpic *resolution logic* changes so pre-change records are re-resolved.
/// v3: nested/scripted Lua defs + legacy `.fbi` name resolution.
/// v4: uncompressed DDS decoding, and the reason an icon is missing (#1625), so
/// records written before it re-resolve rather than staying silently blank.
/// v5: the asset carries `origin` and `source_archive` (#1678), which a record
/// written before it has no way to answer.
/// v6: the icon is a PNG file named by the record rather than base64 inside it
/// (#1694), and a record written before it holds the icon nowhere else.
/// v7: `.pcx` is a candidate and decodes, so every unit a game like Expand and
/// Exterminate ships one for is cached as having no build pic at all.
pub const BUILDPIC_CACHE_VERSION: u32 = 7;

/// Salts the faction-logo cache key. Bump when the encoding, chroma-key rule, or
/// cache format changes so stale entries are ignored.
/// v2: the emblem is a PNG file named by the record rather than base64 inside it
/// (#1694), and a record written before it holds the picture nowhere else.
pub const FACTION_LOGO_CACHE_VERSION: u32 = 2;

/// Salts the header cache key. Bump when the header-art encoding changes so stale
/// entries (e.g. games rejected before downscaling existed) are invalidated and
/// re-resolved rather than served from an outdated cache. Version 3 switched the
/// hit file from base64 text to the raw JPEG the asset protocol serves.
pub const HEADER_CACHE_VERSION: u32 = 3;

/// The namespaces of the info cache, so one archive's several blobs never share
/// a name.
pub const KIND_GAME: &str = "game";
pub const KIND_DATASET: &str = "unitdataset";
pub const KIND_MAP: &str = "map";
pub const KIND_MAP_META: &str = "mapmeta";
const KIND_ARCHIVE_HASH: &str = "maphash";
const KIND_SKIRMISH_ENGINE: &str = "skirmishai-engine";
const KIND_SKIRMISH_GAME: &str = "skirmishai-game";

/// What identifies one archive on disk at one moment: where it is, how big it is
/// and when it was last changed.
///
/// A directory archive (`.sdd`) reports its directory entry's size and time, not
/// a total of what is inside, exactly as the worker always has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveStamp {
    path: PathBuf,
    size: u64,
    mtime: u64,
}

impl ArchiveStamp {
    /// A stamp from values already in hand. The tests use it, and nothing
    /// outside them should: a size or time that did not come from the file system
    /// just now is how a stale entry gets returned.
    pub fn new(path: impl Into<PathBuf>, size: u64, mtime: u64) -> Self {
        Self {
            path: path.into(),
            size,
            mtime,
        }
    }

    /// Stat `path`. `None` when it cannot be read, which means no key and so no
    /// cached answer.
    pub fn of(path: &Path) -> Option<Self> {
        let md = std::fs::metadata(path).ok()?;
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Some(Self::new(path, md.len(), mtime))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn mtime(&self) -> u64 {
        self.mtime
    }
}

/// The hash every file identity key is made of: an optional salt, an optional
/// namespace, then the stamp. Which of the first two a family of keys has is part
/// of its name on disk, so it cannot be tidied into one shape.
fn stamp_hash(salt: Option<u32>, kind: Option<&str>, stamp: &ArchiveStamp) -> String {
    let mut h = DefaultHasher::new();
    if let Some(salt) = salt {
        salt.hash(&mut h);
    }
    if let Some(kind) = kind {
        kind.hash(&mut h);
    }
    stamp.path.hash(&mut h);
    stamp.size.hash(&mut h);
    stamp.mtime.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// An info cache key: the cache version, the namespace and the stamp.
fn info_key(stamp: &ArchiveStamp, kind: &str) -> String {
    stamp_hash(Some(INFO_CACHE_VERSION), Some(kind), stamp)
}

/// A game's info blob.
pub fn game_key(stamp: &ArchiveStamp) -> String {
    info_key(stamp, KIND_GAME)
}

/// A game's reusable unit dataset blob, apart from `game_key` so the two for one
/// archive never collide.
pub fn dataset_key(stamp: &ArchiveStamp) -> String {
    info_key(stamp, KIND_DATASET)
}

/// The sha256 of a map archive's own bytes, which is the catalog's `source_hash`
/// (issue #1737).
pub fn archive_hash_key(stamp: &ArchiveStamp) -> String {
    info_key(stamp, KIND_ARCHIVE_HASH)
}

/// The key built from a map's versioned name and the map file inside its
/// archive. Costs no stat and no hash of the archive. A new release of a map
/// carries a new versioned name, so the key changes with it. In practice this is
/// the key almost every map has, because the archive path does not resolve for a
/// map's versioned name.
fn map_name_key(kind: &str, map_name: &str, file_name: &str) -> String {
    let mut h = DefaultHasher::new();
    INFO_CACHE_VERSION.hash(&mut h);
    kind.hash(&mut h);
    map_name.hash(&mut h);
    file_name.hash(&mut h);
    format!("n{:016x}", h.finish())
}

/// The shared map identity: the archive's stamp where it resolves, otherwise the
/// map's versioned name with its file name. `None` when neither is known.
fn map_identity(
    kind: &str,
    archive: Option<&ArchiveStamp>,
    map_name: &str,
    file_name: Option<&str>,
) -> Option<String> {
    match archive {
        Some(stamp) => Some(info_key(stamp, kind)),
        None => file_name.map(|file| map_name_key(kind, map_name, file)),
    }
}

/// A map's info blob (its options and checksum).
pub fn map_info_key(
    archive: Option<&ArchiveStamp>,
    map_name: &str,
    file_name: Option<&str>,
) -> Option<String> {
    map_identity(KIND_MAP, archive, map_name, file_name)
}

/// A map's `mapinfo` metadata blob, apart from `map_info_key`.
pub fn map_meta_key(
    archive: Option<&ArchiveStamp>,
    map_name: &str,
    file_name: Option<&str>,
) -> Option<String> {
    map_identity(KIND_MAP_META, archive, map_name, file_name)
}

/// A skirmish AI list: the engine library's stamp, because the native AIs ship
/// with the engine, and the game archive's when a game is given, because its Lua
/// AIs ship with the game.
pub fn skirmish_key(engine: &ArchiveStamp, game: Option<&ArchiveStamp>) -> String {
    let engine = stamp_hash(Some(INFO_CACHE_VERSION), Some(KIND_SKIRMISH_ENGINE), engine);
    let game = match game {
        Some(stamp) => stamp_hash(Some(INFO_CACHE_VERSION), Some(KIND_SKIRMISH_GAME), stamp),
        None => String::new(),
    };
    let mut h = DefaultHasher::new();
    INFO_CACHE_VERSION.hash(&mut h);
    "skirmishai".hash(&mut h);
    engine.hash(&mut h);
    game.hash(&mut h);
    format!("a{:016x}", h.finish())
}

/// The name a map's pictures and their records go under in the thumbnail cache:
/// the archive's stamp where it resolves, otherwise the map's versioned name and
/// file name. Neither route hashes an archive, so keying a whole library costs
/// nothing.
///
/// No salt and no namespace, unlike the info cache, because the thumbnail cache
/// has always been keyed this way and its file names carry the rest.
pub fn thumb_key(
    archive: Option<&ArchiveStamp>,
    map_name: &str,
    file_name: Option<&str>,
) -> Option<String> {
    match archive {
        Some(stamp) => Some(stamp_hash(None, None, stamp)),
        None => file_name.map(|file| {
            let mut h = DefaultHasher::new();
            map_name.hash(&mut h);
            file.hash(&mut h);
            format!("n{:016x}", h.finish())
        }),
    }
}

/// The base every unit model cache file under one game is named after.
pub fn model_key(stamp: &ArchiveStamp) -> String {
    stamp_hash(Some(MODEL_CACHE_VERSION), None, stamp)
}

/// The base every build icon record under one game is named after.
pub fn buildpic_key(stamp: &ArchiveStamp) -> String {
    stamp_hash(Some(BUILDPIC_CACHE_VERSION), None, stamp)
}

/// The base every faction logo record under one game is named after.
pub fn faction_logo_key(stamp: &ArchiveStamp) -> String {
    stamp_hash(Some(FACTION_LOGO_CACHE_VERSION), None, stamp)
}

/// The name a game's header art goes under.
pub fn header_key(stamp: &ArchiveStamp) -> String {
    stamp_hash(Some(HEADER_CACHE_VERSION), None, stamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every expected value below was produced by the worker's own key code before
    // it moved here, over a game archive of 14 bytes and a map archive of 13, both
    // modified at 1_700_000_000, under /tmp/coilbox-golden-keys. If one of these
    // changes, every entry already on a user's machine stops being found.

    fn game() -> ArchiveStamp {
        ArchiveStamp::new("/tmp/coilbox-golden-keys/stubgame.sdz", 14, 1_700_000_000)
    }

    fn map() -> ArchiveStamp {
        ArchiveStamp::new(
            "/tmp/coilbox-golden-keys/stubmap_1.0.sd7",
            13,
            1_700_000_000,
        )
    }

    const MAP_NAME: &str = "Stub Map 1.0";
    const MAP_FILE: &str = "maps/stubmap.smf";

    #[test]
    fn a_game_s_keys_are_the_ones_the_worker_wrote_before() {
        assert_eq!(game_key(&game()), "96202fcd28ac89f7");
        assert_eq!(dataset_key(&game()), "7eaabd86d63659c8");
        assert_eq!(archive_hash_key(&game()), "8543c7e39470f71b");
        assert_eq!(model_key(&game()), "7628cfa0c7249680");
        assert_eq!(buildpic_key(&game()), "cfd53b8ab59cbad7");
        assert_eq!(faction_logo_key(&game()), "3424bfae2fdee0a1");
        assert_eq!(header_key(&game()), "7628cfa0c7249680");
    }

    #[test]
    fn a_map_with_an_archive_path_keys_on_the_archive() {
        let map = map();
        assert_eq!(
            map_info_key(Some(&map), MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("3954fc75efc10b84")
        );
        assert_eq!(
            map_meta_key(Some(&map), MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("97f311d3684d40ec")
        );
        assert_eq!(
            thumb_key(Some(&map), MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("0dde0cbf4435cd1d")
        );
    }

    #[test]
    fn a_map_with_no_archive_path_keys_on_its_name_and_file() {
        assert_eq!(
            map_info_key(None, MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("ned22ce8007f0c2be")
        );
        assert_eq!(
            map_meta_key(None, MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("ne74c9ad9aa44dd4b")
        );
        assert_eq!(
            thumb_key(None, MAP_NAME, Some(MAP_FILE)).as_deref(),
            Some("n8d63f7c9a99a50dc")
        );
    }

    #[test]
    fn a_map_with_neither_has_no_key() {
        assert_eq!(map_info_key(None, MAP_NAME, None), None);
        assert_eq!(map_meta_key(None, MAP_NAME, None), None);
        assert_eq!(thumb_key(None, MAP_NAME, None), None);
    }

    #[test]
    fn a_skirmish_list_keys_on_the_engine_and_the_game() {
        let engine = ArchiveStamp::new(
            "/tmp/coilbox-golden-keys/stubmap_1.0.sd7",
            13,
            1_700_000_000,
        );
        assert_eq!(skirmish_key(&engine, Some(&game())), "ac3409f42819b3c1f");
        assert_eq!(skirmish_key(&engine, None), "a3c95f63fc6b5a3c2");
    }

    #[test]
    fn a_changed_size_or_time_is_a_different_key() {
        let before = game();
        let grown = ArchiveStamp::new(before.path(), before.size() + 1, before.mtime());
        let touched = ArchiveStamp::new(before.path(), before.size(), before.mtime() + 1);
        assert_ne!(game_key(&before), game_key(&grown));
        assert_ne!(game_key(&before), game_key(&touched));
        assert_ne!(model_key(&before), model_key(&grown));
        assert_ne!(
            thumb_key(Some(&before), MAP_NAME, None),
            thumb_key(Some(&touched), MAP_NAME, None)
        );
    }

    #[test]
    fn a_stamp_read_from_disk_carries_the_files_size_and_time() {
        let dir = std::env::temp_dir().join(format!("coilbox-cachekey-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let file = dir.join("a.sdz");
        std::fs::write(&file, b"seven b").expect("write");

        let stamp = ArchiveStamp::of(&file).expect("a stamp");
        assert_eq!(stamp.size(), 7);
        assert_eq!(stamp.path(), file);
        assert!(ArchiveStamp::of(&dir.join("missing.sdz")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
