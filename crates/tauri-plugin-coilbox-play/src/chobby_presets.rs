//! BYAR-Chobby's `optionsPresets.json` (issue #1297): finding it, reading it
//! and changing it without harming what Chobby keeps in it.
//!
//! The file is Chobby's. It is one JSON object keyed by preset name, and
//! `gui_optionpresets_panel.lua` reads it with `modfile:read()`, which in Lua
//! reads one line. So a write is always one line. Chobby also moves a file it
//! cannot decode aside and starts again, so a file this module cannot decode is
//! never written to.
//!
//! The records are not modelled here. They are kept as the text they were read
//! as, so a record this module was not asked to change is written back exactly
//! as it was found. The frontend converts between records and presets.

use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The file's name in a game's data folder.
pub const FILE_NAME: &str = "optionsPresets.json";

/// One change to the file.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Edit {
    /// Add a record, or replace the one with this name.
    Set { name: String, record: Value },
    /// Remove the record with this name. No such record is not an error.
    Remove { name: String },
}

/// What a write left behind.
#[derive(Debug, Serialize)]
pub struct Applied {
    /// The file as it now is, as one JSON object.
    pub json: String,
    /// The copy of the file as it was just before this write.
    pub backup: PathBuf,
}

/// The records of a file in file order, each as the text it was read as.
struct Table(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Table {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Table;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a table of presets")
            }

            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Table, A::Error> {
                let mut entries: Vec<(String, Box<RawValue>)> = Vec::new();
                while let Some((name, record)) = map.next_entry::<String, Box<RawValue>>()? {
                    // Chobby's decoder keeps the last of a repeated name.
                    match entries.iter_mut().find(|(n, _)| *n == name) {
                        Some(slot) => slot.1 = record,
                        None => entries.push((name, record)),
                    }
                }
                Ok(Table(entries))
            }

            // Chobby's encoder cannot tell an empty table from an empty array,
            // so the file it makes for itself is `[]`.
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Table, A::Error> {
                match seq.next_element::<IgnoredAny>()? {
                    None => Ok(Table(Vec::new())),
                    Some(_) => Err(de::Error::custom("an array with entries")),
                }
            }
        }
        d.deserialize_any(V)
    }
}

fn parse(text: &str) -> Result<Table, String> {
    if text.trim().is_empty() {
        return Err(format!("{FILE_NAME} is empty."));
    }
    serde_json::from_str(text).map_err(|e| {
        if e.is_syntax() || e.is_eof() {
            format!("{FILE_NAME} is not valid JSON: {e}")
        } else {
            format!("{FILE_NAME} is not a table of presets.")
        }
    })
}

/// The table as one line of JSON.
fn render(table: &Table) -> Result<String, String> {
    let mut out = String::from("{");
    for (i, (name, record)) in table.0.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&serde_json::to_string(name).map_err(|e| e.to_string())?);
        out.push(':');
        let raw = record.get();
        // A record read from a file that was laid out over several lines has
        // line breaks in it, and the file must be one line. A break cannot be
        // inside a JSON string, so this only ever finds layout.
        if raw.contains(['\n', '\r']) {
            let value: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            out.push_str(&value.to_string());
        } else {
            out.push_str(raw);
        }
    }
    out.push('}');
    Ok(out)
}

/// The folders among `roots` that hold the file, as the path to it.
pub fn find(roots: &[String]) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    for root in roots {
        let path = Path::new(root).join(FILE_NAME);
        if path.is_file() && !found.contains(&path) {
            found.push(path);
        }
    }
    found
}

/// The file's records as one JSON object, or why it cannot be read.
pub fn read(path: &Path) -> Result<String, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("could not read {FILE_NAME}: {e}"))?;
    render(&parse(&text)?)
}

/// Where the copy of the file goes: beside it, named for the moment of the write.
fn backup_path(path: &Path) -> Result<PathBuf, String> {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let dir = path.parent().ok_or("the file has no folder")?;
    Ok(dir.join(format!("optionsPresets.coilbox-backup-{ms}.json")))
}

/// Copy the file to a new name beside it, never over an earlier copy.
fn back_up(path: &Path) -> Result<PathBuf, String> {
    let mut target = backup_path(path)?;
    let mut n = 0u32;
    while target.exists() {
        n += 1;
        let stem = target.with_extension("");
        target = PathBuf::from(format!("{}-{n}.json", stem.display()));
    }
    std::fs::copy(path, &target).map_err(|e| format!("could not back up {FILE_NAME}: {e}"))?;
    Ok(target)
}

/// Make `edits` to the file.
///
/// The file is read here, at the moment of the write, so a change Chobby made
/// since the caller last looked is kept. A file that cannot be decoded is
/// reported and left as it was. Otherwise the file is copied beside itself,
/// then replaced in one rename so Chobby never reads half of it.
pub fn apply(path: &Path, edits: &[Edit]) -> Result<Applied, String> {
    if path.file_name().and_then(|n| n.to_str()) != Some(FILE_NAME) {
        return Err(format!("not a {FILE_NAME} path: {}", path.display()));
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("could not read {FILE_NAME}: {e}"))?;
    let mut table = parse(&text)?;

    for edit in edits {
        match edit {
            Edit::Set { name, record } => {
                if name.is_empty() {
                    return Err("a preset needs a name".to_string());
                }
                let raw = RawValue::from_string(record.to_string()).map_err(|e| e.to_string())?;
                match table.0.iter_mut().find(|(n, _)| n == name) {
                    Some(slot) => slot.1 = raw,
                    None => table.0.push((name.clone(), raw)),
                }
            }
            Edit::Remove { name } => table.0.retain(|(n, _)| n != name),
        }
    }
    let json = render(&table)?;

    let backup = back_up(path)?;
    let staged = path.with_file_name(format!("{FILE_NAME}.coilbox-tmp"));
    let write = std::fs::write(&staged, &json).and_then(|()| std::fs::rename(&staged, path));
    if let Err(e) = write {
        let _ = std::fs::remove_file(&staged);
        return Err(format!("could not write {FILE_NAME}: {e}"));
    }
    Ok(Applied { json, backup })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A folder of its own, removed when the test is over.
    struct Dir(PathBuf);

    impl Dir {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "coilbox-chobby-presets-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }

        fn with(text: &str) -> Self {
            let dir = Self::new();
            std::fs::write(dir.file(), text).unwrap();
            dir
        }

        fn backups(&self) -> Vec<PathBuf> {
            let mut found: Vec<PathBuf> = std::fs::read_dir(&self.0)
                .unwrap()
                .map(|e| e.unwrap().path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with("optionsPresets.coilbox-backup-"))
                })
                .collect();
            found.sort();
            found
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Two records laid out as Chobby's encoder lays them out: one line, a key
    /// order of its own, a float, an escaped character, a null in an array.
    const CHOBBY: &str = r#"{"Skirmish 2v2":{"Modoptions":{"ruins":"disabled","scale":0.5},"Start Boxes":[null,{"top":0,"right":200,"bottom":200,"left":134}],"Map":"Supreme Isthmus v2.1","Bots":[]},"Multiplayer coop":{"Map":"Full \"Metal\" Plate 1.7","Bots":{}}}"#;

    fn set(name: &str, record: Value) -> Edit {
        Edit::Set {
            name: name.to_string(),
            record,
        }
    }

    #[test]
    fn a_record_that_was_not_edited_is_written_back_byte_for_byte() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(&dir.file(), &[set("New", serde_json::json!({"Map": "m"}))]).unwrap();

        let untouched = &CHOBBY[1..CHOBBY.len() - 1];
        assert!(
            applied.json.contains(untouched),
            "records changed: {}",
            applied.json
        );
        assert_eq!(std::fs::read_to_string(dir.file()).unwrap(), applied.json);
    }

    #[test]
    fn a_new_record_goes_after_the_existing_ones() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(&dir.file(), &[set("New", serde_json::json!({"Map": "m"}))]).unwrap();
        assert!(
            applied.json.ends_with(r#","New":{"Map":"m"}}"#),
            "{}",
            applied.json
        );
    }

    #[test]
    fn a_record_with_the_same_name_is_replaced_where_it_stands() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(
            &dir.file(),
            &[set("Skirmish 2v2", serde_json::json!({"Map": "other"}))],
        )
        .unwrap();
        assert!(
            applied
                .json
                .starts_with(r#"{"Skirmish 2v2":{"Map":"other"},"Multiplayer coop":"#),
            "{}",
            applied.json
        );
    }

    #[test]
    fn removing_a_record_leaves_the_others() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(
            &dir.file(),
            &[Edit::Remove {
                name: "Skirmish 2v2".to_string(),
            }],
        )
        .unwrap();
        assert_eq!(
            applied.json,
            r#"{"Multiplayer coop":{"Map":"Full \"Metal\" Plate 1.7","Bots":{}}}"#
        );
    }

    #[test]
    fn removing_a_name_that_is_not_there_changes_nothing() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(
            &dir.file(),
            &[Edit::Remove {
                name: "nope".to_string(),
            }],
        )
        .unwrap();
        assert_eq!(applied.json, CHOBBY);
    }

    #[test]
    fn a_backup_of_the_file_as_it_was_sits_beside_it() {
        let dir = Dir::with(CHOBBY);
        let applied = apply(&dir.file(), &[set("New", serde_json::json!({}))]).unwrap();
        assert_eq!(applied.backup.parent(), Some(dir.0.as_path()));
        assert_eq!(std::fs::read_to_string(&applied.backup).unwrap(), CHOBBY);
    }

    #[test]
    fn every_write_makes_its_own_backup_and_never_replaces_one() {
        let dir = Dir::with(CHOBBY);
        let first = apply(&dir.file(), &[set("A", serde_json::json!({}))]).unwrap();
        let second = apply(&dir.file(), &[set("B", serde_json::json!({}))]).unwrap();
        assert_ne!(first.backup, second.backup);
        assert_eq!(dir.backups().len(), 2);
        assert_eq!(std::fs::read_to_string(&first.backup).unwrap(), CHOBBY);
        assert_eq!(std::fs::read_to_string(&second.backup).unwrap(), first.json);
    }

    #[test]
    fn a_change_made_since_the_caller_last_looked_is_kept() {
        let dir = Dir::with(CHOBBY);
        // The caller listed the file, then Chobby saved a preset of its own.
        let listed = read(&dir.file()).unwrap();
        assert!(!listed.contains("Added by Chobby"));
        std::fs::write(
            dir.file(),
            CHOBBY.replace("}}}", r#"}},"Added by Chobby":{"Map":"x"}}"#),
        )
        .unwrap();

        let applied = apply(&dir.file(), &[set("Mine", serde_json::json!({}))]).unwrap();
        assert!(applied.json.contains(r#""Added by Chobby":{"Map":"x"}"#));
        assert!(applied.json.contains(r#""Mine":{}"#));
    }

    #[test]
    fn a_file_that_is_not_json_is_reported_and_left_alone() {
        for bad in [
            r#"{"half":"#,
            "",
            "   ",
            "not json",
            r#""text""#,
            "[1,2]",
            "42",
        ] {
            let dir = Dir::with(bad);
            let err = apply(&dir.file(), &[set("New", serde_json::json!({}))]).unwrap_err();
            assert!(err.contains(FILE_NAME), "{bad:?}: {err}");
            assert_eq!(std::fs::read_to_string(dir.file()).unwrap(), bad);
            assert!(dir.backups().is_empty(), "{bad:?} was backed up");
            assert!(read(&dir.file()).is_err(), "{bad:?} was read");
        }
    }

    #[test]
    fn the_empty_array_chobby_writes_for_a_new_file_is_no_records() {
        let dir = Dir::with("[]");
        assert_eq!(read(&dir.file()).unwrap(), "{}");
        let applied = apply(&dir.file(), &[set("New", serde_json::json!({"Map": "m"}))]).unwrap();
        assert_eq!(applied.json, r#"{"New":{"Map":"m"}}"#);
    }

    #[test]
    fn a_file_laid_out_over_many_lines_is_written_as_one() {
        let dir = Dir::with("{\n  \"A\": {\n    \"Map\": \"m\",\n    \"Bots\": []\n  }\n}\n");
        let applied = apply(&dir.file(), &[set("B", serde_json::json!({}))]).unwrap();
        assert!(!applied.json.contains(['\n', '\r']), "{}", applied.json);
        assert_eq!(applied.json, r#"{"A":{"Bots":[],"Map":"m"},"B":{}}"#);
    }

    #[test]
    fn a_repeated_name_keeps_the_last_as_chobby_does() {
        let dir = Dir::with(r#"{"A":{"Map":"first"},"A":{"Map":"second"}}"#);
        assert_eq!(read(&dir.file()).unwrap(), r#"{"A":{"Map":"second"}}"#);
    }

    #[test]
    fn reading_gives_the_records_as_one_object_in_file_order() {
        let dir = Dir::with(CHOBBY);
        assert_eq!(read(&dir.file()).unwrap(), CHOBBY);
    }

    #[test]
    fn only_a_file_with_that_name_is_ever_written() {
        let dir = Dir::new();
        let other = dir.0.join("settings.json");
        std::fs::write(&other, "{}").unwrap();
        assert!(apply(&other, &[]).is_err());
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "{}");
    }

    #[test]
    fn a_missing_file_is_an_error_not_a_new_file() {
        let dir = Dir::new();
        assert!(apply(&dir.file(), &[set("New", serde_json::json!({}))]).is_err());
        assert!(!dir.file().exists());
    }

    #[test]
    fn find_lists_only_the_folders_that_hold_the_file() {
        let with = Dir::with("{}");
        let without = Dir::new();
        let roots = vec![
            without.0.display().to_string(),
            with.0.display().to_string(),
            with.0.display().to_string(),
            "/no/such/folder".to_string(),
        ];
        assert_eq!(find(&roots), vec![with.file()]);
    }
}
