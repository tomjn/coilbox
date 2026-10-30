//! App-level settings persistence, backing the frame's `useSetting` /
//! `SettingsStorage` adapter (`src/settings-storage.ts`).
//!
//! Used to live in the uberstress plugin crate, back when it was the only
//! settings consumer. Twenty-nine settings sections across a dozen plugins go
//! through it now, and the hub plugin reads the file directly to check upload
//! consent (`crates/tauri-plugin-coilbox-hub/src/consent.rs`), so the commands
//! live here in the app itself rather than in any one plugin (issue #2436).
//!
//! The on-disk path is unchanged: `coilbox_portable::settings_file` still
//! resolves to `<data_dir>/uberstress/settings.json`. That segment is
//! deliberately not renamed. Renaming it would strip every existing install of
//! its settings on upgrade.
//!
//! These are plain app commands (registered on the main `tauri::Builder`, like
//! `prepare_for_update` in `main.rs`), not a plugin command: they need no
//! `permissions/` entry and the frontend invokes them directly rather than
//! through `plugin:<id>|<command>`.

use std::collections::BTreeMap;
use std::fs::{File, Permissions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Runtime};

pub type Settings = BTreeMap<String, String>;

/// One save at a time in this process, because they share a temporary file name.
static SAVING: Mutex<()> = Mutex::new(());

/// What a load hands the frontend.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettings {
    entries: Settings,
    /// Where the file went if it held something other than settings, so the
    /// player can be told. `None` on a normal load.
    recovered_copy: Option<PathBuf>,
}

/// Read the settings map from `path`, returning an empty map if it doesn't exist.
///
/// A file that holds anything but a map of strings is moved aside before this
/// returns, so no later save can replace it (issue #4897). A file that cannot be
/// read at all may well be fine, so that is an error and it stays where it is.
fn load_settings(path: &Path) -> Result<LoadedSettings, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LoadedSettings::default());
        }
        Err(e) => return Err(format!("could not read settings: {e}")),
    };
    match serde_json::from_slice(&bytes) {
        Ok(entries) => Ok(LoadedSettings {
            entries,
            recovered_copy: None,
        }),
        Err(_) => recover(path, &bytes),
    }
}

/// Move a bad settings file aside and start again from the values in it that are
/// still good. A rename needs no disk space, so this works on the full disk that
/// may have caused the damage.
fn recover(path: &Path, bytes: &[u8]) -> Result<LoadedSettings, String> {
    let entries = valid_entries(bytes);
    let permissions = file_permissions(path);
    let copy = corrupt_copy_path(path);
    std::fs::rename(path, &copy).map_err(|e| format!("could not move bad settings aside: {e}"))?;
    // Written now because no save may follow, and a missing file next launch
    // would look like a new install. A failure here costs nothing yet: the
    // frontend holds these values and every later save writes them all.
    if let Err(e) = write_settings(path, &entries, permissions) {
        eprintln!("settings: could not write the recovered values: {e}");
    }
    Ok(LoadedSettings {
        entries,
        recovered_copy: Some(copy),
    })
}

/// The string values of a file that is a JSON object with some other values in
/// it. Anything else, such as a truncated file, has no values worth trusting.
fn valid_entries(bytes: &[u8]) -> Settings {
    let Ok(all) = serde_json::from_slice::<BTreeMap<String, serde_json::Value>>(bytes) else {
        return Settings::new();
    };
    all.into_iter()
        .filter_map(|(key, value)| match value {
            serde_json::Value::String(text) => Some((key, text)),
            _ => None,
        })
        .collect()
}

/// `settings.corrupt-<unix milliseconds>.json`, beside the settings file.
fn corrupt_copy_path(path: &Path) -> PathBuf {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis());
    path.with_file_name(format!("settings.corrupt-{time}.json"))
}

/// Write the full settings map to `path`, creating the parent dir if needed.
fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    write_settings(path, settings, file_permissions(path))
}

fn write_settings(
    path: &Path,
    settings: &Settings,
    permissions: Option<Permissions>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create settings dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let _saving = SAVING.lock().unwrap_or_else(|e| e.into_inner());
    replace_file(path, permissions, |file| file.write_all(json.as_bytes()))
        .map_err(|e| format!("could not write settings: {e}"))
}

fn file_permissions(path: &Path) -> Option<Permissions> {
    std::fs::metadata(path).ok().map(|m| m.permissions())
}

/// Replace `path` with what `write` puts in a temporary file beside it, so a
/// failure or a crash at any point leaves the previous file whole. `permissions`
/// go on before any data does, so a private file is never briefly readable.
fn replace_file(
    path: &Path,
    permissions: Option<Permissions>,
    write: impl FnOnce(&mut File) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = path.with_file_name(format!("{name}.tmp-{}", std::process::id()));
    let result = File::create(&temp).and_then(|mut file| {
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        write(&mut file)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// `app_settings_load`, reads the whole settings map, backing the frame's
/// `SettingsStorage` adapter at app boot.
#[tauri::command]
pub async fn app_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<LoadedSettings, String> {
    load_settings(&coilbox_portable::settings_file(&app)?)
}

/// `app_settings_save`, persists the whole settings map. The adapter sends the
/// full map on every change, so this is an atomic overwrite with no merge races.
#[tauri::command]
pub async fn app_settings_save<R: Runtime>(
    app: AppHandle<R>,
    entries: Settings,
) -> Result<(), String> {
    save_settings(&coilbox_portable::settings_file(&app)?, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_empty() {
        let p = std::env::temp_dir().join("coilbox_settings_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load_settings(&p).unwrap().entries.len(), 0);
    }

    #[test]
    fn roundtrips_opaque_string_values() {
        let dir = std::env::temp_dir().join("coilbox_settings_test");
        let p = dir.join("settings.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut s = Settings::new();
        // Values arrive already JSON-encoded by the frame store, so we treat them as opaque.
        s.insert("uberstress.config".into(), r#"{"servers":[]}"#.into());
        save_settings(&p, &s).unwrap();
        let back = load_settings(&p).unwrap().entries;
        assert_eq!(
            back.get("uberstress.config").map(String::as_str),
            Some(r#"{"servers":[]}"#)
        );
    }

    fn settings_in(dir: &Path) -> PathBuf {
        dir.join("settings.json")
    }

    /// Every file in `dir`, by name, sorted.
    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_non_string_value_keeps_the_original_bytes_through_a_load_and_a_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        let original = br#"{"lobbyServers.accounts":"[1]","window.fullscreen":true}"#;
        std::fs::write(&path, original).unwrap();

        let loaded = load_settings(&path).unwrap();
        let copy = loaded.recovered_copy.unwrap();
        assert!(copy.starts_with(dir.path()));
        assert_eq!(std::fs::read(&copy).unwrap(), original);

        let mut next = loaded.entries;
        next.insert("onboarding.settled".into(), "[]".into());
        save_settings(&path, &next).unwrap();
        assert_eq!(std::fs::read(&copy).unwrap(), original);
        assert_eq!(load_settings(&path).unwrap().entries, next);
    }

    /// One bad value costs that value and nothing else, and the file left behind
    /// is good, so the next launch has nothing to recover.
    #[test]
    fn a_non_string_value_costs_only_itself() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::write(&path, r#"{"a":"\"kept\"","b":true,"c":null}"#).unwrap();

        let loaded = load_settings(&path).unwrap();
        assert_eq!(
            loaded.entries,
            Settings::from([("a".to_string(), "\"kept\"".to_string())])
        );

        let again = load_settings(&path).unwrap();
        assert_eq!(again.entries, loaded.entries);
        assert!(again.recovered_copy.is_none());
    }

    /// Each of these is a file a crash, a full disk or a hand edit can leave. None
    /// has values to keep.
    #[test]
    fn a_file_with_no_usable_values_is_moved_aside_whole() {
        let cases: [&[u8]; 5] = [b"", b"{\"a\":\"tru", b"[1,2]", b"null", b"\xff\xfe{}"];
        for original in cases {
            let dir = tempfile::tempdir().unwrap();
            let path = settings_in(dir.path());
            std::fs::write(&path, original).unwrap();

            let loaded = load_settings(&path).unwrap();
            assert!(loaded.entries.is_empty());
            assert_eq!(
                std::fs::read(loaded.recovered_copy.unwrap()).unwrap(),
                original
            );
            assert_eq!(std::fs::read(&path).unwrap(), b"{}");
        }
    }

    #[test]
    fn a_good_file_stays_where_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::write(&path, r#"{"a":"1"}"#).unwrap();

        assert!(load_settings(&path).unwrap().recovered_copy.is_none());
        assert_eq!(files_in(dir.path()), ["settings.json"]);
    }

    /// Being unable to read a file says nothing about what is in it. A directory
    /// is a read failure that works on every OS.
    #[test]
    fn a_file_that_cannot_be_read_is_an_error_and_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::create_dir(&path).unwrap();

        assert!(load_settings(&path).is_err());
        assert_eq!(files_in(dir.path()), ["settings.json"]);
        assert!(path.is_dir());
    }

    #[test]
    fn a_save_that_fails_part_way_leaves_the_previous_file_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::write(&path, "previous").unwrap();

        let result = replace_file(&path, None, |file| {
            file.write_all(b"half")?;
            Err(std::io::Error::other("disk full"))
        });

        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
        assert_eq!(files_in(dir.path()), ["settings.json"]);
    }

    /// The last step failing, where a file cannot be renamed over a directory.
    #[test]
    fn a_save_whose_rename_fails_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::create_dir(&path).unwrap();

        assert!(save_settings(&path, &Settings::new()).is_err());
        assert_eq!(files_in(dir.path()), ["settings.json"]);
    }

    /// Lobby accounts are in this file, so a player who made it private keeps it
    /// private through a save and through a recovery.
    #[cfg(unix)]
    #[test]
    fn a_private_file_stays_private() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        let private = || Permissions::from_mode(0o600);

        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, private()).unwrap();
        save_settings(&path, &Settings::new()).unwrap();
        assert_eq!(mode(&path), 0o600);

        std::fs::write(&path, r#"{"a":true}"#).unwrap();
        let copy = load_settings(&path).unwrap().recovered_copy.unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&copy), 0o600);
    }

    #[test]
    fn a_save_replaces_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(dir.path());
        std::fs::write(&path, r#"{"old":"1"}"#).unwrap();

        let next = Settings::from([("new".to_string(), "2".to_string())]);
        save_settings(&path, &next).unwrap();

        assert_eq!(load_settings(&path).unwrap().entries, next);
        assert_eq!(files_in(dir.path()), ["settings.json"]);
    }
}
