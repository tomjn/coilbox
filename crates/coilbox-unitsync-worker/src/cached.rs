//! Answers read straight off disk, with no unitsync and no worker (issue #3714).
//!
//! The worker writes an entry the first time it reads an archive. Everything here
//! finds that entry again from what the caller already knows about the archive,
//! so the plugin can answer a repeat read itself. The key is built by
//! [`crate::cachekey`], the same code the worker writes it with.
//!
//! Each function answers `None` for anything short of a whole, current answer: no
//! key, no entry, an entry that does not parse, an entry a newer or older build
//! wrote, or a file the entry points at that has gone. `None` is always safe, it
//! only sends the caller to a worker, which reads the archive and writes the
//! entry again.
//!
//! The archive is always statted here, never described by the caller. An archive
//! changed since the entry was written has a different size or time, so a
//! different key, so no entry: it cannot be answered from the old one.

use crate::cachekey::{self, ArchiveStamp};
use serde_json::Value;
use std::path::Path;

/// A cached info blob, exactly as the worker wrote it. Anything that is not a
/// JSON object is not an answer.
///
/// Handed back as JSON rather than as the type it was written from, because the
/// plugin passes it straight on to the page and a round trip through the type
/// could only lose what the type does not name.
pub fn info_blob(dir: &Path, key: &str) -> Option<Value> {
    let raw = std::fs::read(dir.join(format!("{key}.json"))).ok()?;
    let value: Value = serde_json::from_slice(&raw).ok()?;
    value.is_object().then_some(value)
}

/// A game's info (its sides, unit count and sync checksum). `archive` is the
/// game's primary archive, as a path.
pub fn game_info(dir: &Path, archive: &Path) -> Option<Value> {
    let stamp = ArchiveStamp::of(archive)?;
    info_blob(dir, &cachekey::game_key(&stamp))
}

/// A game's unit dataset.
pub fn unit_dataset(dir: &Path, archive: &Path) -> Option<Value> {
    let stamp = ArchiveStamp::of(archive)?;
    info_blob(dir, &cachekey::dataset_key(&stamp))
}

/// A map's options and checksum.
///
/// `archive` is the map's own archive where its path resolved when the library
/// was scanned, which is almost never. `file_name` is the map file inside it, as
/// the scan reported it, and is what the usual name based key is made from.
pub fn map_info(
    dir: &Path,
    map_name: &str,
    archive: Option<&Path>,
    file_name: Option<&str>,
) -> Option<Value> {
    let key = cachekey::map_info_key(
        archive.and_then(ArchiveStamp::of).as_ref(),
        map_name,
        file_name,
    )?;
    info_blob(dir, &key)
}

/// The skirmish AIs available against an engine and, when one is named, a game.
/// `game` is that game's archive. The caller has no answer to look for when a
/// game is named and its archive is not known.
pub fn skirmish_ais(dir: &Path, engine_lib: &Path, game: Option<&Path>) -> Option<Value> {
    let engine = ArchiveStamp::of(engine_lib)?;
    let game = match game {
        Some(path) => Some(ArchiveStamp::of(path)?),
        None => None,
    };
    info_blob(dir, &cachekey::skirmish_key(&engine, game.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("coilbox-cached-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn write_blob(dir: &Path, key: &str, json: &str) {
        std::fs::write(dir.join(format!("{key}.json")), json).expect("write blob");
    }

    #[test]
    fn an_entry_under_the_archives_key_is_found() {
        let dir = temp_dir("game-hit");
        let archive = dir.join("game.sdz");
        std::fs::write(&archive, b"a game").expect("archive");
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        write_blob(
            &dir,
            &cachekey::game_key(&stamp),
            r#"{"sides":[],"checksum":"ab"}"#,
        );

        let hit = game_info(&dir, &archive).expect("a hit");
        assert_eq!(hit["checksum"], "ab");
        assert!(unit_dataset(&dir, &archive).is_none(), "another namespace");
    }

    #[test]
    fn a_changed_archive_is_not_answered_from_the_old_entry() {
        let dir = temp_dir("changed");
        let archive = dir.join("game.sdz");
        std::fs::write(&archive, b"a game").expect("archive");
        let stamp = ArchiveStamp::of(&archive).expect("stamp");
        write_blob(&dir, &cachekey::game_key(&stamp), r#"{"checksum":"old"}"#);
        assert!(game_info(&dir, &archive).is_some());

        std::fs::write(&archive, b"a longer game archive").expect("rewrite");
        assert!(game_info(&dir, &archive).is_none());
    }

    #[test]
    fn a_missing_archive_has_no_answer() {
        let dir = temp_dir("missing");
        assert!(game_info(&dir, &dir.join("gone.sdz")).is_none());
    }

    #[test]
    fn a_blob_that_does_not_parse_is_a_miss() {
        let dir = temp_dir("corrupt");
        write_blob(&dir, "k", "{ not json");
        assert!(info_blob(&dir, "k").is_none());
        write_blob(&dir, "k", "[1,2]");
        assert!(info_blob(&dir, "k").is_none(), "an array is not an answer");
    }

    #[test]
    fn a_map_is_found_by_name_when_it_has_no_archive_path() {
        let dir = temp_dir("map-name");
        let key = cachekey::map_info_key(None, "Some Map 1.0", Some("maps/some.smf")).unwrap();
        write_blob(&dir, &key, r#"{"options":[],"checksum":"cd"}"#);

        let hit = map_info(&dir, "Some Map 1.0", None, Some("maps/some.smf")).expect("a hit");
        assert_eq!(hit["checksum"], "cd");
        assert!(map_info(&dir, "Some Map 1.0", None, None).is_none());
        assert!(map_info(&dir, "Some Map 1.1", None, Some("maps/some.smf")).is_none());
    }

    #[test]
    fn a_map_with_an_archive_path_that_is_gone_falls_back_to_its_name() {
        let dir = temp_dir("map-gone");
        let key = cachekey::map_info_key(None, "Some Map 1.0", Some("maps/some.smf")).unwrap();
        write_blob(&dir, &key, r#"{"checksum":"cd"}"#);

        let gone = dir.join("gone.sd7");
        assert!(map_info(&dir, "Some Map 1.0", Some(&gone), Some("maps/some.smf")).is_some());
    }

    #[test]
    fn a_skirmish_list_needs_the_engine_and_a_named_games_archive() {
        let dir = temp_dir("skirmish");
        let lib = dir.join("libunitsync.so");
        let game = dir.join("game.sdz");
        std::fs::write(&lib, b"engine").expect("lib");
        std::fs::write(&game, b"game").expect("game");
        let engine = ArchiveStamp::of(&lib).unwrap();
        let game_stamp = ArchiveStamp::of(&game).unwrap();
        write_blob(
            &dir,
            &cachekey::skirmish_key(&engine, None),
            r#"{"ais":[]}"#,
        );
        write_blob(
            &dir,
            &cachekey::skirmish_key(&engine, Some(&game_stamp)),
            r#"{"ais":[{"shortName":"x"}]}"#,
        );

        assert_eq!(
            skirmish_ais(&dir, &lib, None).unwrap()["ais"],
            serde_json::json!([])
        );
        assert_eq!(
            skirmish_ais(&dir, &lib, Some(&game)).unwrap()["ais"][0]["shortName"],
            "x"
        );
        assert!(skirmish_ais(&dir, &lib, Some(&dir.join("gone.sdz"))).is_none());
    }
}
