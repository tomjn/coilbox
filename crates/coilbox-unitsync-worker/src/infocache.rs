//! Disk cache for the lazy game/map *info* blobs (sides, options, and the sync
//! checksum). Keyed on cheap file identity (the item's own archive path + size +
//! mtime), exactly like the minimap and game-header caches — so building a key
//! needs only `Init`, and a cache hit skips the expensive `AddAllArchives` +
//! whole-archive checksum hash that dominates these calls.
//!
//! Only fully-resolved results (a checksum actually computed) are written, so a
//! failed hash isn't cached and a retry genuinely re-runs it.
//!
//! Keying on the item's own archive shares the header/minimap caches' limitation:
//! a changed *dependency* archive won't invalidate the entry (its own file
//! identity is unchanged). A rescan / new archive version busts it; bump
//! `INFO_CACHE_VERSION` when the cached struct shape changes.

use crate::ffi::Unitsync;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::hash::{Hash, Hasher};
use std::path::Path;

/// Bump when the cached `GameInfoOutput` / `MapInfoOutput` / `UnitDatasetOutput`
/// shape *or* the way its contents are produced changes, so stale entries from an
/// older build are ignored. v4: game info gained the Lua-shim unit fallback. v5:
/// the unit dataset gained the per-unit `mobile` flag. v6: the unit dataset
/// gained the per-unit `objectName`. v7: unit lists no longer come back through
/// unitsync's 100,000 byte string buffer, so a big game's cached list of one
/// bogus unit has to be re-read. v8: the def-script shim now supplies
/// `Game.mapName`, so a game whose cached list is empty because its defs raised
/// on the missing field has to be re-read.
const INFO_CACHE_VERSION: u32 = 8;

/// Cache identity for a game's info blob: its primary archive's path + size +
/// mtime. `None` (archive doesn't resolve or stat fails) disables caching.
pub fn game_key(us: &Unitsync, game_archive: &str) -> Option<String> {
    let dir = us.archive_path(game_archive)?;
    identity(&Path::new(&dir).join(game_archive), "game")
}

/// Cache identity for a game's reusable unit-dataset blob: its primary archive's
/// path + size + mtime, in the `unitdataset` namespace (distinct from `game`, so
/// the dataset and game-info blobs for the same archive never collide).
pub fn dataset_key(us: &Unitsync, game_archive: &str) -> Option<String> {
    let dir = us.archive_path(game_archive)?;
    identity(&Path::new(&dir).join(game_archive), "unitdataset")
}

/// Cache identity for a map's info blob: its own archive's path + size + mtime,
/// falling back to the map's versioned name when that path won't resolve.
///
/// The fallback is the usual case, not the exception. `GetMapArchiveName` reports
/// a map's archives under versioned human names ("AcidicQuarry 5.17") while
/// `GetArchivePath` looks up file names ("acidicquarry_5.17.sd7"), so without it
/// this returns `None` for most maps and the cache never engages.
pub fn map_key(us: &Unitsync, map_name: &str) -> Option<String> {
    map_identity(us, map_name, "map")
}

/// Cache identity for a map's `mapinfo` metadata blob, in the `mapmeta` namespace
/// so it never collides with the `map` options blob for the same archive.
pub fn map_meta_key(us: &Unitsync, map_name: &str) -> Option<String> {
    map_identity(us, map_name, "mapmeta")
}

/// Shared map identity: archive file identity where the path resolves, otherwise
/// the versioned name.
fn map_identity(us: &Unitsync, map_name: &str, kind: &str) -> Option<String> {
    us.map_archives(map_name)
        .into_iter()
        .next()
        .and_then(|archive| {
            let dir = us.archive_path(&archive)?;
            identity(&Path::new(&dir).join(&archive), kind)
        })
        .or_else(|| name_identity(us, map_name, kind))
}

/// Cache identity from the map's versioned name plus the map file inside its
/// archive. Costs no stat and no hash of the archive itself. A new release of a
/// map carries a new versioned name, so the key changes with it.
fn name_identity(us: &Unitsync, map_name: &str, kind: &str) -> Option<String> {
    let index = crate::minimap::map_index(us, map_name)?;
    let file = us.map_file_name(index)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    INFO_CACHE_VERSION.hash(&mut h);
    kind.hash(&mut h);
    map_name.hash(&mut h);
    file.hash(&mut h);
    Some(format!("n{:016x}", h.finish()))
}

/// Hash a resolved archive path's file identity into a stable cache key. `kind`
/// separates the game and map namespaces so an archive can't collide across them.
fn identity(path: &Path, kind: &str) -> Option<String> {
    let md = std::fs::metadata(path).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    INFO_CACHE_VERSION.hash(&mut h);
    kind.hash(&mut h);
    path.hash(&mut h);
    md.len().hash(&mut h);
    mtime.hash(&mut h);
    Some(format!("{:016x}", h.finish()))
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

        let game = identity(&path, "game").expect("game key");
        let map = identity(&path, "map").expect("map key");
        let dataset = identity(&path, "unitdataset").expect("dataset key");
        assert_ne!(game, map);
        assert_ne!(game, dataset);
        assert_ne!(map, dataset);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_archive_has_no_identity() {
        let missing = std::env::temp_dir().join("coilbox-infocache-does-not-exist.sdz");
        assert!(identity(&missing, "map").is_none());
    }
}
