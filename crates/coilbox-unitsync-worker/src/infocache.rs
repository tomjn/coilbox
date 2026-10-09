//! Disk cache for the lazy game/map *info* blobs (sides, options, and the sync
//! checksum). Keyed on cheap file identity (the item's own archive path + size +
//! mtime), exactly like the minimap and game-header caches — so building a key
//! needs only `Init`, and a cache hit skips the expensive `AddAllArchives` +
//! whole-archive checksum hash that dominates these calls.
//!
//! Only a read that answered is written, so a failure is not remembered and a
//! retry genuinely re-runs it. `dataset::worth_caching` decides what counts.
//!
//! Keying on the item's own archive shares the header/minimap caches' limitation:
//! a changed *dependency* archive won't invalidate the entry (its own file
//! identity is unchanged). A rescan / new archive version busts it; bump
//! `INFO_CACHE_VERSION` when the cached struct shape changes.

use crate::ffi::Unitsync;
use coilbox_unitsync_worker::cachekey::{self, ArchiveStamp, INFO_CACHE_VERSION};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::hash::{Hash, Hasher};
use std::path::Path;

/// The stamp of an archive unitsync knows by file name: where `GetArchivePath`
/// says it lives, statted. `None` when the name does not resolve or the file is
/// gone, which disables caching for it.
pub(crate) fn archive_stamp(us: &Unitsync, archive: &str) -> Option<ArchiveStamp> {
    let dir = us.archive_path(archive)?;
    ArchiveStamp::of(&Path::new(&dir).join(archive))
}

/// Cache identity for a game's info blob: its primary archive's path + size +
/// mtime. `None` (archive doesn't resolve or stat fails) disables caching.
pub fn game_key(us: &Unitsync, game_archive: &str) -> Option<String> {
    Some(cachekey::game_key(&archive_stamp(us, game_archive)?))
}

/// Cache identity for a game's reusable unit-dataset blob: its primary archive's
/// path + size + mtime, in the `unitdataset` namespace (distinct from `game`, so
/// the dataset and game-info blobs for the same archive never collide).
pub fn dataset_key(us: &Unitsync, game_archive: &str) -> Option<String> {
    Some(cachekey::dataset_key(&archive_stamp(us, game_archive)?))
}

/// Cache identity for a game's full unit definitions: the game's sync checksum,
/// in the `unitdefs` namespace (issue #1269).
///
/// The one key here that is not file identity, and deliberately so. A full def
/// read walks the game's whole dependency chain, so a changed dependency
/// changes the answer while the primary archive's size and mtime sit still, and
/// file identity would keep handing back the old defs for ever. The sync
/// checksum is the value the engine already computes over the archive plus
/// every dependency, so it is the identity this dataset actually has.
///
/// The caller has no key at all when the checksum is unknown, which is the
/// right outcome: nothing is remembered rather than something remembered under
/// an identity that cannot change.
pub fn unitdefs_key(game_archive: &str, checksum: &str) -> String {
    checksum_key(game_archive, checksum, "unitdefs", 'u')
}

/// Cache identity for a game's custom parameter consumer index: the game's sync
/// checksum, in the `customparams` namespace (issue #2661).
///
/// Keyed like the unit defs above and for the same reason. The scan reads every
/// Lua file the game's archive set mounts, so a changed dependency changes the
/// answer while the primary archive's size and mtime sit still.
pub fn custom_params_key(game_archive: &str, checksum: &str) -> String {
    checksum_key(game_archive, checksum, "customparams", 'c')
}

/// The shared body of the checksum-keyed identities above: the cache version,
/// the namespace, the archive and the checksum, behind a one-letter prefix that
/// keeps them apart from the file-identity keys.
fn checksum_key(game_archive: &str, checksum: &str, kind: &str, prefix: char) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    INFO_CACHE_VERSION.hash(&mut h);
    kind.hash(&mut h);
    game_archive.hash(&mut h);
    checksum.hash(&mut h);
    format!("{prefix}{:016x}", h.finish())
}

/// Cache identity for a map's info blob: its own archive's path + size + mtime,
/// falling back to the map's versioned name when that path won't resolve.
///
/// The fallback is the usual case, not the exception. `GetMapArchiveName` reports
/// a map's archives under versioned human names ("AcidicQuarry 5.17") while
/// `GetArchivePath` looks up file names ("acidicquarry_5.17.sd7"), so without it
/// this returns `None` for most maps and the cache never engages.
pub fn map_key(us: &Unitsync, map_name: &str) -> Option<String> {
    map_identity(us, map_name, cachekey::map_info_key)
}

/// Cache identity for a map's `mapinfo` metadata blob, in the `mapmeta` namespace
/// so it never collides with the `map` options blob for the same archive.
pub fn map_meta_key(us: &Unitsync, map_name: &str) -> Option<String> {
    map_identity(us, map_name, cachekey::map_meta_key)
}

/// The stamp of a map's own archive, where its path resolves.
pub(crate) fn map_archive_stamp(us: &Unitsync, map_name: &str) -> Option<ArchiveStamp> {
    let archive = us.map_archives(map_name).into_iter().next()?;
    archive_stamp(us, &archive)
}

/// The map file inside a map's archive, which the name based key is made from.
pub(crate) fn map_file_name(us: &Unitsync, map_name: &str) -> Option<String> {
    us.map_file_name(crate::minimap::map_index(us, map_name)?)
}

/// Shared map identity: archive file identity where the path resolves, otherwise
/// the versioned name. The map file's name is only looked up when the archive
/// does not resolve, because finding it walks the map list.
fn map_identity(
    us: &Unitsync,
    map_name: &str,
    key: fn(Option<&ArchiveStamp>, &str, Option<&str>) -> Option<String>,
) -> Option<String> {
    match map_archive_stamp(us, map_name) {
        Some(stamp) => key(Some(&stamp), map_name, None),
        None => key(None, map_name, map_file_name(us, map_name).as_deref()),
    }
}

/// Cache identity for a skirmish AI list: the engine library's file identity,
/// because the native AIs ship with the engine, plus the game archive's when a
/// game is given, because its Lua AIs and its `validais.lua` ship with the
/// game. `None` when the game is named but its archive will not resolve, so a
/// list read against the wrong archive is never remembered.
pub fn skirmish_key(us: &Unitsync, lib: &Path, game_archive: Option<&str>) -> Option<String> {
    let engine = ArchiveStamp::of(lib)?;
    let game = match game_archive.filter(|g| !g.is_empty()) {
        Some(g) => Some(archive_stamp(us, g)?),
        None => None,
    };
    Some(cachekey::skirmish_key(&engine, game.as_ref()))
}

/// Cache identity for the sha256 of a map archive's own bytes, which is what the
/// catalog's `source_hash` is (issue #1737).
///
/// The same file identity everything else here is keyed on, in its own
/// namespace. Hashing a map library is reading every byte of it, tens of
/// gigabytes on a full collection, and the answer only moves when the file does,
/// so a sweep that finds nothing changed should cost no reads at all.
pub fn archive_hash_key(path: &Path) -> Option<String> {
    Some(cachekey::archive_hash_key(&ArchiveStamp::of(path)?))
}

/// Read and deserialize a cached blob, or `None` on miss / parse error.
pub fn read<T: DeserializeOwned>(dir: &Path, key: &str) -> Option<T> {
    let raw = std::fs::read(dir.join(format!("{key}.json"))).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Best-effort write of a blob as JSON. Failures (unwritable cache dir) are
/// swallowed — caching is an optimization, never required for correctness.
pub fn write<T: Serialize>(dir: &Path, key: &str, val: &T) {
    let _ = std::fs::create_dir_all(dir);
    if let Ok(bytes) = serde_json::to_vec(val) {
        let _ = std::fs::write(dir.join(format!("{key}.json")), bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MapInfoOutput;

    #[test]
    fn read_miss_then_hit_round_trips() {
        let dir =
            std::env::temp_dir().join(format!("coilbox-infocache-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(read::<MapInfoOutput>(&dir, "k").is_none());

        let out = MapInfoOutput {
            checksum: Some("deadbeef".into()),
            ..Default::default()
        };
        write(&dir, "k", &out);
        let back: MapInfoOutput = read(&dir, "k").expect("cache hit");
        assert_eq!(back.checksum.as_deref(), Some("deadbeef"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn namespaces_keep_one_archive_from_colliding_across_kinds() {
        let dir = std::env::temp_dir().join(format!("coilbox-infocache-ns-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("shared.sdz");
        std::fs::write(&path, b"archive").expect("write archive");

        let stamp = ArchiveStamp::of(&path).expect("a stamp");
        let game = cachekey::game_key(&stamp);
        let map = cachekey::map_info_key(Some(&stamp), "m", None).expect("map key");
        let dataset = cachekey::dataset_key(&stamp);
        assert_ne!(game, map);
        assert_ne!(game, dataset);
        assert_ne!(map, dataset);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_game_checksum_is_a_new_unitdefs_key() {
        let before = unitdefs_key("BAR.sdd", "deadbeef");
        let after = unitdefs_key("BAR.sdd", "cafef00d");
        assert_ne!(before, after, "a game update has to miss the cache");
        assert_eq!(before, unitdefs_key("BAR.sdd", "deadbeef"));
        assert_ne!(
            before,
            unitdefs_key("XTA.sdz", "deadbeef"),
            "two games that hash the same must not share an entry"
        );
    }

    #[test]
    fn a_new_game_checksum_is_a_new_custom_params_key() {
        let before = custom_params_key("BAR.sdd", "deadbeef");
        assert_ne!(
            before,
            custom_params_key("BAR.sdd", "cafef00d"),
            "a game update has to rescan its Lua"
        );
        assert_ne!(
            before,
            unitdefs_key("BAR.sdd", "deadbeef"),
            "the defs and the consumer index must not share an entry"
        );
    }

    #[test]
    fn a_missing_archive_has_no_identity() {
        let missing = std::env::temp_dir().join("coilbox-infocache-does-not-exist.sdz");
        assert!(archive_hash_key(&missing).is_none());
    }
}
