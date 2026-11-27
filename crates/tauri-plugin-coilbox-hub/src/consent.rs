//! Agreeing to send pictures and facts off this machine (issue #1635).
//!
//! Coilbox can read the game and map archives on this computer, render pictures
//! from what is inside them, and upload those pictures to the hub as the signed-in
//! account. It does none of that until somebody agrees to it, and this module is
//! the only place that decides whether they have.
//!
//! Agreement is needed at all for three reasons that stack:
//!
//! - The pictures are derived from other people's game and map archives, and not
//!   every archive is clear about what may be done with what is inside it.
//! - An upload is attributed to the account that made it and lands in a public
//!   repository with permanent history, so a mistake is much harder to undo than
//!   deleting a file.
//! - Each upload spends storage the whole community shares.
//!
//! # Ways to agree
//!
//! The switch, "Send pictures of your games and maps to the hub", is agreement to
//! automatic sends: the library sweeps and the blueprint backfill. It is off by
//! default, and [`AssetUploadConsent::check`] with no grant reads it off disk.
//!
//! A press of "Send to hub" on one map or game's page is agreement to that one
//! send, whatever the switch says. The page asks [`begin_grant`] for a grant
//! naming the game or map, passes its id to every command the send makes, and
//! ends it with [`end_grant`] when the send stops for any reason. A proof made
//! from a grant admits only that subject, so a grant for one map cannot carry
//! another map or a game's pictures. Grants live in memory and die with the app.
//!
//! Replays have their own switch, "Send my finished matches to the hub", also
//! off by default (issue #5494). [`AssetUploadConsent::check_replay`] reads it,
//! and its proof admits replays, their analyses and their tracks (issue #5495)
//! and nothing else.
//!
//! A distribution profile that turned the hub or its uploads off refuses all of
//! them.
//!
//! # Why this is in Rust
//!
//! The webview draws the switch and the button, but the switch is read here off
//! disk, and the subject check is made here against every item in a request. The
//! proof, [`AssetUploadConsent`], is the only way to call [`crate::have::have`] or
//! any send beside it. The type has a private field and no other constructor, so
//! obtaining one means [`AssetUploadConsent::check`] ran and said yes.
//!
//! A new send path should take `&AssetUploadConsent`, call the matching `admits_*`
//! method on what it is about to send, and let its command call `check` once, at
//! the start of the operation. Do not cache one for the life of the session: a
//! proof is that the user had agreed when the operation began, not that they
//! agreed once.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::have::AssetIdentity;

/// The user setting, as the frame stores it. Values in that map are JSON-encoded,
/// so the string here is `true` or `false` rather than a bare word, and anything
/// else is not an answer. Mirrored in `src/hub/assetUploads.ts`.
pub const SETTING_KEY: &str = "hub.assetUploads";

/// What a refused upload says. Names the switch and where it is, because the
/// operation that hit this was very likely started by something automatic and the
/// reader has no other clue what asked.
pub const REFUSED: &str = "Coilbox has not been given permission to send pictures to the hub. Turn on \"Send pictures of your games and maps to the hub\" in Settings > Coilbox hub first.";

/// What a manual send refused by the distribution profile says.
pub const PROFILE_REFUSED: &str =
    "This copy of coilbox has been set up not to send anything to the hub.";

/// What a send whose grant has ended says. The send was stopped, or it finished
/// and something carried on calling.
pub const GRANT_ENDED: &str = "This send to the hub has already ended.";

/// What an engine send without a grant says.
pub const ENGINE_NEEDS_GRANT: &str =
    "An engine build is only sent when you press its upload button.";

/// The switch that sends finished matches (issue #5494), stored as
/// [`SETTING_KEY`] is. Mirrored in `src/hub/replaySend/queue.ts`.
pub const AUTO_REPLAY_SETTING_KEY: &str = "hub.autoSendReplays";

/// What a replay send without a grant says while that switch is off.
pub const REPLAY_NEEDS_GRANT: &str = "A replay is only sent when you press its send button, or when \"Send my finished matches to the hub\" is on in Settings > Coilbox hub.";

/// What anything but a replay is told by a proof from the replay switch.
pub const REPLAYS_ONLY: &str =
    "Sending finished matches to the hub does not cover sending anything else.";

/// The one game, map or engine build a manual send is for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SendSubject {
    /// A game, by its modinfo shortname, compared ignoring case as the hub does.
    Game { shortname: String },
    /// A map, by its full name, compared exactly as the hub does.
    Map { map_name: String },
    /// An engine build, by its archive's file name.
    Engine { filename: String },
    /// A match replay, by the game id in its header (issue #5493).
    Replay { game_id: String },
    /// A match's analysis, by the replay's game id (issue #5495).
    Analysis { game_id: String },
    /// A match's recorded track, by the replay's game id (issue #5495).
    Track { game_id: String },
}

impl SendSubject {
    fn name(&self) -> &str {
        match self {
            Self::Game { shortname } => shortname,
            Self::Map { map_name } => map_name,
            Self::Engine { filename } => filename,
            Self::Replay { game_id } | Self::Analysis { game_id } | Self::Track { game_id } => {
                game_id
            }
        }
    }

    fn refuse(&self, other: &str) -> String {
        format!(
            "This send was started for {} and cannot send {other}.",
            self.name()
        )
    }
}

/// Proof that sending was permitted when the operation began.
///
/// Its value is that it cannot be made any other way: the field is private and
/// [`check`](Self::check) and [`check_replay`](Self::check_replay) are the only
/// constructors, so a function taking one cannot be reached without a check
/// having run. A proof carries what was agreed to, and the `admits_*` methods
/// hold a send to it. See the module docs.
#[derive(Debug)]
pub struct AssetUploadConsent(Agreed);

/// What the user agreed to.
#[derive(Debug)]
enum Agreed {
    /// The pictures switch.
    Pictures,
    /// One send they pressed a button for.
    Grant(SendSubject),
    /// The switch that sends finished matches.
    Replays,
}

impl AssetUploadConsent {
    /// Read the profile, and either the setting or the grant, and hand back a proof
    /// or say why not.
    ///
    /// Both files come off disk on every call rather than from anything the webview
    /// said. The settings file is the frame's own store, written through as soon as
    /// the switch is flipped, so what is read here is what the user last saved.
    /// That write is asynchronous, so the frontend waits for it before starting
    /// anything that ends up here, rather than this having to allow for a stale
    /// file (issue #1674, `settingsWritten` in `src/lib/storedSetting.ts`).
    pub fn check<R: Runtime>(app: &AppHandle<R>, grant: Option<&str>) -> Result<Self, String> {
        let profile = read_profile();
        if let Some(id) = grant {
            if !profile_permits(profile.as_deref()) {
                return Err(PROFILE_REFUSED.to_string());
            }
            return grant_subject(id)
                .map(|subject| Self(Agreed::Grant(subject)))
                .ok_or_else(|| GRANT_ENDED.to_string());
        }
        if permitted(profile.as_deref(), read_settings(app)?.as_deref()) {
            Ok(Self(Agreed::Pictures))
        } else {
            Err(REFUSED.to_string())
        }
    }

    /// The check for a replay: the grant a press of its send button opened, or
    /// without one the switch that sends finished matches, read off disk. The
    /// pictures switch says nothing about replays.
    pub fn check_replay<R: Runtime>(
        app: &AppHandle<R>,
        grant: Option<&str>,
    ) -> Result<Self, String> {
        if grant.is_some() {
            return Self::check(app, grant);
        }
        if permitted_by(
            read_profile().as_deref(),
            read_settings(app)?.as_deref(),
            AUTO_REPLAY_SETTING_KEY,
        ) {
            Ok(Self(Agreed::Replays))
        } else {
            Err(REPLAY_NEEDS_GRANT.to_string())
        }
    }

    /// The one thing this proof is held to, or `None` for the pictures switch,
    /// which covers any picture, map or game. The replay switch covers none of
    /// those.
    fn subject(&self) -> Result<Option<&SendSubject>, String> {
        match &self.0 {
            Agreed::Pictures => Ok(None),
            Agreed::Grant(subject) => Ok(Some(subject)),
            Agreed::Replays => Err(REPLAYS_ONLY.to_string()),
        }
    }

    /// Whether every picture named here belongs to this proof's subject. A game's
    /// unit and faction pictures belong to the game, and a map's to the map.
    pub fn admits_assets<'a>(
        &self,
        identities: impl IntoIterator<Item = &'a AssetIdentity>,
    ) -> Result<(), String> {
        let Some(subject) = self.subject()? else {
            return Ok(());
        };
        for identity in identities {
            let fits = match (subject, identity) {
                (
                    SendSubject::Game { shortname },
                    AssetIdentity::Unit { game, .. } | AssetIdentity::Faction { game, .. },
                ) => game.eq_ignore_ascii_case(shortname),
                (
                    SendSubject::Map { map_name },
                    AssetIdentity::Map {
                        map_name: named, ..
                    },
                ) => named == map_name,
                _ => false,
            };
            if !fits {
                let other = match identity {
                    AssetIdentity::Unit { game, .. } | AssetIdentity::Faction { game, .. } => game,
                    AssetIdentity::Map { map_name, .. } => map_name,
                };
                return Err(subject.refuse(other));
            }
        }
        Ok(())
    }

    /// Whether every map named here is this proof's subject.
    pub fn admits_maps<'a>(&self, names: impl IntoIterator<Item = &'a str>) -> Result<(), String> {
        let Some(subject) = self.subject()? else {
            return Ok(());
        };
        for name in names {
            if !matches!(subject, SendSubject::Map { map_name } if map_name == name) {
                return Err(subject.refuse(name));
            }
        }
        Ok(())
    }

    /// Whether this game is this proof's subject.
    pub fn admits_game(&self, shortname: &str) -> Result<(), String> {
        match self.subject()? {
            None => Ok(()),
            Some(SendSubject::Game { shortname: granted })
                if granted.eq_ignore_ascii_case(shortname) =>
            {
                Ok(())
            }
            Some(subject) => Err(subject.refuse(shortname)),
        }
    }

    /// Whether this engine build is this proof's subject. An engine is only ever
    /// sent by a press of its upload button, so the uploads switch, which is
    /// about pictures, never admits one.
    pub fn admits_engine(&self, filename: &str) -> Result<(), String> {
        match self.subject()? {
            None => Err(ENGINE_NEEDS_GRANT.to_string()),
            Some(SendSubject::Engine { filename: granted }) if granted == filename => Ok(()),
            Some(subject) => Err(subject.refuse(filename)),
        }
    }

    /// Whether this replay may go: it is the one whose send button was pressed,
    /// or finished matches are being sent. The pictures switch never admits one.
    pub fn admits_replay(&self, game_id: &str) -> Result<(), String> {
        match &self.0 {
            Agreed::Pictures => Err(REPLAY_NEEDS_GRANT.to_string()),
            Agreed::Replays => Ok(()),
            Agreed::Grant(SendSubject::Replay { game_id: granted }) if granted == game_id => Ok(()),
            Agreed::Grant(subject) => Err(subject.refuse(game_id)),
        }
    }

    /// Whether this match's analysis may go: it is the one whose send button
    /// was pressed, or finished matches are being sent. A grant for the replay
    /// itself does not cover its analysis, and the pictures switch never does.
    pub fn admits_analysis(&self, game_id: &str) -> Result<(), String> {
        match &self.0 {
            Agreed::Pictures => Err(REPLAY_NEEDS_GRANT.to_string()),
            Agreed::Replays => Ok(()),
            Agreed::Grant(SendSubject::Analysis { game_id: granted }) if granted == game_id => {
                Ok(())
            }
            Agreed::Grant(subject) => Err(subject.refuse(game_id)),
        }
    }

    /// Whether this match's track may go, on the same terms as its analysis.
    pub fn admits_track(&self, game_id: &str) -> Result<(), String> {
        match &self.0 {
            Agreed::Pictures => Err(REPLAY_NEEDS_GRANT.to_string()),
            Agreed::Replays => Ok(()),
            Agreed::Grant(SendSubject::Track { game_id: granted }) if granted == game_id => Ok(()),
            Agreed::Grant(subject) => Err(subject.refuse(game_id)),
        }
    }

    /// A switch-based proof for tests inside this crate, which have no app handle
    /// and no disk. Deliberately not `pub`, so it cannot stand in for a real check
    /// anywhere else.
    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self(Agreed::Pictures)
    }

    /// A grant-based proof for tests inside this crate.
    #[cfg(test)]
    pub(crate) fn for_test_subject(subject: SendSubject) -> Self {
        Self(Agreed::Grant(subject))
    }

    /// A proof from the replay switch, for tests inside this crate.
    #[cfg(test)]
    pub(crate) fn for_test_auto_replays() -> Self {
        Self(Agreed::Replays)
    }
}

/// The settings file's text, when there is one.
fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let settings = coilbox_portable::settings_file(app)?;
    Ok(std::fs::read_to_string(settings).ok())
}

/// The distribution profile's text, when this is a portable install with one.
fn read_profile() -> Option<String> {
    let path = coilbox_portable::portable_root()?.join("profile.json");
    std::fs::read_to_string(&path).ok()
}

/// The grants that are open, by id.
fn grants() -> &'static Mutex<HashMap<String, SendSubject>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, SendSubject>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Open a grant for one manual send and return its id, unless the distribution
/// profile has turned sending off.
pub fn begin_grant(subject: SendSubject) -> Result<String, String> {
    if !profile_permits(read_profile().as_deref()) {
        return Err(PROFILE_REFUSED.to_string());
    }
    open_grant(subject)
}

/// Store a grant under a fresh id. Split from [`begin_grant`] so a test can open
/// one without a profile on disk.
fn open_grant(subject: SendSubject) -> Result<String, String> {
    let id = coilbox_oauth::random_token(16).map_err(|e| e.to_string())?;
    grants().lock().unwrap().insert(id.clone(), subject);
    Ok(id)
}

/// Close a grant. A no-op for an id that is unknown or already closed.
pub fn end_grant(id: &str) {
    grants().lock().unwrap().remove(id);
}

fn grant_subject(id: &str) -> Option<SendSubject> {
    grants().lock().unwrap().get(id).cloned()
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
    permitted_by(profile_json, stored_setting, SETTING_KEY)
}

/// [`permitted`] for the switch stored under `key`.
fn permitted_by(profile_json: Option<&str>, stored_setting: Option<&str>, key: &str) -> bool {
    if !profile_permits(profile_json) {
        return false;
    }
    let settings: Value = match stored_setting.map(serde_json::from_str) {
        Some(Ok(value)) => value,
        _ => return false,
    };
    settings.get(key).and_then(Value::as_str) == Some("true")
}

/// The profile's half of the decision, which a manual send also has to pass.
/// No profile leaves it to the user. A profile that will not parse is not a
/// profile that said yes: the frontend surfaces the parse error in the health
/// panel, and here it is simply not permission.
fn profile_permits(profile_json: Option<&str>) -> bool {
    let Some(profile) = profile_json else {
        return true;
    };
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(profile) else {
        return false;
    };
    ["hub", "hubAssetUploads"]
        .iter()
        .all(|key| fields.get(*key) != Some(&Value::Bool(false)))
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

    fn game(shortname: &str) -> SendSubject {
        SendSubject::Game {
            shortname: shortname.into(),
        }
    }

    fn map(name: &str) -> SendSubject {
        SendSubject::Map {
            map_name: name.into(),
        }
    }

    fn unit(game: &str) -> AssetIdentity {
        AssetIdentity::Unit {
            game: game.into(),
            unit_name: "armcom".into(),
            variant: "buildpic".into(),
        }
    }

    fn map_picture(name: &str) -> AssetIdentity {
        AssetIdentity::Map {
            map_name: name.into(),
            variant: "minimap".into(),
        }
    }

    #[test]
    fn no_profile_leaves_a_manual_send_to_the_user() {
        assert!(profile_permits(None));
        assert!(profile_permits(Some(r#"{"version":1}"#)));
    }

    #[test]
    fn a_profile_with_uploads_off_refuses_a_manual_send_too() {
        assert!(!profile_permits(Some(r#"{"hubAssetUploads":false}"#)));
        assert!(!profile_permits(Some(r#"{"hub":false}"#)));
        assert!(!profile_permits(Some("{ not json")));
    }

    #[test]
    fn a_game_grant_admits_its_own_pictures_ignoring_case() {
        let proof = AssetUploadConsent::for_test_subject(game("SF"));
        let faction = AssetIdentity::Faction {
            game: "sf".into(),
            faction_key: "arm".into(),
            variant: "logo".into(),
        };
        assert!(proof.admits_assets([&unit("sf"), &faction]).is_ok());
        assert!(proof.admits_game("sf").is_ok());
    }

    #[test]
    fn a_game_grant_refuses_another_game_and_any_map() {
        let proof = AssetUploadConsent::for_test_subject(game("sf"));
        assert_eq!(
            proof.admits_assets([&unit("sf"), &unit("ba")]),
            Err("This send was started for sf and cannot send ba.".into())
        );
        assert!(proof.admits_assets([&map_picture("Tabula")]).is_err());
        assert!(proof.admits_game("ba").is_err());
        assert!(proof.admits_maps(["Tabula"]).is_err());
    }

    #[test]
    fn a_map_grant_admits_only_its_own_map_exactly() {
        let proof = AssetUploadConsent::for_test_subject(map("Tabula v4"));
        assert!(proof.admits_maps(["Tabula v4"]).is_ok());
        assert!(proof.admits_assets([&map_picture("Tabula v4")]).is_ok());
        assert!(proof.admits_maps(["Tabula v4", "Comet Catcher"]).is_err());
        assert!(proof.admits_maps(["tabula v4"]).is_err());
        assert!(proof.admits_assets([&unit("sf")]).is_err());
        assert!(proof.admits_game("sf").is_err());
    }

    #[test]
    fn an_engine_needs_its_own_grant() {
        let filename = "recoil_2026.09.03_arm64-macos.7z";
        let granted = AssetUploadConsent::for_test_subject(SendSubject::Engine {
            filename: filename.into(),
        });
        assert!(granted.admits_engine(filename).is_ok());
        assert!(granted
            .admits_engine("recoil_2026.09.03_amd64-linux.7z")
            .is_err());
        assert!(granted.admits_game("bar").is_err());
        assert!(granted.admits_maps(["Comet Catcher"]).is_err());

        assert_eq!(
            AssetUploadConsent::for_test().admits_engine(filename),
            Err(ENGINE_NEEDS_GRANT.to_string())
        );
        assert!(AssetUploadConsent::for_test_subject(game("bar"))
            .admits_engine(filename)
            .is_err());
    }

    #[test]
    fn a_replay_needs_its_own_grant() {
        let id = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
        let granted =
            AssetUploadConsent::for_test_subject(SendSubject::Replay { game_id: id.into() });
        assert!(granted.admits_replay(id).is_ok());
        assert!(granted.admits_replay(&"0".repeat(32)).is_err());
        assert!(granted.admits_game("bar").is_err());
        assert_eq!(
            AssetUploadConsent::for_test().admits_replay(id),
            Err(REPLAY_NEEDS_GRANT.to_string())
        );
    }

    fn auto_replays(value: &str) -> String {
        format!(r#"{{"hub.autoSendReplays":"{value}"}}"#)
    }

    #[test]
    fn sending_finished_matches_is_off_until_turned_on() {
        let on = |stored: &str| permitted_by(None, Some(stored), AUTO_REPLAY_SETTING_KEY);
        assert!(!permitted_by(None, None, AUTO_REPLAY_SETTING_KEY));
        assert!(!on(&auto_replays("false")));
        assert!(on(&auto_replays("true")));
        // The pictures switch is a different question.
        assert!(!on(&settings("true")));
        assert!(!permitted(None, Some(&auto_replays("true"))));
    }

    #[test]
    fn a_profile_with_uploads_off_beats_the_replay_switch() {
        assert!(!permitted_by(
            Some(r#"{"hubAssetUploads":false}"#),
            Some(&auto_replays("true")),
            AUTO_REPLAY_SETTING_KEY,
        ));
    }

    #[test]
    fn an_analysis_and_a_track_each_need_their_own_grant() {
        let id = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
        let analysis =
            AssetUploadConsent::for_test_subject(SendSubject::Analysis { game_id: id.into() });
        assert!(analysis.admits_analysis(id).is_ok());
        assert!(analysis.admits_analysis(&"0".repeat(32)).is_err());
        assert!(analysis.admits_track(id).is_err());
        assert!(analysis.admits_replay(id).is_err());
        let track = AssetUploadConsent::for_test_subject(SendSubject::Track { game_id: id.into() });
        assert!(track.admits_track(id).is_ok());
        assert!(track.admits_analysis(id).is_err());
        let replay =
            AssetUploadConsent::for_test_subject(SendSubject::Replay { game_id: id.into() });
        assert!(replay.admits_analysis(id).is_err());
        assert!(replay.admits_track(id).is_err());
        assert!(AssetUploadConsent::for_test().admits_analysis(id).is_err());
        assert!(AssetUploadConsent::for_test().admits_track(id).is_err());
        let auto = AssetUploadConsent::for_test_auto_replays();
        assert!(auto.admits_analysis(id).is_ok());
        assert!(auto.admits_track(id).is_ok());
    }

    #[test]
    fn the_replay_switch_admits_any_replay_and_nothing_else() {
        let proof = AssetUploadConsent::for_test_auto_replays();
        assert!(proof.admits_replay(&"0".repeat(32)).is_ok());
        let refused = Err(REPLAYS_ONLY.to_string());
        assert_eq!(proof.admits_game("bar"), refused);
        assert_eq!(proof.admits_maps(["x"]), refused);
        assert_eq!(proof.admits_assets([&map_picture("x")]), refused);
        assert_eq!(proof.admits_engine("x.7z"), refused);
    }

    #[test]
    fn the_switch_proof_admits_everything() {
        let proof = AssetUploadConsent::for_test();
        assert!(proof
            .admits_assets([&unit("sf"), &map_picture("x")])
            .is_ok());
        assert!(proof.admits_maps(["x", "y"]).is_ok());
        assert!(proof.admits_game("anything").is_ok());
    }

    #[test]
    fn an_ended_grant_is_gone_and_others_stay() {
        let first = open_grant(game("sf")).unwrap();
        let second = open_grant(map("Tabula")).unwrap();
        assert_ne!(first, second);
        assert_eq!(grant_subject(&first), Some(game("sf")));
        end_grant(&first);
        assert_eq!(grant_subject(&first), None);
        assert_eq!(grant_subject(&second), Some(map("Tabula")));
        end_grant(&second);
        end_grant(&second);
        assert_eq!(grant_subject("never-opened"), None);
    }

    #[test]
    fn a_profile_that_will_not_parse_is_not_permission() {
        assert!(!permitted(Some("{ not json"), Some(&settings("true"))));
    }
}
