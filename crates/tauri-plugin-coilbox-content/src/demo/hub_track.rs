//! Getting the hub's track of a match (issue #5520).
//!
//! The hub lists a match's tracks at `GET /api/v1/replays/{game_id}/tracks`,
//! which needs no sign in. The contract is `hub-php/docs/replay-uploads.md` in
//! coilbox-hub, "Getting a replay's track".
//!
//! Only a track this build would play is offered: in the format it reads, from
//! its recorder version, and with an address to fetch it from. What is fetched
//! must have the size and the SHA-256 the hub gave, and then goes through
//! [`track_store::store`] like a recorded one, so a file for another match is
//! not kept either. Nothing here runs unless the player asks.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use coilbox_track_thin::RECORDER_VERSION;
use coilbox_ui_error::UiError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};

use super::analysis::store::valid_game_id;
use super::track_budget;
use super::track_store::{self, TrackState};

/// Longest the wait for a connection may be.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// Longest a request may go without a byte arriving. A whole download has no
/// limit, so a slow connection that keeps moving finishes.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// Largest list of tracks that is read. The hub answers one short entry for
/// each format version.
const LIST_LIMIT: u64 = 64 * 1024;

/// Codes for what can go wrong. `src/i18n/uiError.ts` has an entry for each.
pub const UNREACHABLE: &str = "content.hub_track.unreachable";
pub const BAD_ANSWER: &str = "content.hub_track.bad_answer";
pub const FETCH_FAILED: &str = "content.hub_track.fetch_failed";
pub const MISMATCH: &str = "content.hub_track.mismatch";
pub const NOT_PLAYABLE: &str = "content.hub_track.not_playable";

/// One entry of the hub's list.
#[derive(Deserialize, Debug)]
struct Listed {
    format_version: u16,
    state: String,
    /// Null while the hub is checking the track.
    recorder_version: Option<u16>,
    size: u64,
    sha256: String,
    /// Null while the track is being checked, and while its mirror is switched
    /// off or unhealthy.
    url: Option<String>,
}

#[derive(Deserialize)]
struct List {
    tracks: Vec<Listed>,
}

#[derive(Deserialize)]
struct Refusal {
    reason: String,
}

/// A track on the hub that this build can play.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub size: u64,
    sha256: String,
    url: String,
}

fn offer(tracks: Vec<Listed>) -> Option<Offer> {
    tracks.into_iter().find_map(|track| {
        let playable = track.state == "listed"
            && track.format_version == coilbox_track::FORMAT_VERSION
            && track.recorder_version == Some(RECORDER_VERSION);
        let url = track.url.filter(|url| !url.is_empty())?;
        playable.then_some(Offer {
            size: track.size,
            sha256: track.sha256,
            url,
        })
    })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("coilbox")
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(IDLE_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Read a body, giving up as soon as it is longer than `limit`. None for a body
/// that is longer.
async fn read_up_to(
    mut response: reqwest::Response,
    limit: u64,
) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() as u64 + chunk.len() as u64 > limit {
            return Ok(None);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

/// The track the hub at `hub_url` has of a match that this build can play, or
/// None when it has no such track or does not list the replay.
pub async fn find(hub_url: &str, game_id: &str) -> Result<Option<Offer>, String> {
    let game_id = valid_game_id(game_id)?;
    let url = format!(
        "{}/api/v1/replays/{game_id}/tracks",
        hub_url.trim().trim_end_matches('/')
    );
    let unreachable = |_| -> String {
        UiError::new(
            UNREACHABLE,
            "Could not reach the hub. Try again in a moment.",
        )
        .into()
    };
    let bad_answer = || -> String {
        UiError::new(
            BAD_ANSWER,
            "The hub did not answer with its list of tracks. Try again in a moment.",
        )
        .into()
    };
    let response = client()?
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(unreachable)?;
    let status = response.status();
    let body = read_up_to(response, LIST_LIMIT)
        .await
        .map_err(unreachable)?
        .ok_or_else(bad_answer)?;
    if status == reqwest::StatusCode::NOT_FOUND
        && serde_json::from_slice::<Refusal>(&body).is_ok_and(|r| r.reason == "not_listed")
    {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(bad_answer());
    }
    let list: List = serde_json::from_slice(&body).map_err(|_| bad_answer())?;
    Ok(offer(list.tracks))
}

/// What asking for a match's track came to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Downloaded {
    /// The match now has a current track.
    Stored,
    /// The hub no longer has one to give.
    Unavailable,
}

/// Fetch the hub's track of a match into the store in `tracks`, then bring the
/// store within `budget`. A match that already has a current track keeps it.
///
/// The hub is asked again, so the address and the hash are its latest. A file
/// that is not the size or the hash it gave, or that does not read as a current
/// track for this match, is thrown away and whatever was stored stays.
pub async fn download(
    hub_url: &str,
    tracks: &Path,
    game_id: &str,
    budget: u64,
) -> Result<Downloaded, String> {
    let game_id = valid_game_id(game_id)?;
    if track_store::state(tracks, &game_id)? == Some(TrackState::Current) {
        return Ok(Downloaded::Stored);
    }
    let Some(offer) = find(hub_url, &game_id).await? else {
        return Ok(Downloaded::Unavailable);
    };
    let bytes = fetch(&offer).await?;
    let tracks = tracks.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        track_store::store(&tracks, &game_id, |path| std::fs::write(path, &bytes)).map_err(
            |why| -> String {
                UiError::new(
                    NOT_PLAYABLE,
                    format!("The hub's track was not kept: {why}."),
                )
                .into()
            },
        )?;
        track_budget::enforce(&tracks, Some(&game_id), budget, &HashSet::new());
        Ok(Downloaded::Stored)
    })
    .await
    .map_err(|e| format!("the track download task failed: {e}"))?
}

/// The offered file's bytes, only if they are what the hub said they would be.
async fn fetch(offer: &Offer) -> Result<Vec<u8>, String> {
    let failed = |_| -> String {
        UiError::new(
            FETCH_FAILED,
            "The track could not be downloaded. Try again in a moment.",
        )
        .into()
    };
    let mismatch = || -> String {
        UiError::new(
            MISMATCH,
            "The downloaded file was not the track the hub described, so it was thrown away.",
        )
        .into()
    };
    let response = client()?
        .get(&offer.url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(failed)?;
    let bytes = read_up_to(response, offer.size)
        .await
        .map_err(failed)?
        .ok_or_else(mismatch)?;
    let sha256: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if bytes.len() as u64 != offer.size || !sha256.eq_ignore_ascii_case(&offer.sha256) {
        return Err(mismatch());
    }
    Ok(bytes)
}

/// `content_replay_hub_track`: whether the hub at `hubUrl` has a track of a
/// match that this build can play. Answers `track` with its `size`, or null.
#[tauri::command]
pub(crate) async fn content_replay_hub_track(
    hub_url: String,
    game_id: String,
) -> picoframe_core::CliResult {
    match find(&hub_url, &game_id).await {
        Ok(found) => picoframe_core::CliResult::ok(serde_json::json!({
            "track": found.map(|offer| serde_json::json!({ "size": offer.size })),
        })),
        Err(e) => picoframe_core::CliResult::err(e),
    }
}

/// `content_replay_hub_track_download`: fetch the hub's track of a match and
/// store it as a recorded one is. Answers `outcome`, `stored` or `unavailable`.
#[tauri::command]
pub(crate) async fn content_replay_hub_track_download<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    game_id: String,
) -> picoframe_core::CliResult {
    let places = track_store::app_store_dir(&app)
        .and_then(|tracks| Ok((tracks, coilbox_portable::settings_file(&app)?)));
    let (tracks, settings) = match places {
        Ok(places) => places,
        Err(e) => return picoframe_core::CliResult::err(e),
    };
    let budget = track_budget::read_budget(&settings);
    match download(&hub_url, &tracks, &game_id, budget).await {
        Ok(outcome) => picoframe_core::CliResult::ok(serde_json::json!({ "outcome": outcome })),
        Err(e) => picoframe_core::CliResult::err(e),
    }
}

#[cfg(test)]
mod tests;
