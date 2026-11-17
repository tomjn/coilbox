//! Reads the facts the hub asks for before it takes one map or game archive as
//! an upload (issue #5257). The shape and the rules are in
//! [`coilbox_unitsync_worker::uploadfacts`]. This is the half that needs unitsync.
//!
//! A map's facts come the way the map catalog reads them (`mapcatalog`), so the
//! `internal_name` is the string the hub already holds as that map's name, which
//! the hub's map page matches on. The archive's hash is the catalog's
//! `source_hash` and shares its cache. A game's hash is over its primary
//! archive alone, not its dependencies, and shares the same cache keyed on the
//! archive's path, size and modified time.
//!
//! A game's `internal_name` is the name `archive_name_for_game` gives, the name
//! a start script uses. For a build such as Beyond All Reason's that name
//! already ends in the version, so `internal_name` plus `version` repeats the
//! version. It is stable, which is all the hub's duplicate check needs.

use std::path::Path;

use coilbox_unitsync_worker::uploadfacts::{UploadFacts, UploadFactsOutput, UploadKind};

use crate::mapcatalog::{self, MapCatalogSkip};

/// What the archive says about itself, before the file is hashed.
struct Identity {
    internal_name: String,
    version: String,
    shortname: Option<String>,
    author: Option<String>,
    description: Option<String>,
}

/// The facts for the archive file at `path`, or the sentence that says why not.
///
/// Hashes the file, then checks the result against the hub's rules, so what comes
/// back is something the hub will accept.
fn assemble(
    path: &str,
    kind: UploadKind,
    identity: Identity,
    cache_dir: Option<&Path>,
) -> Result<UploadFacts, String> {
    let file = Path::new(path);
    let filename = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("The archive's file name is not valid text: {path}"))?
        .to_string();
    let size = std::fs::metadata(file)
        .map_err(|e| format!("Could not read the archive file {path}: {e}"))?
        .len();
    let sha256 = mapcatalog::cached_hash(path, cache_dir)
        .ok_or_else(|| format!("Could not read the archive file {path} to hash it."))?;
    let facts = UploadFacts {
        sha256,
        size,
        filename,
        kind,
        internal_name: identity.internal_name.trim().to_string(),
        version: identity.version.trim().to_string(),
        shortname: identity.shortname,
        author: identity.author,
        description: identity.description,
    };
    facts.check()?;
    Ok(facts)
}

/// An answer that is a refusal in words.
pub(crate) fn problem(said: String) -> UploadFactsOutput {
    UploadFactsOutput {
        problem: Some(said),
        ..Default::default()
    }
}

fn answer(
    assembled: Result<(UploadFacts, String), String>,
    errors: Vec<String>,
) -> UploadFactsOutput {
    match assembled {
        Ok((facts, path)) => UploadFactsOutput {
            facts: Some(facts),
            path: Some(path),
            errors,
            ..Default::default()
        },
        Err(said) => UploadFactsOutput {
            problem: Some(said),
            errors,
            ..Default::default()
        },
    }
}

/// Which map to read: the one unitsync names, or the one an archive file holds.
enum MapSelector<'a> {
    Name(&'a str),
    ArchiveFile(&'a str),
}

/// One map's facts, in a session of its own.
pub fn read_map(lib: &str, map_name: &str, cache_dir: Option<&Path>) -> UploadFactsOutput {
    read_map_selected(lib, MapSelector::Name(map_name), cache_dir)
}

/// The facts of the map in the archive file called `file_name` under `maps/`,
/// whatever it is named inside. For a file that was just downloaded and may not
/// be the map it was said to be.
pub fn read_map_archive(lib: &str, file_name: &str, cache_dir: Option<&Path>) -> UploadFactsOutput {
    read_map_selected(lib, MapSelector::ArchiveFile(file_name), cache_dir)
}

fn read_map_selected(
    lib: &str,
    selector: MapSelector<'_>,
    cache_dir: Option<&Path>,
) -> UploadFactsOutput {
    let us = match unsafe { crate::ffi::Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UploadFactsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let (found, missing) = match selector {
        MapSelector::Name(name) => (
            (0..us.map_count())
                .find(|&i| us.map_name(i).as_deref() == Some(name))
                .map(|i| (i, name.to_string())),
            format!("No map named {name} is installed."),
        ),
        MapSelector::ArchiveFile(file) => (
            crate::archive::map_in_archive_file(&us, file),
            format!("No map archive named {file} is installed."),
        ),
    };
    let Some((map_index, map_name)) = found else {
        let errors = us.drain_errors();
        us.uninit();
        return UploadFactsOutput {
            problem: Some(missing),
            errors,
            ..Default::default()
        };
    };
    let map_name = map_name.as_str();

    let assembled = match mapcatalog::source_in_session(&us, map_index, map_name, None, cache_dir) {
        Ok(source) => {
            // The same two sources the catalog entry uses: the engine's map
            // info for the description and credits, because it synthesises them
            // for a map with no `mapinfo.lua`, and `mapinfo.lua` for the version.
            let info = us.map_info(map_index);
            let mut version = None;
            if let Some(first_archive) = us.map_archives(map_name).into_iter().next() {
                us.add_all_archives(&first_archive);
                (_, version) = us.map_identity();
                us.remove_all_archives();
            }
            let identity = Identity {
                internal_name: map_name.to_string(),
                version: version.unwrap_or_default(),
                shortname: None,
                author: mapcatalog::some_text(info.get("author")),
                description: mapcatalog::some_text(info.get("description")),
            };
            assemble(&source.archive_file, UploadKind::Map, identity, cache_dir)
                .map(|facts| (facts, source.archive_file.clone()))
        }
        Err(MapCatalogSkip::NoArchiveFile) => Err(format!(
            "{map_name} is not a single .sd7 or .sdz file under maps/. It may be unpacked into \
             a folder or installed another way, so there is no archive to upload."
        )),
        Err(why) => Err(format!(
            "Could not read the archive file for {map_name} ({why:?})."
        )),
    };
    let errors = us.drain_errors();
    us.uninit();
    answer(assembled, errors)
}

/// One game's facts, in a session of its own. `game_archive` is the game's
/// primary archive file name, as `--game` takes it.
pub fn read_game(lib: &str, game_archive: &str, cache_dir: Option<&Path>) -> UploadFactsOutput {
    let us = match unsafe { crate::ffi::Unitsync::load(Path::new(lib)) } {
        Ok(u) => u,
        Err(e) => {
            return UploadFactsOutput {
                errors: vec![e],
                ..Default::default()
            }
        }
    };
    us.init(false, 0);
    let _ = us.drain_errors();

    let mod_index =
        (0..us.mod_count()).find(|&i| us.mod_archive(i).as_deref() == Some(game_archive));
    let assembled = match mod_index {
        None => Err(format!(
            "No game with the archive {game_archive} is installed."
        )),
        Some(index) => {
            let info = us.mod_info(index);
            // unitsync hands modinfo keys back as the game wrote them.
            let field = |key: &str| {
                info.iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(key))
                    .and_then(|(_, v)| mapcatalog::some_text(Some(v)))
            };
            let identity = Identity {
                internal_name: crate::archive::archive_name_for_game(&us, game_archive),
                version: field("version").unwrap_or_default(),
                shortname: field("shortname"),
                author: None,
                description: None,
            };
            match crate::archive::resolve_open_path(&us, game_archive)
                .filter(|path| Path::new(path).is_file())
            {
                Some(path) => assemble(&path, UploadKind::Game, identity, cache_dir)
                    .map(|facts| (facts, path)),
                None => Err(format!(
                    "{game_archive} is not a single .sd7 or .sdz file. It may be unpacked into a \
                     folder or installed through rapid, so there is no archive to upload."
                )),
            }
        }
    };
    let errors = us.drain_errors();
    us.uninit();
    answer(assembled, errors)
}

/// Report a failure that stopped the mode running at all, in the mode's own
/// shape, so a caller parses one thing either way.
pub fn emit_error(msg: String) {
    let out = UploadFactsOutput {
        errors: vec![msg],
        ..Default::default()
    };
    println!("{}", serde_json::to_string(&out).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `printf 'coilbox upload facts test archive\n' | shasum -a 256`.
    const CONTENT: &[u8] = b"coilbox upload facts test archive\n";
    const SHASUM: &str = "f497f8a9e228fd60e83a3e63e5efb3ea65510df201267e1bde1282e2ecd9f083";

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-upload-facts-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn archive(dir: &Path, name: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, CONTENT).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn map_identity() -> Identity {
        Identity {
            internal_name: "Acidic Quarry 5.17".into(),
            version: "5.17".into(),
            shortname: None,
            author: Some("Someone".into()),
            description: Some("A quarry.".into()),
        }
    }

    fn game_identity() -> Identity {
        Identity {
            internal_name: "Splinter Faction 1.2".into(),
            version: "1.2".into(),
            shortname: Some("SF".into()),
            author: None,
            description: None,
        }
    }

    #[test]
    fn a_map_archive_gives_its_hash_size_and_file_name() {
        let dir = scratch("map");
        let path = archive(&dir, "acidic_quarry_5.17.sd7");
        let facts = assemble(&path, UploadKind::Map, map_identity(), None).unwrap();
        assert_eq!(facts.sha256, SHASUM);
        assert_eq!(facts.size, CONTENT.len() as u64);
        assert_eq!(facts.filename, "acidic_quarry_5.17.sd7");
        assert_eq!(facts.kind, UploadKind::Map);
        assert_eq!(facts.internal_name, "Acidic Quarry 5.17");
        assert_eq!(facts.version, "5.17");
        assert_eq!(facts.shortname, None);
        assert_eq!(facts.author.as_deref(), Some("Someone"));
        assert_eq!(facts.description.as_deref(), Some("A quarry."));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_game_archive_gives_its_primary_archive_hash_and_modinfo_names() {
        let dir = scratch("game");
        let path = archive(&dir, "splinterfaction.sdz");
        let facts = assemble(&path, UploadKind::Game, game_identity(), None).unwrap();
        assert_eq!(facts.sha256, SHASUM);
        assert_eq!(facts.kind, UploadKind::Game);
        assert_eq!(facts.internal_name, "Splinter Faction 1.2");
        assert_eq!(facts.shortname.as_deref(), Some("SF"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_answer_with_facts_names_the_file_to_send_and_a_refusal_does_not() {
        let dir = scratch("answerpath");
        let path = archive(&dir, "acidic_quarry_5.17.sd7");
        let facts = assemble(&path, UploadKind::Map, map_identity(), None).unwrap();
        let json = serde_json::to_value(answer(Ok((facts, path.clone())), vec![])).unwrap();
        assert_eq!(json["path"], path.as_str());
        assert_eq!(json["facts"]["filename"], "acidic_quarry_5.17.sd7");
        let refused = serde_json::to_value(answer(Err("no".into()), vec![])).unwrap();
        assert!(refused.get("path").is_none(), "{refused}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_game_with_no_shortname_is_refused_in_words() {
        let dir = scratch("noshort");
        let path = archive(&dir, "splinterfaction.sdz");
        let identity = Identity {
            shortname: None,
            ..game_identity()
        };
        let said = assemble(&path, UploadKind::Game, identity, None).unwrap_err();
        assert!(said.contains("no shortname"), "{said}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_name_the_hub_would_refuse_is_refused_before_it_is_sent() {
        let dir = scratch("badname");
        let path = archive(&dir, "acidic_quarry.zip");
        let said = assemble(&path, UploadKind::Map, map_identity(), None).unwrap_err();
        assert!(said.contains("must end in .sd7 or .sdz"), "{said}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_over_long_description_is_refused_in_words() {
        let dir = scratch("longdesc");
        let path = archive(&dir, "acidic_quarry_5.17.sd7");
        let identity = Identity {
            description: Some("d".repeat(4001)),
            ..map_identity()
        };
        let said = assemble(&path, UploadKind::Map, identity, None).unwrap_err();
        assert!(said.contains("at most 4000"), "{said}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_empty_archive_file_is_refused() {
        let dir = scratch("empty");
        let path = dir.join("empty.sd7");
        std::fs::write(&path, b"").unwrap();
        let said = assemble(
            &path.to_string_lossy(),
            UploadKind::Map,
            map_identity(),
            None,
        )
        .unwrap_err();
        assert!(said.contains("empty"), "{said}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_missing_file_is_a_sentence_not_a_panic() {
        let dir = scratch("missing");
        let path = dir.join("gone.sd7");
        let said = assemble(
            &path.to_string_lossy(),
            UploadKind::Map,
            map_identity(),
            None,
        )
        .unwrap_err();
        assert!(said.contains("Could not read the archive file"), "{said}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_hash_is_cached_by_path_size_and_modified_time() {
        let dir = scratch("cache");
        let cache = dir.join("cache");
        let path = archive(&dir, "acidic_quarry_5.17.sd7");
        let first = assemble(&path, UploadKind::Map, map_identity(), Some(&cache)).unwrap();
        assert_eq!(first.sha256, SHASUM);
        assert!(
            std::fs::read_dir(&cache).unwrap().count() > 0,
            "the hash should have been written to the cache"
        );
        // A different file, same length, rewritten so its mtime differs: the key
        // moves with it and the cached hash is not served for the new bytes.
        let other = b"coilbox upload facts test archivf\n";
        assert_eq!(other.len(), CONTENT.len());
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::write(&path, other).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let second = assemble(&path, UploadKind::Map, map_identity(), Some(&cache)).unwrap();
        assert_ne!(second.sha256, SHASUM);
        let _ = std::fs::remove_dir_all(dir);
    }
}
