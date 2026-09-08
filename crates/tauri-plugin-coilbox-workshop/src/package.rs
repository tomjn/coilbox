//! Packaging a compiled project as a `.sdz` a game can load from anybody's
//! downloads folder (issue #1283).
//!
//! `mutator.rs`'s generated `.sdd` is already playable, on this machine,
//! because its folder sits under a content root the engine scans. Handing it
//! to somebody else needs the two things a folder that lives in coilbox's own
//! generated `games/` never had to be: a file, and a version that means
//! something once two people have it.
//!
//! [`versioned_files`] takes what `compile::compile` already produced and
//! rewrites only its `modinfo.lua`, with the version this export is being
//! published as rather than the placeholder every other route leaves in
//! place (`compile::MUTATOR_VERSION`). [`write_sdz`] then packs the result
//! into an archive the same shape `crates/tauri-plugin-coilbox-scenario/src/archive.rs`
//! already reads back: a deflated zip holding the same relative paths the
//! `.sdd` route writes to disk.

use crate::compile::{modinfo_versioned, CompiledFile};
use crate::model::ModProject;
use coilbox_portable::is_safe_rel;
use std::io::Write;
use std::path::Path;

/// Swap the placeholder `modinfo.lua` `compile::compile` wrote for one
/// carrying the version this export is being published as. Nothing else
/// `compile` produced (a unit's own file, the post file) depends on the
/// archive's own version, so this is the one entry that changes.
pub fn versioned_files(
    project: &ModProject,
    mut files: Vec<CompiledFile>,
    version: u32,
) -> Vec<CompiledFile> {
    let rendered = modinfo_versioned(project, &version.to_string());
    if let Some(entry) = files.iter_mut().find(|f| f.path == "modinfo.lua") {
        entry.contents = rendered;
    }
    files
}

/// Write `files` as a `.sdz` at `dest`, the same deflated zip shape
/// `archive.rs` reads back.
///
/// Every path is checked against escaping the archive root before anything
/// is written. `compile::compile` already refuses a copy whose key is not a
/// plain unit name (`valid_unit_key`), so nothing reaches here with a `..`
/// in it today, but a zip a game would refuse to load from a traversal it
/// should never have accepted is cheap insurance to keep in the writer that
/// owns the archive's shape rather than trust upstream never to change.
pub fn write_sdz(dest: &Path, files: &[CompiledFile]) -> Result<(), String> {
    for file in files {
        if !is_safe_rel(Path::new(&file.path)) {
            return Err(format!("unsafe archive path: {}", file.path));
        }
    }
    let out = std::fs::File::create(dest)
        .map_err(|e| format!("could not create {}: {e}", dest.display()))?;
    let mut zip = zip::ZipWriter::new(out);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for file in files {
        zip.start_file(&file.path, opts)
            .map_err(|e| format!("could not add {} to the archive: {e}", file.path))?;
        zip.write_all(file.contents.as_bytes())
            .map_err(|e| format!("could not write {} to the archive: {e}", file.path))?;
    }
    zip.finish()
        .map_err(|e| format!("could not finish the archive: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::compile;
    use serde_json::json;
    use std::io::Read;

    fn project(edits: serde_json::Value) -> ModProject {
        serde_json::from_value(json!({
            "name": "Faster commanders",
            "gameName": "Balanced Annihilation V15.9.8",
            "edits": edits,
        }))
        .expect("parse")
    }

    /// The one thing packaging changes about what `compile` already wrote.
    #[test]
    fn versioned_files_rewrites_only_modinfo() {
        let p = project(json!({ "disabled": ["armflash"] }));
        let compiled = compile(&p);
        let post_before = compiled
            .files
            .iter()
            .find(|f| f.path == "gamedata/unitdefs_post.lua")
            .expect("post file")
            .contents
            .clone();

        let files = versioned_files(&p, compiled.files, 7);

        let modinfo = files
            .iter()
            .find(|f| f.path == "modinfo.lua")
            .expect("modinfo.lua");
        assert!(modinfo.contents.contains("version = \"7\""));
        let post_after = &files
            .iter()
            .find(|f| f.path == "gamedata/unitdefs_post.lua")
            .expect("post file")
            .contents;
        assert_eq!(&post_before, post_after);
    }

    /// The archive has to hold what it says it does: every file `compile`
    /// wrote, and the version this export chose rather than the placeholder.
    #[test]
    fn writing_and_reading_back_a_package_holds_every_file_and_the_chosen_version() {
        let p = project(json!({ "disabled": ["armflash"] }));
        let compiled = compile(&p);
        let expected_paths: Vec<String> = compiled.files.iter().map(|f| f.path.clone()).collect();
        let files = versioned_files(&p, compiled.files, 3);
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("faster-commanders-v3.sdz");

        write_sdz(&dest, &files).expect("write");

        let f = std::fs::File::open(&dest).expect("open");
        let mut zip = zip::ZipArchive::new(f).expect("zip");
        let names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).expect("entry").name().to_string())
            .collect();
        for path in &expected_paths {
            assert!(names.contains(path), "{path} missing from the archive");
        }

        let mut modinfo = String::new();
        zip.by_name("modinfo.lua")
            .expect("modinfo.lua")
            .read_to_string(&mut modinfo)
            .expect("read modinfo.lua");
        assert!(modinfo.contains("version = \"3\""));
        assert!(modinfo.contains("modtype = 1"));
        assert!(modinfo.contains("depend"));
        assert!(modinfo.contains("Balanced Annihilation V15.9.8"));
    }

    #[test]
    fn rejects_a_path_that_would_escape_the_archive() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("bad.sdz");
        let files = vec![CompiledFile {
            path: "../evil.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        assert!(write_sdz(&dest, &files).is_err());
        assert!(!dest.exists());
    }
}
