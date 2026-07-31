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

/// Cache identity for a map's info blob: its own archive's path + size + mtime.
/// `None` (no resolvable archive or stat fails) disables caching.
pub fn map_key(us: &Unitsync, map_name: &str) -> Option<String> {
    let archive = us.map_archives(map_name).into_iter().next()?;
    let dir = us.archive_path(&archive)?;
    identity(&Path::new(&dir).join(&archive), "map")
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
}
