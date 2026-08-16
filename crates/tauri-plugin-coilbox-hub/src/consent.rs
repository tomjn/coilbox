//! Agreeing to send pictures off this machine (issue #1635).
//!
//! Coilbox can read the game and map archives on this computer, render pictures
//! from what is inside them, and upload those pictures to the hub as the signed-in
//! account. It does none of that until somebody turns it on, and this module is the
//! only place that decides whether it has been.
//!
//! Off by default rather than opt-out, for three reasons that stack:
//!
//! - The pictures are derived from other people's game and map archives, and not
//!   every archive is clear about what may be done with what is inside it.
//! - An upload is attributed to the account that made it and lands in a public
//!   repository with permanent history, so a mistake is much harder to undo than
//!   deleting a file.
//! - Each upload spends storage the whole community shares.
//!
//! # Why this is in Rust
//!
//! The webview draws the switch, but it does not get to be the thing that enforces
//! it. This reads the user's saved setting and the distribution profile off disk
//! itself, so no argument passed across the IPC boundary can turn an upload on, and
//! a caller that forgot to check cannot exist: the proof it produces,
//! [`AssetUploadConsent`], is the only way to call [`crate::have::have`] or any
//! upload added beside it. The type has a private field and no other constructor, so
//! obtaining one means [`AssetUploadConsent::check`] ran and said yes.
//!
//! A new upload path should take `&AssetUploadConsent` as an argument and let its
//! command call `check` once, at the start of the operation. Do not cache one for
//! the life of the session: a proof is that the user had agreed when the operation
//! began, not that they agreed once.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Runtime};

/// The user setting, as the frame stores it. Values in that map are JSON-encoded,
/// so the string here is `true` or `false` rather than a bare word, and anything
/// else is not an answer. Mirrored in `src/hub/assetUploads.ts`.
pub const SETTING_KEY: &str = "hub.assetUploads";

/// What a refused upload says. Names the switch and where it is, because the
/// operation that hit this was very likely started by something automatic and the
/// reader has no other clue what asked.
pub const REFUSED: &str = "Coilbox has not been given permission to send pictures to the hub. Turn on \"Send pictures of your games and maps to the hub\" in Settings > Coilbox hub first.";

/// Proof that asset uploads were permitted when the operation began.
///
/// Carries nothing. Its value is that it cannot be made any other way: the field is
/// private and [`check`](Self::check) is the only constructor, so a function taking
/// one cannot be reached without the check having run. See the module docs.
#[derive(Debug)]
pub struct AssetUploadConsent(());

impl AssetUploadConsent {
    /// Read the setting and the profile, and hand back a proof or say why not.
    ///
    /// Both come off disk on every call rather than from anything the webview said.
    /// The settings file is the frame's own store, written through as soon as the
    /// switch is flipped, so what is read here is what the user last saved. That
    /// write is asynchronous, so the frontend waits for it before starting anything
    /// that ends up here, rather than this having to allow for a stale file
    /// (issue #1674, `settingsWritten` in `src/lib/storedSetting.ts`).
    pub fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let settings = coilbox_portable::settings_file(app)?;
        let profile = coilbox_portable::portable_root().map(|root| root.join("profile.json"));
        let read = |path: &Path| std::fs::read_to_string(path).ok();
        if permitted(
            profile.as_deref().and_then(&read).as_deref(),
            read(&settings).as_deref(),
        ) {
            Ok(Self(()))
        } else {
            Err(REFUSED.to_string())
        }
    }

    /// A proof for tests inside this crate, which have no app handle and no disk.
    /// Deliberately not `pub`, so it cannot stand in for a real check anywhere else.
    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self(())
    }
}

/// The whole decision, over the raw text of the two files. Pure, so every branch is
/// testable without an app handle or a filesystem.
///
/// A distribution gets the last word, and it can only say no. `hub: false` switched
/// the hub off entirely, and `hubAssetUploads: false` allows the rest of the hub but
/// not uploads from it. Either beats the user setting, including one turned on
/// before the profile arrived.
///
/// Then the user setting, which has to say `true` and nothing else. Absent,
/// unreadable, or any other value is off, because the only way this reads as
/// agreement is if somebody stored agreement.
fn permitted(profile_json: Option<&str>, stored_setting: Option<&str>) -> bool {
    if let Some(profile) = profile_json {
        // A profile that will not parse is not a profile that said yes. The
        // frontend surfaces the parse error in the health panel. Here it is simply
        // not permission.
        let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(profile) else {
            return false;
        };
        for key in ["hub", "hubAssetUploads"] {
            if fields.get(key) == Some(&Value::Bool(false)) {
                return false;
            }
        }
    }
    let settings: Value = match stored_setting.map(serde_json::from_str) {
        Some(Ok(value)) => value,
        _ => return false,
    };
    settings.get(SETTING_KEY).and_then(Value::as_str) == Some("true")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The settings file as the frame writes it: a map of JSON-encoded values.
    fn settings(value: &str) -> String {
        format!(r#"{{"hub.assetUploads":"{value}","theme.accent":"\"blue\""}}"#)
    }

    #[test]
    fn a_fresh_install_has_not_agreed() {
        assert!(!permitted(None, None));
    }

    #[test]
    fn a_settings_file_that_says_nothing_about_it_has_not_agreed() {
        assert!(!permitted(None, Some(r#"{"theme.accent":"\"blue\""}"#)));
    }

    #[test]
    fn turning_it_on_is_the_only_thing_that_permits_it() {
        assert!(permitted(None, Some(&settings("true"))));
    }

    #[test]
    fn turning_it_back_off_refuses_again() {
        assert!(!permitted(None, Some(&settings("false"))));
    }

    /// Anything that is not the stored `true` is not agreement, however much it
    /// looks like one. A truthy-looking value here would be a setting nobody set.
    #[test]
    fn a_value_that_is_not_the_stored_true_is_not_agreement() {
        for value in ["1", "\\\"yes\\\"", "null", "", "TRUE"] {
            assert!(!permitted(None, Some(&settings(value))), "{value}");
        }
    }

    #[test]
    fn a_settings_file_that_will_not_parse_is_not_agreement() {
        assert!(!permitted(None, Some("{ not json")));
    }

    #[test]
    fn a_profile_that_says_nothing_leaves_it_to_the_user() {
        assert!(permitted(Some(r#"{"version":1}"#), Some(&settings("true"))));
        assert!(!permitted(Some(r#"{"version":1}"#), None));
    }

    /// A distribution that switched the hub off cannot be overridden by the
    /// setting: there is no hub to upload to.
    #[test]
    fn a_profile_with_the_hub_off_beats_the_setting() {
        assert!(!permitted(
            Some(r#"{"version":1,"hub":false}"#),
            Some(&settings("true"))
        ));
    }

    #[test]
    fn a_profile_can_allow_the_hub_and_still_refuse_uploads() {
        assert!(!permitted(
            Some(r#"{"version":1,"hub":true,"hubAssetUploads":false}"#),
            Some(&settings("true"))
        ));
    }

    /// The profile's own default is on, so `hubAssetUploads: true` is the same as
    /// saying nothing: the user still has to turn it on.
    #[test]
    fn a_profile_allowing_uploads_does_not_agree_on_the_users_behalf() {
        assert!(!permitted(
            Some(r#"{"version":1,"hubAssetUploads":true}"#),
            None
        ));
        assert!(permitted(
            Some(r#"{"version":1,"hubAssetUploads":true}"#),
            Some(&settings("true"))
        ));
    }

    #[test]
    fn a_profile_that_will_not_parse_is_not_permission() {
        assert!(!permitted(Some("{ not json"), Some(&settings("true"))));
    }
}
