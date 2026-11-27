//! Sending a replay's analysis to the hub (issue #5495).
//!
//! `POST /api/v1/replays/{game_id}/analyses` with the run's logger version and
//! its log, as `hub-php/docs/replay-analyses.md` in coilbox-hub sets out. The
//! hub answers at once with the analysis in the state its check has reached,
//! usually `checking`. It has no status route for an analysis, but the same
//! person sending the same log again gets their first answer back, in
//! whatever state its check left it, and nothing is checked twice. So sending
//! again is how the page and the background sender learn how the check ended.

use std::time::Duration;

use serde::Serialize;

use super::{hub_stop, send_once, signed_in_token, Source, Stop, TokenSource, REQUEST_TIMEOUT};
use crate::consent::AssetUploadConsent;
use crate::endpoint::{api_url, host_of};
use crate::upload::{RETRY_BACKOFF, UPLOAD_ATTEMPTS};

/// What the hub said about a sent analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AnalysisAnswer {
    /// The hub has the analysis. `state` is `checking`, `kept`, `agreed`,
    /// `older` or `refused`, and `reason` says why a refused one was refused.
    /// `again` is set when this person had sent the same log before, so the
    /// answer is that first send's.
    Sent {
        id: Option<u64>,
        state: String,
        reason: Option<String>,
        again: bool,
    },
    /// The hub did not take it, or could not be asked. `code` is the hub's
    /// `reason`, `unauthorised`, `not_found` or one of the local codes an
    /// upload can end with.
    Stopped {
        source: Source,
        code: String,
        status: Option<u16>,
        said: String,
    },
}

impl From<Stop> for AnalysisAnswer {
    fn from(stop: Stop) -> Self {
        Self::Stopped {
            source: stop.source,
            code: stop.code,
            status: stop.status,
            said: stop.said,
        }
    }
}

/// Send one analysis and say what the hub made of it. Never errors.
///
/// `events` is the run's log, only the logger's lines. A request that never
/// arrives or comes back with a 5xx is sent again, as an upload's are.
pub(crate) async fn send(
    hub_url: &str,
    token: &TokenSource,
    backoff: Duration,
    game_id: &str,
    logger_version: u32,
    events: &str,
) -> AnalysisAnswer {
    let path = format!("/api/v1/replays/{game_id}/analyses");
    let url = match api_url(hub_url, &path, "Sending an analysis to the hub") {
        Ok(url) => url,
        Err(said) => return Stop::local("unreachable", said).into(),
    };
    let body =
        serde_json::json!({ "logger_version": logger_version, "events": events }).to_string();
    let client = match reqwest::Client::builder()
        .connect_timeout(coilbox_oauth::HTTP_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(e) => return Stop::local("unreachable", e.to_string()).into(),
    };
    let mut waiting = backoff;
    let mut attempt = 1;
    let raw = loop {
        let token = match token().await {
            Ok(token) => token,
            Err(stop) => return stop.into(),
        };
        let sent = send_once(&url, || {
            client
                .post(&url)
                .timeout(REQUEST_TIMEOUT)
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body.clone())
        })
        .await;
        let again = match &sent {
            Err(_) => true,
            Ok(raw) => raw.status >= 500,
        };
        if !again || attempt >= UPLOAD_ATTEMPTS {
            break sent;
        }
        tokio::time::sleep(waiting).await;
        waiting *= 2;
        attempt += 1;
    };
    let raw = match raw {
        Ok(raw) => raw,
        Err(said) => return Stop::new(Source::Hub, "unreachable", said).into(),
    };
    if raw.status == 200 || raw.status == 202 {
        let analysis = raw.body.get("analysis");
        let state = analysis
            .and_then(|a| a.get("state"))
            .and_then(|s| s.as_str());
        let Some(state) = state else {
            return Stop::new(
                Source::Hub,
                "bad_answer",
                format!(
                    "The hub at {} did not answer with an analysis.",
                    host_of(&url)
                ),
            )
            .into();
        };
        return AnalysisAnswer::Sent {
            id: analysis.and_then(|a| a.get("id")).and_then(|i| i.as_u64()),
            state: state.to_owned(),
            reason: analysis
                .and_then(|a| a.get("reason"))
                .and_then(|r| r.as_str())
                .map(str::to_owned),
            again: raw.status == 200,
        };
    }
    let mut stop = hub_stop(raw.status, &raw.body, &url);
    // `not_listed` says more than a bare 404: send the replay first.
    if let Some(reason) = raw.body.get("reason").and_then(|r| r.as_str()) {
        if raw.status == 404 {
            reason.clone_into(&mut stop.code);
        }
    }
    stop.into()
}

/// Send an analysis as whoever is signed in to this hub. `consent` must admit
/// an analysis of this match.
pub async fn send_signed_in(
    hub_url: String,
    game_id: &str,
    logger_version: u32,
    events: &str,
    consent: &AssetUploadConsent,
) -> Result<AnalysisAnswer, String> {
    consent.admits_analysis(game_id)?;
    let token = signed_in_token(hub_url.clone());
    Ok(send(
        &hub_url,
        &token,
        RETRY_BACKOFF,
        game_id,
        logger_version,
        events,
    )
    .await)
}
