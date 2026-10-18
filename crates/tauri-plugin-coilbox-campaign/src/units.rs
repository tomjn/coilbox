//! A campaign's copies of units made in the unit builder (issue #4516).
//!
//! Attaching a unit to a campaign copies it, so editing the unit later does not
//! change the campaign. Each copy is one folder,
//! `<data_dir>/campaign/units/<campaignId>/<unitName>/`, holding `unit.json`
//! (the built unit and its source document, which the frontend owns) and any
//! texture that does not ship with coilbox.
//!
//! Every function takes the campaign's own units folder rather than the app
//! handle, so the guards can be tested against real directories.

use coilbox_portable::is_safe_rel;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// The file in each copy's folder that holds the unit itself.
const UNIT_FILE: &str = "unit.json";

/// A unit name becomes a folder name, so it is held to the rule the builder
/// normalises unit names to: lower case letters, digits and underscores.
pub fn valid_unit_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// A bare file name, never a path.
pub fn is_file_name(name: &str) -> bool {
    let rel = Path::new(name);
    is_safe_rel(rel) && rel.components().count() == 1 && name != UNIT_FILE
}

/// A file in a copy's folder that an export carries: the unit itself, or one of
/// its textures.
fn is_copy_file(name: &str) -> bool {
    name == UNIT_FILE || is_file_name(name)
}

/// One stored copy, as listed.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredUnit {
    pub unit_name: String,
    pub json: String,
    /// The copy's folder, which its textures are read from at launch.
    pub dir: String,
    /// The textures in that folder, by file name. A copy whose atlas is not in
    /// here depends on an installed atlas pack.
    pub files: Vec<String>,
}

/// Write one copy: the unit's JSON and the textures to carry, each read from
/// `from` and written under `name`.
///
/// The new copy is put together in a folder beside the old one and swapped in
/// at the end, so a copy that fails part way leaves the campaign's earlier copy
/// as it was.
pub fn save_unit(
    root: &Path,
    unit_name: &str,
    json: &str,
    textures: &[(PathBuf, String)],
) -> Result<PathBuf, String> {
    if !valid_unit_name(unit_name) {
        return Err(format!("invalid unit name: {unit_name}"));
    }
    for (_, name) in textures {
        if !is_file_name(name) {
            return Err(format!("invalid texture name: {name}"));
        }
    }
    let partial = root.join(format!(".{unit_name}.partial"));
    remove_dir(&partial)?;
    std::fs::create_dir_all(&partial)
        .map_err(|e| format!("could not create {}: {e}", partial.display()))?;
    let written = (|| {
        for (from, name) in textures {
            std::fs::copy(from, partial.join(name))
                .map_err(|e| format!("could not copy the texture {name}: {e}"))?;
        }
        std::fs::write(partial.join(UNIT_FILE), json)
            .map_err(|e| format!("could not write the unit: {e}"))
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_dir_all(&partial);
        return Err(e);
    }
    let dir = root.join(unit_name);
    remove_dir(&dir)?;
    std::fs::rename(&partial, &dir)
        .map_err(|e| format!("could not store the unit {unit_name}: {e}"))?;
    Ok(dir)
}

/// Every copy in a campaign's units folder. A folder that is not a copy, or a
/// copy whose `unit.json` will not read, is skipped: a missing copy is reported
/// by the frontend, which knows which units the campaign names.
pub fn list_units(root: &Path) -> Vec<StoredUnit> {
    let mut units = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return units;
    };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_unit_name(&name) {
            continue;
        }
        let dir = entry.path();
        if let Ok(json) = std::fs::read_to_string(dir.join(UNIT_FILE)) {
            units.push(StoredUnit {
                unit_name: name,
                json,
                files: texture_names(&dir),
                dir: dir.to_string_lossy().to_string(),
            });
        }
    }
    units.sort_by(|a, b| a.unit_name.cmp(&b.unit_name));
    units
}

/// The textures in a copy's folder: every file but the unit itself.
fn texture_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| is_file_name(name))
        .collect();
    names.sort();
    names
}

/// Read one file out of a copy's folder, for an export to carry.
pub fn read_unit_file(root: &Path, unit_name: &str, file: &str) -> Result<Vec<u8>, String> {
    if !valid_unit_name(unit_name) {
        return Err(format!("invalid unit name: {unit_name}"));
    }
    if !is_copy_file(file) {
        return Err(format!("invalid unit file name: {file}"));
    }
    std::fs::read(root.join(unit_name).join(file))
        .map_err(|e| format!("could not read {file} of {unit_name}: {e}"))
}

/// Write one file into a copy's folder, for an import. An import writes the
/// textures first and `unit.json` last, because a folder without a `unit.json`
/// is not a copy and is not listed, so a copy that stops part way is never read.
///
/// `unit.json` has to be a JSON object. Nothing else is checked: the bytes came
/// out of a file the user picked, which is already in memory, so writing them
/// costs no more than that file did.
pub fn write_unit_file(
    root: &Path,
    unit_name: &str,
    file: &str,
    bytes: &[u8],
) -> Result<(), String> {
    if !valid_unit_name(unit_name) {
        return Err(format!("invalid unit name: {unit_name}"));
    }
    if !is_copy_file(file) {
        return Err(format!("invalid unit file name: {file}"));
    }
    if file == UNIT_FILE
        && !matches!(
            serde_json::from_slice::<serde_json::Value>(bytes),
            Ok(serde_json::Value::Object(_))
        )
    {
        return Err(format!("{unit_name} has no readable unit"));
    }
    let dir = root.join(unit_name);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    std::fs::write(dir.join(file), bytes)
        .map_err(|e| format!("could not write {file} of {unit_name}: {e}"))
}

/// Remove one copy. False when there was none.
pub fn delete_unit(root: &Path, unit_name: &str) -> Result<bool, String> {
    if !valid_unit_name(unit_name) {
        return Err(format!("invalid unit name: {unit_name}"));
    }
    let dir = root.join(unit_name);
    if !dir.exists() {
        return Ok(false);
    }
    remove_dir(&dir)?;
    Ok(true)
}

/// Copy every copy from one campaign's units folder to another's, for a
/// duplicated campaign. Answers how many units were copied.
pub fn copy_units(from: &Path, to: &Path) -> Result<usize, String> {
    let units = list_units(from);
    for unit in &units {
        let source = PathBuf::from(&unit.dir);
        let target = to.join(&unit.unit_name);
        remove_dir(&target)?;
        copy_dir(&source, &target)?;
    }
    Ok(units.len())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("could not create {}: {e}", to.display()))?;
    let entries =
        std::fs::read_dir(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            std::fs::copy(&path, to.join(entry.file_name()))
                .map_err(|e| format!("could not copy {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn remove_dir(dir: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not remove {}: {e}", dir.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texture(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).expect("write texture");
        path
    }

    #[test]
    fn a_saved_copy_lists_with_its_textures_beside_it() {
        let tmp = tempfile::tempdir().expect("temp");
        let source = texture(tmp.path(), "camo.png", b"png");
        let root = tmp.path().join("units/c1");

        let dir = save_unit(&root, "tank", "{}", &[(source, "camo.png".into())]).expect("saved");

        assert_eq!(dir, root.join("tank"));
        assert_eq!(std::fs::read(dir.join("camo.png")).expect("copied"), b"png");
        assert_eq!(
            list_units(&root),
            vec![StoredUnit {
                unit_name: "tank".into(),
                json: "{}".into(),
                files: vec!["camo.png".into()],
                dir: dir.to_string_lossy().to_string(),
            }]
        );
    }

    #[test]
    fn saving_again_replaces_the_whole_copy() {
        let tmp = tempfile::tempdir().expect("temp");
        let source = texture(tmp.path(), "camo.png", b"png");
        let root = tmp.path().join("units/c1");
        save_unit(&root, "tank", "{\"v\":1}", &[(source, "camo.png".into())]).expect("first");

        let dir = save_unit(&root, "tank", "{\"v\":2}", &[]).expect("second");

        assert!(!dir.join("camo.png").exists());
        assert_eq!(list_units(&root)[0].json, "{\"v\":2}");
    }

    #[test]
    fn a_copy_that_fails_leaves_the_earlier_one() {
        let tmp = tempfile::tempdir().expect("temp");
        let root = tmp.path().join("units/c1");
        save_unit(&root, "tank", "{\"v\":1}", &[]).expect("first");

        let missing = tmp.path().join("gone.png");
        let failed = save_unit(&root, "tank", "{\"v\":2}", &[(missing, "gone.png".into())]);

        assert!(failed.is_err());
        assert_eq!(list_units(&root)[0].json, "{\"v\":1}");
        assert!(!root.join(".tank.partial").exists());
    }

    #[test]
    fn refuses_names_that_could_leave_the_folder() {
        let tmp = tempfile::tempdir().expect("temp");
        let root = tmp.path().join("units/c1");
        assert!(save_unit(&root, "../tank", "{}", &[]).is_err());
        assert!(save_unit(&root, "Tank", "{}", &[]).is_err());
        let source = texture(tmp.path(), "camo.png", b"png");
        assert!(save_unit(
            &root,
            "tank",
            "{}",
            &[(source.clone(), "../camo.png".into())]
        )
        .is_err());
        assert!(save_unit(&root, "tank", "{}", &[(source, "unit.json".into())]).is_err());
        assert!(delete_unit(&root, "..").is_err());
    }

    #[test]
    fn delete_removes_one_copy_and_says_when_there_was_none() {
        let tmp = tempfile::tempdir().expect("temp");
        let root = tmp.path().join("units/c1");
        save_unit(&root, "tank", "{}", &[]).expect("tank");
        save_unit(&root, "jeep", "{}", &[]).expect("jeep");

        assert!(delete_unit(&root, "tank").expect("deleted"));
        assert!(!delete_unit(&root, "tank").expect("again"));
        assert_eq!(list_units(&root).len(), 1);
    }

    #[test]
    fn a_file_read_from_one_campaign_writes_into_another_unchanged() {
        let tmp = tempfile::tempdir().expect("temp");
        let source = texture(tmp.path(), "camo.png", b"\x89png\x00\xff");
        let from = tmp.path().join("units/c1");
        let to = tmp.path().join("units/c2");
        save_unit(&from, "tank", "{\"v\":1}", &[(source, "camo.png".into())]).expect("tank");

        for file in ["camo.png", UNIT_FILE] {
            let bytes = read_unit_file(&from, "tank", file).expect("read");
            write_unit_file(&to, "tank", file, &bytes).expect("write");
        }

        let copied = list_units(&to);
        assert_eq!(copied.len(), 1);
        assert_eq!(copied[0].json, "{\"v\":1}");
        assert_eq!(copied[0].files, vec!["camo.png".to_string()]);
        assert_eq!(
            std::fs::read(to.join("tank/camo.png")).expect("texture"),
            b"\x89png\x00\xff"
        );
    }

    #[test]
    fn a_copy_without_its_unit_file_is_not_listed() {
        let tmp = tempfile::tempdir().expect("temp");
        let root = tmp.path().join("units/c1");
        write_unit_file(&root, "tank", "camo.png", b"png").expect("texture only");
        assert!(list_units(&root).is_empty());
    }

    #[test]
    fn file_access_refuses_names_that_could_leave_the_folder() {
        let tmp = tempfile::tempdir().expect("temp");
        let root = tmp.path().join("units/c1");
        save_unit(&root, "tank", "{}", &[]).expect("tank");
        assert!(read_unit_file(&root, "../tank", UNIT_FILE).is_err());
        assert!(read_unit_file(&root, "tank", "../c2/x").is_err());
        assert!(write_unit_file(&root, "tank", "../x.png", b"x").is_err());
        assert!(write_unit_file(&root, "Tank", "x.png", b"x").is_err());
        assert!(write_unit_file(&root, "tank", UNIT_FILE, b"not json").is_err());
        assert!(write_unit_file(&root, "tank", UNIT_FILE, b"[1]").is_err());
    }

    #[test]
    fn copy_units_carries_every_copy_to_another_campaign() {
        let tmp = tempfile::tempdir().expect("temp");
        let source = texture(tmp.path(), "camo.png", b"png");
        let from = tmp.path().join("units/c1");
        let to = tmp.path().join("units/c2");
        save_unit(&from, "tank", "{}", &[(source, "camo.png".into())]).expect("tank");

        assert_eq!(copy_units(&from, &to).expect("copied"), 1);
        assert_eq!(
            std::fs::read(to.join("tank/camo.png")).expect("texture"),
            b"png"
        );
        assert_eq!(list_units(&to)[0].unit_name, "tank");
        assert_eq!(
            copy_units(&tmp.path().join("units/none"), &to).expect("none"),
            0
        );
    }
}
