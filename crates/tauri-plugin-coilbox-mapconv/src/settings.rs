//! Generic string key/value store backing the frame's `SettingsStorage` adapter.
//! The frame JSON-stringifies each setting value before handing it to storage, so
//! we persist an opaque `string -> string` map to app-data and let the frontend
//! own the value shapes. Identical in shape to the uberstress plugin's store.

use std::collections::BTreeMap;
use std::path::Path;

pub type Settings = BTreeMap<String, String>;

/// Read the settings map from `path`, returning an empty map if it doesn't exist.
pub fn load_settings(path: &Path) -> Result<Settings, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid settings json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::new()),
        Err(e) => Err(format!("could not read settings: {e}")),
    }
}

/// Write the full settings map to `path`, creating the parent dir if needed.
pub fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create settings dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_empty() {
        let p = std::env::temp_dir().join("mapconv_settings_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load_settings(&p).unwrap().len(), 0);
    }

    #[test]
    fn roundtrips_opaque_string_values() {
        let dir = std::env::temp_dir().join("mapconv_settings_test");
        let p = dir.join("settings.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut s = Settings::new();
        // Values arrive already JSON-encoded by the frame store; we treat them as opaque.
        s.insert("mapconv.config".into(), r#"{"rememberDirs":true}"#.into());
        save_settings(&p, &s).unwrap();
        let back = load_settings(&p).unwrap();
        assert_eq!(back.get("mapconv.config").map(String::as_str), Some(r#"{"rememberDirs":true}"#));
    }
}
