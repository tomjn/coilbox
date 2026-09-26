//! Packaging a compiled project as a `.sdz` a game can load from anybody's
//! downloads folder (issue #1283), or as an unpacked `.sdd` folder for
//! somebody who keeps their game as a loose directory under version control
//! instead (issue #3160).
//!
//! `mutator.rs`'s generated `.sdd` is already playable, on this machine,
//! because its folder sits under a content root the engine scans. Handing it
//! to somebody else needs the two things a folder that lives in coilbox's own
//! generated `games/` never had to be: a file (or a folder with a name the
//! caller chose), and a version that means something once two people have
//! it.
//!
//! [`versioned_files`] takes what `compile::compile` already produced and
//! rewrites only its `modinfo.lua`, with the version this export is being
//! published as rather than the placeholder every other route leaves in
//! place (`compile::MUTATOR_VERSION`). [`write_sdz`] then packs the result
//! into an archive the same shape `crates/tauri-plugin-coilbox-scenario/src/archive.rs`
//! already reads back: a deflated zip holding the same relative paths the
//! `.sdd` route writes to disk. [`write_sdd`] writes the very same files
//! under the very same relative paths, but as a plain directory rather than
//! a zip, so the two outputs cannot drift apart.

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

/// Write `files` as an unpacked `.sdd` at `dest`, the same relative paths
/// `write_sdz` zips instead written as a plain directory a game keeping
/// itself in version control can hold as-is (issue #3160).
///
/// `dest` is a caller-chosen destination rather than the local test route's
/// own fixed, coilbox-owned folder (`mutator.rs`'s `FOLDER`), so an existing
/// directory there is left untouched unless `overwrite` is set. Silently
/// clearing a folder this command did not create could throw away something
/// unrelated. The frontend is expected to confirm a replace with the author
/// first, the same moment the native save dialog would ask for a `.sdz`
/// already on disk, and only then set `overwrite`.
///
/// Two more guards sit ahead of that clear, because `overwrite` alone is not
/// enough to trust `remove_dir_all` with an arbitrary path. `dest`'s own name
/// has to end in `.sdd` (case-insensitively), so a caller cannot point this
/// at, say, a home directory and have it cleared as though it were an
/// export. And an existing `dest` is only ever cleared when it is a plain
/// directory, never a symlink (which could point anywhere) or a file.
pub fn write_sdd(dest: &Path, files: &[CompiledFile], overwrite: bool) -> Result<(), String> {
    for file in files {
        if !is_safe_rel(Path::new(&file.path)) {
            return Err(format!("unsafe archive path: {}", file.path));
        }
    }
    let names_an_sdd = dest
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.to_ascii_lowercase().ends_with(".sdd"));
    if !names_an_sdd {
        return Err(format!(
            "{} does not end in .sdd, so it was refused rather than written or cleared",
            dest.display()
        ));
    }
    if dest.exists() {
        if !overwrite {
            return Err(format!(
                "{} already exists; confirm a replace before packaging over it",
                dest.display()
            ));
        }
        // `exists()` follows symlinks, so it is checked again here without
        // following one. A symlink could point anywhere, and clearing
        // whatever it resolves to is not what "replace this .sdd" means.
        let meta = std::fs::symlink_metadata(dest)
            .map_err(|e| format!("could not inspect {}: {e}", dest.display()))?;
        if meta.is_symlink() || !meta.is_dir() {
            return Err(format!(
                "{} is not a plain directory, so it was refused rather than cleared",
                dest.display()
            ));
        }
        std::fs::remove_dir_all(dest)
            .map_err(|e| format!("could not clear {}: {e}", dest.display()))?;
    }
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("could not create {}: {e}", dest.display()))?;
    for file in files {
        let target = dest.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, file.contents.as_bytes())
            .map_err(|e| format!("could not write {}: {e}", target.display()))?;
    }
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

    /// An unpacked `.sdd` has to hold exactly the same files, under the same
    /// relative paths, as the `.sdz` for the same compile: the two must not
    /// be able to drift apart.
    #[test]
    fn writing_an_sdd_holds_the_same_files_as_the_sdz() {
        let p = project(json!({ "disabled": ["armflash"] }));
        let compiled = compile(&p);
        let expected_paths: Vec<String> = compiled.files.iter().map(|f| f.path.clone()).collect();
        let files = versioned_files(&p, compiled.files, 3);
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("faster-commanders-v3.sdd");

        write_sdd(&dest, &files, false).expect("write");

        for path in &expected_paths {
            let on_disk = dest.join(path);
            assert!(on_disk.exists(), "{path} missing from the .sdd");
        }
        let modinfo = std::fs::read_to_string(dest.join("modinfo.lua")).expect("read modinfo.lua");
        assert!(modinfo.contains("version = \"3\""));
        assert!(modinfo.contains("Balanced Annihilation V15.9.8"));
    }

    #[test]
    fn refuses_to_overwrite_an_existing_sdd_without_the_flag() {
        let p = project(json!({ "disabled": ["armflash"] }));
        let compiled = compile(&p);
        let files = versioned_files(&p, compiled.files, 1);
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("faster-commanders-v1.sdd");
        std::fs::create_dir_all(&dest).expect("create");
        let stray = dest.join("stray.txt");
        std::fs::write(&stray, "leftover from something else").expect("write stray");

        let err = write_sdd(&dest, &files, false).expect_err("should refuse");
        assert!(err.contains("already exists"));
        // Refused outright: the stray file must still be there.
        assert!(stray.exists());
    }

    #[test]
    fn overwriting_an_existing_sdd_clears_stale_files_the_new_compile_no_longer_writes() {
        let p = project(json!({ "disabled": ["armflash"] }));
        let compiled = compile(&p);
        let files = versioned_files(&p, compiled.files, 1);
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("faster-commanders-v1.sdd");
        std::fs::create_dir_all(&dest).expect("create");
        let stray = dest.join("stray.txt");
        std::fs::write(&stray, "leftover from an earlier export").expect("write stray");

        write_sdd(&dest, &files, true).expect("write");

        assert!(!stray.exists(), "a stale file from before must not survive");
        assert!(dest.join("modinfo.lua").exists());
    }

    #[test]
    fn rejects_an_sdd_path_that_would_escape_the_root() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("bad.sdd");
        let files = vec![CompiledFile {
            path: "../evil.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        assert!(write_sdd(&dest, &files, false).is_err());
        assert!(!dest.exists());
    }

    /// `overwrite` has to be paired with `dest` actually naming a `.sdd`, or
    /// a caller passing an arbitrary path (a whole home directory, say)
    /// would have it cleared as though it were an export (issue #3160
    /// review finding).
    #[test]
    fn refuses_a_dest_whose_name_does_not_end_in_sdd() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("not-an-sdd-at-all");
        let files = vec![CompiledFile {
            path: "modinfo.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        let err = write_sdd(&dest, &files, true).expect_err("should refuse");
        assert!(err.contains(".sdd"));
        assert!(!dest.exists());
    }

    /// The `.sdd` check is case-insensitive, matching how the engine itself
    /// treats the extension.
    #[test]
    fn accepts_an_sdd_name_regardless_of_case() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("Faster-Commanders.SDD");
        let files = vec![CompiledFile {
            path: "modinfo.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        write_sdd(&dest, &files, false).expect("write");
        assert!(dest.join("modinfo.lua").exists());
    }

    /// An existing `dest` that is a plain file rather than a directory must
    /// never be cleared, even with `overwrite` set: `remove_dir_all` is only
    /// ever safe to run against a directory this command itself would have
    /// created (issue #3160 review finding).
    #[test]
    fn refuses_to_clear_an_existing_dest_that_is_a_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let dest = dir.path().join("faster-commanders-v1.sdd");
        std::fs::write(&dest, "not a folder").expect("write stray file");
        let files = vec![CompiledFile {
            path: "modinfo.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        let err = write_sdd(&dest, &files, true).expect_err("should refuse");
        assert!(err.contains("not a plain directory"));
        assert!(dest.is_file(), "the stray file must still be there");
    }

    /// An existing `dest` that is a symlink must never be cleared either,
    /// even with `overwrite` set: a symlink can point anywhere, so
    /// `remove_dir_all` following it could delete something the caller never
    /// meant to touch (issue #3160 review finding).
    #[test]
    #[cfg(unix)]
    fn refuses_to_clear_an_existing_dest_that_is_a_symlink() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real_target = dir.path().join("somewhere-else");
        std::fs::create_dir_all(&real_target).expect("create real target");
        let marker = real_target.join("do-not-delete-me.txt");
        std::fs::write(&marker, "precious").expect("write marker");
        let dest = dir.path().join("faster-commanders-v1.sdd");
        std::os::unix::fs::symlink(&real_target, &dest).expect("symlink");
        let files = vec![CompiledFile {
            path: "modinfo.lua".to_string(),
            contents: "return {}".to_string(),
        }];

        let err = write_sdd(&dest, &files, true).expect_err("should refuse");
        assert!(err.contains("not a plain directory"));
        assert!(marker.exists(), "the symlink target must survive untouched");
    }
}
