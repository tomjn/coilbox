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
use std::path::Path;

use tauri::{AppHandle, Runtime};

pub type Settings = BTreeMap<String, String>;

/// Read the settings map from `path`, returning an empty map if it doesn't exist.
fn load_settings(path: &Path) -> Result<Settings, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid settings json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::new()),
        Err(e) => Err(format!("could not read settings: {e}")),
    }
}

/// Write the full settings map to `path`, creating the parent dir if needed.
fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create settings dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write settings: {e}"))
}

/// `app_settings_load`, reads the whole settings map, backing the frame's
/// `SettingsStorage` adapter at app boot.
#[tauri::command]
pub async fn app_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<Settings, String> {
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
        assert_eq!(load_settings(&p).unwrap().len(), 0);
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
        let back = load_settings(&p).unwrap();
        assert_eq!(
            back.get("uberstress.config").map(String::as_str),
            Some(r#"{"servers":[]}"#)
        );
    }
}
