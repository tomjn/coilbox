//! The geometry sidecars, and clearing the ones no unit owns.
//!
//! `geometry/<id>.bin.gz` holds the meshes of a unit imported from somebody
//! else's `.s3o`, written by `lego_import_s3o` (see [`crate::import`]). It is
//! written while the model is being read, which is before anyone has said they
//! want it: the builder reads a file, reports what came out of it, and only then
//! offers the button that saves the unit. Walk away instead of pressing that
//! button and the sidecar is left with no document naming it, and until this
//! nothing ever removed it (#1902).
//!
//! So the store is swept once at startup, against the documents in `projects/`.
//! Startup rather than on save, which is when textures are pruned. A texture is
//! shared and content addressed, so its keep-set is every saved unit's keys and
//! is knowable at any moment. A sidecar's owner does not exist yet during the
//! read that wrote it, so a sweep on save would delete the geometry of an import
//! somebody is still looking at. Nothing can be part way through an import
//! before the window is even up, which makes startup the one moment the answer
//! is not in doubt.

use std::collections::HashSet;
use std::path::Path;

/// What every sidecar's file name ends in.
const SIDECAR: &str = ".bin.gz";

/// The ids the store holds a unit document for, or `None` when the folder could
/// not be read and the question therefore has no answer.
///
/// Read off the file names rather than out of the JSON. A document is stored as
/// `projects/<id>.json` and its sidecar as `geometry/<id>.bin.gz`, so the id is
/// the file stem, and this crate goes on knowing nothing about the schema.
///
/// A folder that is not there is an empty set rather than no answer: a store
/// nobody has saved a unit into yet owns nothing, and may still hold sidecars
/// from imports that were read and abandoned.
fn saved_ids(projects: &Path) -> Option<HashSet<String>> {
    let entries = match std::fs::read_dir(projects) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some(HashSet::new()),
        Err(_) => return None,
    };
    Some(
        entries
            .flatten()
            .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("json"))
            .filter_map(|entry| {
                entry
                    .path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string)
            })
            .collect(),
    )
}

/// The unit a sidecar belongs to, or `None` for a file that is not one.
fn sidecar_owner(name: &str) -> Option<&str> {
    let id = name.strip_suffix(SIDECAR)?;
    (!id.is_empty()).then_some(id)
}

/// Delete every sidecar no saved unit owns, answering how many went.
///
/// Anything that is not a sidecar is left alone rather than swept up with them,
/// so a file somebody put in the folder by hand is theirs to remove.
fn prune(geometry: &Path, keep: &HashSet<String>) -> usize {
    let Ok(entries) = std::fs::read_dir(geometry) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(owner) = sidecar_owner(&name) else {
            continue;
        };
        if keep.contains(owner) || !entry.path().is_file() {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Clear the sidecars of imports nobody kept, answering how many went.
///
/// Best effort throughout. A store that cannot be listed is left exactly as it
/// is, because a sweep that cannot see the documents cannot tell an orphan from
/// a unit and would take both.
pub fn sweep(lego: &Path) -> usize {
    let Some(keep) = saved_ids(&lego.join("projects")) else {
        return 0;
    };
    prune(&lego.join("geometry"), &keep)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A store with the given documents and sidecars in it.
    fn store(projects: &[&str], geometry: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("projects")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("geometry")).expect("mkdir");
        for id in projects {
            std::fs::write(dir.path().join("projects").join(format!("{id}.json")), "{}")
                .expect("write");
        }
        for name in geometry {
            std::fs::write(dir.path().join("geometry").join(name), b"x").expect("write");
        }
        dir
    }

    #[test]
    fn a_sidecar_with_no_unit_behind_it_goes_and_the_rest_stay() {
        let dir = store(&["kept"], &["kept.bin.gz", "abandoned.bin.gz"]);

        assert_eq!(sweep(dir.path()), 1);

        assert!(dir.path().join("geometry/kept.bin.gz").is_file());
        assert!(!dir.path().join("geometry/abandoned.bin.gz").exists());
    }

    #[test]
    fn a_file_that_is_not_a_sidecar_is_left_where_it_is() {
        let dir = store(&[], &["notes.txt", "orphan.bin.gz"]);

        assert_eq!(sweep(dir.path()), 1);

        assert!(dir.path().join("geometry/notes.txt").is_file());
    }

    #[test]
    fn a_store_with_nothing_saved_in_it_yet_still_loses_its_orphans() {
        // The import writes the sidecar before anything is saved, so a store
        // whose owner has only ever abandoned imports has no projects folder at
        // all and is exactly the case worth clearing.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("geometry")).expect("mkdir");
        std::fs::write(dir.path().join("geometry/orphan.bin.gz"), b"x").expect("write");

        assert_eq!(sweep(dir.path()), 1);
    }

    #[test]
    fn a_store_that_is_not_there_is_nothing_to_sweep_rather_than_a_fault() {
        assert_eq!(sweep(Path::new("/definitely/not/here")), 0);
    }

    #[test]
    fn documents_that_cannot_be_listed_leave_every_sidecar_alone() {
        // The keep-set would otherwise be empty and take the lot with it.
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("geometry")).expect("mkdir");
        std::fs::write(dir.path().join("geometry/unit.bin.gz"), b"x").expect("write");
        // A file where the folder should be: readable as an entry, not as a
        // directory, which is the shape of "the answer cannot be got at".
        std::fs::write(dir.path().join("projects"), b"not a folder").expect("write");

        assert_eq!(sweep(dir.path()), 0);
        assert!(dir.path().join("geometry/unit.bin.gz").is_file());
    }

    #[test]
    fn only_a_whole_sidecar_name_names_a_unit() {
        assert_eq!(sidecar_owner("abc.bin.gz"), Some("abc"));
        assert_eq!(sidecar_owner(".bin.gz"), None);
        assert_eq!(sidecar_owner("abc.bin"), None);
        assert_eq!(sidecar_owner("abc.json"), None);
    }

    #[test]
    fn only_documents_count_as_units() {
        let dir = store(&["unit"], &["unit.bin.gz"]);
        std::fs::write(dir.path().join("projects/unit.txt"), "x").expect("write");

        let ids = saved_ids(&dir.path().join("projects")).expect("listed");

        assert_eq!(ids, HashSet::from(["unit".to_string()]));
    }
}
