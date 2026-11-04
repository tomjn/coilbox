//! The engine settings one launch adds on top of the player's own.
//!
//! The engine reads a `springsettings.cfg` in every data folder as extra
//! settings, behind the one in its write folder
//! (`rts/System/Config/ConfigLocater.cpp`, `GetDefaultLocations`), and only
//! ever writes to that one. So a folder of coilbox's own, added after every
//! other folder in `SPRING_DATADIR`, carries settings for one launch and leaves
//! the player's file alone. A key the player's file also sets keeps the
//! player's value, which is why coilbox sets only keys no game writes.
//!
//! Two things go there. The autohost's port, for the unit builder's sandbox
//! (issue #3346), and coilbox's language as [`LANGUAGE_KEY`], so the in-game
//! widgets draw in it in a networked game too (issue #5046). The engine sends
//! the host's start script to every player who joins, so a mod option can only
//! carry one language. Each player's own settings are read on their own
//! machine.

use crate::script::BattleConfig;
use std::path::{Path, PathBuf};

/// The config key coilbox's in-game widgets read the player's language from,
/// in `coilbox_i18n.lua` beside each of them, where it is `M.CONFIG`. The
/// engine reads config keys case and all, so the two must be spelt alike.
pub const LANGUAGE_KEY: &str = "CoilboxLanguage";

/// The folder a launch adds to `SPRING_DATADIR`, under coilbox's own app data.
/// It goes last, so it is never the engine's write folder.
pub fn settings_dir(app_data: &Path) -> PathBuf {
    app_data.join("play").join("launch")
}

/// The language to write as [`LANGUAGE_KEY`], or `None` to leave it out.
///
/// English is the widgets' own language, so it is not written, which leaves a
/// game's own `language` setting to count as it did before. The code goes into
/// a settings file a line at a time, so anything but the letters, digits, `-`
/// and `_` a locale code is made of is refused rather than written.
pub fn language(cfg: &BattleConfig) -> Result<Option<&str>, String> {
    let Some(code) = cfg.language.as_deref().map(str::trim) else {
        return Ok(None);
    };
    if code.is_empty() || code.eq_ignore_ascii_case("en") {
        return Ok(None);
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("{code:?} is not a language code"));
    }
    Ok(Some(code))
}

/// The settings file's text, or `None` when this launch has nothing to add.
pub fn text(autohost_port: Option<u16>, language: Option<&str>) -> Option<String> {
    let mut text = String::new();
    if let Some(port) = autohost_port {
        text.push_str(&format!("AutohostIP = 127.0.0.1\nAutohostPort = {port}\n"));
    }
    if let Some(code) = language {
        text.push_str(&format!("{LANGUAGE_KEY} = {code}\n"));
    }
    (!text.is_empty()).then_some(text)
}

/// Write `text` as the settings file in `dir`.
pub fn write(dir: &Path, text: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let file = dir.join("springsettings.cfg");
    std::fs::write(&file, text).map_err(|e| format!("could not write {}: {e}", file.display()))
}

/// `datadir` with `extra` after every folder already in it, so the engine's
/// write folder and the player's own settings both stay first.
pub fn with_extra_datadir(datadir: &str, extra: &Path) -> Result<String, String> {
    let extra = extra.to_string_lossy();
    if extra.contains(coilbox_proc::DATADIR_SEP) {
        return Err(format!(
            "{extra} cannot be a data folder: its name has a {} in it",
            coilbox_proc::DATADIR_SEP
        ));
    }
    Ok(if datadir.is_empty() {
        extra.into_owned()
    } else {
        format!("{datadir}{}{extra}", coilbox_proc::DATADIR_SEP)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_language(code: &str) -> BattleConfig {
        BattleConfig {
            language: Some(code.into()),
            ..BattleConfig::default()
        }
    }

    #[test]
    fn the_settings_point_the_engine_at_the_port() {
        let text = text(Some(53344), None).expect("text");
        assert_eq!(text, "AutohostIP = 127.0.0.1\nAutohostPort = 53344\n");
    }

    /// Issue #5046: the language goes into the launch's settings, not the
    /// script, so a networked host writes it for itself alone.
    #[test]
    fn the_language_is_a_key_of_its_own() {
        assert_eq!(
            text(None, Some("fr")).as_deref(),
            Some("CoilboxLanguage = fr\n")
        );
        let both = text(Some(53344), Some("de")).expect("text");
        assert!(both.contains("AutohostPort = 53344\n"), "{both}");
        assert!(both.ends_with("CoilboxLanguage = de\n"), "{both}");
    }

    #[test]
    fn a_launch_with_nothing_to_add_has_no_settings() {
        assert_eq!(text(None, None), None);
    }

    #[test]
    fn a_networked_host_and_a_joining_player_each_write_their_own() {
        let mut host = with_language("fr");
        host.host_port = Some(8452);
        assert_eq!(language(&host), Ok(Some("fr")));
        let mut client = with_language("de");
        client.is_host = false;
        client.host_ip = Some("192.0.2.1".into());
        client.host_port = Some(8452);
        assert_eq!(language(&client), Ok(Some("de")));
    }

    #[test]
    fn english_and_no_language_write_nothing() {
        assert_eq!(language(&with_language("en")), Ok(None));
        assert_eq!(language(&with_language(" EN ")), Ok(None));
        assert_eq!(language(&with_language("")), Ok(None));
        assert_eq!(language(&BattleConfig::default()), Ok(None));
    }

    #[test]
    fn a_code_is_trimmed_and_keeps_its_script_and_region() {
        assert_eq!(language(&with_language(" zh-Hans ")), Ok(Some("zh-Hans")));
        assert_eq!(language(&with_language("pt_BR")), Ok(Some("pt_BR")));
    }

    #[test]
    fn a_code_that_would_add_a_setting_is_refused() {
        assert!(language(&with_language("de\nAutohostPort = 1")).is_err());
        assert!(language(&with_language("de = x")).is_err());
    }

    #[test]
    fn the_settings_are_written_where_the_engine_looks() {
        let dir = std::env::temp_dir().join(format!("coilbox-launch-{}", std::process::id()));
        write(&dir, "CoilboxLanguage = fr\n").expect("write");
        let read = std::fs::read_to_string(dir.join("springsettings.cfg")).expect("read");
        assert_eq!(read, "CoilboxLanguage = fr\n");
        std::fs::remove_dir_all(&dir).expect("clean up");
    }

    #[test]
    fn the_settings_folder_goes_after_every_other_data_folder() {
        let sep = coilbox_proc::DATADIR_SEP;
        let joined = with_extra_datadir(&format!("/a{sep}/b"), Path::new("/c")).expect("joined");
        assert_eq!(joined, format!("/a{sep}/b{sep}/c"));
        assert!(with_extra_datadir("/a", Path::new(&format!("/c{sep}d"))).is_err());
    }
}
