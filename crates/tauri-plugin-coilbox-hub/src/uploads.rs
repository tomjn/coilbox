//! Sending a map or game archive to a hub mirror (issue #5258).
//!
//! The hub reserves a slot on a mirror and signs a token for it. This module
//! then sends the file to the mirror in chunks, and waits for the hub to list
//! the archive. The hub half is `app/Domain/Mirrors/Uploads.php` in
//! coilbox-hub and the mirror half is `PROTOCOL.md` sections 2 to 4 in
//! coilbox-mirror. Where this file and either disagree, they are right.
//!
//! # The steps
//!
//! 1. `POST /api/v1/uploads` with the archive's facts. The hub answers with a
//!    mirror's `upload_url`, its `limits_url` and a token.
//! 2. `GET limits_url` for the largest chunk the mirror takes.
//! 3. `GET upload_url` for how many bytes the mirror already holds, so a
//!    transfer that was cut off carries on instead of starting again.
//! 4. `POST upload_url` once for each chunk, at the offset the mirror holds.
//! 5. `GET /api/v1/uploads/{id}` until the hub says `listed`.
//!
//! # Who owns the transfer
//!
//! The Rust side does, not the page. [`begin`] returns at once and the transfer
//! runs as a task on the app's own runtime, so leaving the page that started
//! it changes nothing. The page finds the upload again by asking [`list`], and
//! hears about changes through the [`EVENT`] event, which carries the same
//! [`UploadState`] [`list`] answers with. A `tauri::ipc::Channel` was not used
//! because it belongs to the page that opened it.
//!
//! # What it answers
//!
//! Every way an upload can end is an [`Outcome`] inside the final
//! [`UploadState`], never an error. A page switches on `code` for the wording,
//! and `said` is an English sentence for a log or a page with no wording yet.
//! `source` says who objected: the hub, the mirror, or this machine.
//!
//! # Recovering
//!
//! - A request that never arrives or comes back with a 5xx is sent again, up to
//!   [`UPLOAD_ATTEMPTS`] times in a row, with a growing wait.
//! - `bad_offset` is how a lost response is recovered. The mirror says how many
//!   bytes it really holds and the next chunk starts there.
//! - `expired` means the token's first-chunk window passed. The hub is asked for
//!   a fresh token for the same upload.
//! - `hash_mismatch`, `exists`, `removed` and the rest are final. Sending the
//!   same bytes again gets the same answer.
//!
//! The hub marks an upload failed if nothing asks about it for 24 hours after
//! the mirror's report fails, so the status is polled during the transfer as
//! well as after it.

use std::collections::HashMap;
use std::io::{Read as _, Seek as _, SeekFrom};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use coilbox_oauth::HTTP_TIMEOUT;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter as _, Runtime};

use crate::auth;
use crate::consent::AssetUploadConsent;
use crate::endpoint::{api_url, host_of, read_capped, unreachable_message};
use crate::upload::{RETRY_BACKOFF, UPLOAD_ATTEMPTS};

#[cfg(test)]
mod fakes;
#[cfg(test)]
mod tests;

/// The event every change to an upload is announced on, carrying an
/// [`UploadState`].
pub const EVENT: &str = "coilbox-hub://archive-upload";

const UPLOADS_PATH: &str = "/api/v1/uploads";

/// Largest hub or mirror answer that will be read. All of them are a few short
/// fields.
const ANSWER_LIMIT: usize = 64 * 1024;

/// How long one hub request, or one mirror request that carries no file, may
/// take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// The timings and sizes a run uses. Separate from the logic so a test can run
/// the whole protocol in milliseconds with a chunk of a few bytes.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Pacing {
    /// The wait before the second try of a request, doubled before the third.
    pub retry_backoff: Duration,
    /// How often the hub is asked about the upload while chunks are going out.
    pub poll_during: Duration,
    /// How often it is asked once the last chunk is in, until it is listed.
    pub poll_after: Duration,
    /// The largest chunk this side sends, when the mirror would take more.
    ///
    /// A chosen value, not a measured one. A chunk is read into memory whole,
    /// and a smaller one means the progress moves and a cut connection costs
    /// less to resume. The mirror's own limit still wins when it is lower.
    pub chunk_target: u64,
    /// How long one chunk may take to send. The slowest connection this lets
    /// through is `chunk_target` divided by this.
    pub chunk_timeout: Duration,
}

impl Pacing {
    /// "Every few minutes" and "every few seconds" are the issue's words. The
    /// numbers are a choice.
    pub(crate) const REAL: Self = Self {
        retry_backoff: RETRY_BACKOFF,
        poll_during: Duration::from_secs(180),
        poll_after: Duration::from_secs(5),
        chunk_target: 8 * 1024 * 1024,
        chunk_timeout: Duration::from_secs(300),
    };
}

/// Whether an archive is a map, a game or an engine build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveKind {
    Map,
    Game,
    /// A `recoil_<version>_<platform>.7z` build only grant holders and
    /// moderators may send. Its facts come from `dl_engine_upload_facts`.
    Engine,
}

/// One archive's facts, as the hub's `POST /api/v1/uploads` takes them.
///
/// The shape `unitsync_upload_facts` answers with in `facts`, field for field,
/// or for an engine `dl_engine_upload_facts` with the note added. The hub reads
/// `null` as absent, so the optional fields are sent as `null`. `platform` and
/// `note` are an engine's alone and are left out for a map or game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveFacts {
    pub sha256: String,
    pub size: u64,
    pub filename: String,
    pub kind: ArchiveKind,
    pub internal_name: String,
    pub version: String,
    pub shortname: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// What the uploader says about an engine build, 1 to 1,000 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Where an upload has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// Asking the hub for a slot and the mirror for its limits.
    Reserving,
    /// Chunks are going to the mirror.
    Sending,
    /// The mirror has every byte. Waiting for the hub to list the archive.
    Waiting,
    /// Over. [`UploadState::outcome`] says how.
    Done,
}

/// Who refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Hub,
    Mirror,
    /// This machine: the file, the hub address, or the sign-in.
    Local,
}

/// What the hub says it already has, on a `409 duplicate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Duplicate {
    /// What matched: the hash or the file name.
    pub check: Option<String>,
    pub filename: Option<String>,
    pub kind: Option<String>,
    pub state: Option<String>,
    /// The page of the archive on the hub, when it is listed and has one.
    pub url: Option<String>,
}

/// How an upload ended.
///
/// The codes a page can meet, by source:
///
/// - hub: `bad_request`, `unauthorised`, `not_owner`, `duplicate`,
///   `unknown_game`, `unknown_map`, `no_mirror`, `not_engine_uploader`,
///   `no_engine_mirror`, `not_configured`, `unavailable`, `failed`
///   (the hub gave up on the upload), `removed`, `not_found`
/// - mirror: `exists` (a file with that name is already there, which is not the
///   same as the hub's `duplicate`), `hash_mismatch`, `removed`, `expired`,
///   `bad_token`, `wrong_mirror`, `too_large`, `bad_request`, `write_failed`,
///   `internal_error`, `not_configured`, `uploads_disabled`, `bad_offset`,
///   `unreachable`
/// - local: `unauthorised`, `unreachable`, `file_changed`, `unreadable`,
///   `bad_answer`
///
/// Any other string is a code a newer hub or mirror sent, and `said` has its
/// words.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Outcome {
    /// The hub lists the archive.
    Listed,
    /// Stopped by the person. The mirror keeps what it received, so sending the
    /// same archive again carries on from there.
    Cancelled,
    /// Ended without being listed.
    Stopped {
        source: Source,
        code: String,
        status: Option<u16>,
        said: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        duplicate: Option<Duplicate>,
    },
}

/// One upload, as a page sees it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadState {
    /// What [`cancel`] takes.
    pub op_id: String,
    pub hub_url: String,
    pub filename: String,
    pub kind: ArchiveKind,
    /// The archive's hash, which is how a page finds the upload for the archive
    /// it is showing.
    pub sha256: String,
    pub phase: Phase,
    /// Bytes the mirror is known to hold.
    pub sent: u64,
    pub size: u64,
    /// The hub's id for the upload, once it has given one.
    pub upload_id: Option<String>,
    /// Set when `phase` is `done`.
    pub outcome: Option<Outcome>,
}

/// A way a run ends other than listing the archive.
#[derive(Debug)]
pub(crate) struct Stop {
    source: Source,
    code: String,
    status: Option<u16>,
    said: String,
    /// Boxed so the error side of every `Result` here stays small.
    duplicate: Option<Box<Duplicate>>,
}

impl Stop {
    fn new(source: Source, code: &str, said: impl Into<String>) -> Self {
        Self {
            source,
            code: code.to_owned(),
            status: None,
            said: said.into(),
            duplicate: None,
        }
    }

    fn local(code: &str, said: impl Into<String>) -> Self {
        Self::new(Source::Local, code, said)
    }
}

enum End {
    Cancelled,
    Stop(Stop),
}

impl From<Stop> for End {
    fn from(stop: Stop) -> Self {
        Self::Stop(stop)
    }
}

type TokenFuture = Pin<Box<dyn std::future::Future<Output = Result<String, Stop>> + Send>>;

/// Where the hub's bearer token comes from. Asked for again on every hub call,
/// because an upload can outlast one access token.
pub(crate) type TokenSource = dyn Fn() -> TokenFuture + Send + Sync;

/// Everything a run is given.
pub(crate) struct Env<'a> {
    pub hub_url: &'a str,
    pub token: &'a TokenSource,
    pub pacing: Pacing,
    pub cancel: &'a Arc<AtomicBool>,
    pub report: &'a (dyn Fn(&UploadState) + Send + Sync),
}

/// A slot the hub reserved on a mirror.
struct Reservation {
    id: String,
    upload_url: String,
    limits_url: String,
    token: String,
}

struct Raw {
    status: u16,
    body: Value,
}

/// Send one archive and wait for the hub to list it.
///
/// Reports after every change and returns the last state, whose `outcome` is
/// always set. Never errors: every way out is an [`Outcome`].
pub(crate) async fn run(
    env: &Env<'_>,
    mut state: UploadState,
    path: &Path,
    facts: &ArchiveFacts,
) -> UploadState {
    let ended = tokio::select! {
        biased;
        () = watch(env.cancel) => Err(End::Cancelled),
        ended = drive(env, &mut state, path, facts) => ended,
    };
    state.outcome = Some(match ended {
        Ok(()) => Outcome::Listed,
        Err(End::Cancelled) => Outcome::Cancelled,
        Err(End::Stop(stop)) => Outcome::Stopped {
            source: stop.source,
            code: stop.code,
            status: stop.status,
            said: stop.said,
            duplicate: stop.duplicate.map(|d| *d),
        },
    });
    state.phase = Phase::Done;
    (env.report)(&state);
    state
}

/// The steps, in order. `Ok` is a listed archive.
async fn drive(
    env: &Env<'_>,
    state: &mut UploadState,
    path: &Path,
    facts: &ArchiveFacts,
) -> Result<(), End> {
    let client = reqwest::Client::builder()
        .connect_timeout(HTTP_TIMEOUT)
        .build()
        .map_err(|e| Stop::local("unreachable", e.to_string()))?;
    let size = facts.size;
    if size == 0 {
        return Err(Stop::local("unreadable", "The archive file is empty.").into());
    }

    match std::fs::metadata(path) {
        Ok(md) if md.len() == size => {}
        Ok(md) => {
            return Err(Stop::local(
                "file_changed",
                format!(
                    "The archive is {} bytes now and was {size} bytes when its details were read.",
                    md.len()
                ),
            )
            .into())
        }
        Err(_) => {
            return Err(Stop::local(
                "unreadable",
                format!("There is no archive at {}.", path.display()),
            )
            .into())
        }
    }

    let mut reservation = reserve(env, &client, facts).await?;
    state.upload_id = Some(reservation.id.clone());
    state.phase = Phase::Sending;
    (env.report)(state);

    let limit = mirror_limit(env, &client, &reservation).await?;
    let chunk_size = limit.min(env.pacing.chunk_target);

    let held = mirror_held(env, &client, &reservation).await?;
    let mut received = held.received;
    if received > size {
        return Err(bad_mirror_answer(&reservation.upload_url).into());
    }
    state.sent = received;
    (env.report)(state);

    let mut finished = held.complete;
    let mut last_poll = Instant::now();
    let mut failures = 0u32;
    let mut resyncs = 0u32;
    let mut reissues = 0u32;
    let mut waiting = env.pacing.retry_backoff;

    while !finished {
        if env.cancel.load(Ordering::Relaxed) {
            return Err(End::Cancelled);
        }
        if last_poll.elapsed() >= env.pacing.poll_during {
            last_poll = Instant::now();
            match hub_status(env, &client, &reservation.id).await {
                HubStatus::Listed => return Ok(()),
                HubStatus::Ended(stop) => return Err(stop.into()),
                // The poll is there to keep the hub from giving up on the
                // upload. A failed one is not a reason to stop sending.
                HubStatus::Pending | HubStatus::Unknown => {}
            }
        }

        // A mirror holding every byte without having finished was cut short
        // while hashing. Any non-empty chunk makes it finish, so the last byte
        // goes again.
        let (from, len) = if received >= size {
            (size - 1, 1)
        } else {
            (received, chunk_size.min(size - received))
        };
        let bytes = read_chunk(path, from, len).await?;

        match post_chunk(env, &client, &reservation, received, bytes).await {
            Posted::Held(now) => {
                if now < received || now > size {
                    return Err(bad_mirror_answer(&reservation.upload_url).into());
                }
                received = now;
                state.sent = received;
                (env.report)(state);
                failures = 0;
                resyncs = 0;
                waiting = env.pacing.retry_backoff;
            }
            Posted::Finished => finished = true,
            Posted::Resync(now) => {
                if now > size {
                    return Err(bad_mirror_answer(&reservation.upload_url).into());
                }
                // Three in a row with no chunk accepted between them means
                // something else is writing to this upload.
                resyncs += 1;
                if resyncs >= UPLOAD_ATTEMPTS {
                    return Err(Stop::new(
                        Source::Mirror,
                        "bad_offset",
                        "The mirror keeps changing how many bytes it holds.",
                    )
                    .into());
                }
                failures = 0;
                received = now;
                state.sent = received;
                (env.report)(state);
            }
            Posted::Expired => {
                reissues += 1;
                if reissues >= UPLOAD_ATTEMPTS {
                    return Err(Stop::new(
                        Source::Mirror,
                        "expired",
                        "The mirror keeps saying the upload token has expired.",
                    )
                    .into());
                }
                // The hub knows this upload and answers the same request with
                // a fresh token for it.
                reservation = reserve(env, &client, facts).await?;
            }
            Posted::Retry(stop) => {
                failures += 1;
                if failures >= UPLOAD_ATTEMPTS {
                    return Err(stop.into());
                }
                tokio::time::sleep(waiting).await;
                waiting *= 2;
            }
            Posted::Final(stop) => return Err(stop.into()),
        }
    }

    state.sent = size;
    state.phase = Phase::Waiting;
    (env.report)(state);

    loop {
        match hub_status(env, &client, &reservation.id).await {
            HubStatus::Listed => return Ok(()),
            HubStatus::Ended(stop) => return Err(stop.into()),
            HubStatus::Pending | HubStatus::Unknown => {}
        }
        tokio::time::sleep(env.pacing.poll_after).await;
    }
}

// ------------------------------------------------------------------- the hub

/// Ask the hub for a slot, or for a fresh token for the one it already gave.
/// The hub answers `201` the first time and `200` after that, with the same
/// body shape.
async fn reserve(
    env: &Env<'_>,
    client: &reqwest::Client,
    facts: &ArchiveFacts,
) -> Result<Reservation, Stop> {
    let url = api_url(env.hub_url, UPLOADS_PATH, "Sending an archive to the hub")
        .map_err(|said| Stop::local("unreachable", said))?;
    let body =
        serde_json::to_string(facts).map_err(|e| Stop::local("bad_answer", e.to_string()))?;
    let token = (env.token)().await?;
    let raw = send_with_retries(env, Source::Hub, &url, || {
        client
            .post(&url)
            .timeout(REQUEST_TIMEOUT)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.clone())
    })
    .await?;

    if raw.status == 200 || raw.status == 201 {
        return parse_reservation(&raw.body).ok_or_else(|| bad_hub_answer(&url));
    }
    Err(hub_stop(raw.status, &raw.body, &url))
}

fn parse_reservation(body: &Value) -> Option<Reservation> {
    let upload = body.get("upload")?;
    let text = |key: &str| upload.get(key)?.as_str().map(str::to_owned);
    Some(Reservation {
        id: text("id")?,
        upload_url: text("upload_url")?,
        limits_url: text("limits_url")?,
        token: text("token")?,
    })
}

enum HubStatus {
    Listed,
    /// Not listed yet and not going to fail yet.
    Pending,
    /// The hub could not be asked, or answered something unreadable.
    Unknown,
    /// The hub will never list it, or will not say.
    Ended(Stop),
}

async fn hub_status(env: &Env<'_>, client: &reqwest::Client, id: &str) -> HubStatus {
    let path = format!("{UPLOADS_PATH}/{id}");
    let Ok(url) = api_url(env.hub_url, &path, "Sending an archive to the hub") else {
        return HubStatus::Unknown;
    };
    let token = match (env.token)().await {
        Ok(token) => token,
        Err(stop) if stop.code == "unauthorised" => return HubStatus::Ended(stop),
        Err(_) => return HubStatus::Unknown,
    };
    let sent = send_once(&url, || {
        client
            .get(&url)
            .timeout(REQUEST_TIMEOUT)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(reqwest::header::ACCEPT, "application/json")
    })
    .await;
    let Ok(raw) = sent else {
        return HubStatus::Unknown;
    };
    match raw.status {
        200 => match raw.body.pointer("/upload/state").and_then(Value::as_str) {
            Some("listed") => HubStatus::Listed,
            Some("uploading") => HubStatus::Pending,
            Some(state @ ("failed" | "removed")) => HubStatus::Ended(Stop {
                source: Source::Hub,
                code: state.to_owned(),
                status: Some(200),
                said: if state == "failed" {
                    "The hub gave up on this upload.".to_owned()
                } else {
                    "The hub has removed this archive.".to_owned()
                },
                duplicate: None,
            }),
            _ => HubStatus::Unknown,
        },
        401 | 404 => HubStatus::Ended(hub_stop(raw.status, &raw.body, &url)),
        _ => HubStatus::Unknown,
    }
}

/// What the hub's refusal is, in codes a page can word.
fn hub_stop(status: u16, body: &Value, url: &str) -> Stop {
    let reason = body.get("reason").and_then(Value::as_str);
    let said_by_hub = body.get("error").and_then(Value::as_str);
    let code = match (status, reason) {
        (401, _) => "unauthorised".to_owned(),
        (404, _) => "not_found".to_owned(),
        (_, Some(reason)) => reason.to_owned(),
        (400, None) => "bad_request".to_owned(),
        _ => format!("http_{status}"),
    };
    let said = match (status, said_by_hub) {
        (401, _) => format!(
            "The hub at {} did not accept the sign-in. Sign in again and try once more.",
            host_of(url)
        ),
        (_, Some(said)) => said.to_owned(),
        (_, None) => format!(
            "The hub at {} refused the upload, with a {status}.",
            host_of(url)
        ),
    };
    let duplicate = (code == "duplicate")
        .then(|| {
            body.get("duplicate")
                .and_then(|d| serde_json::from_value::<Duplicate>(d.clone()).ok())
                .map(Box::new)
        })
        .flatten();
    Stop {
        source: Source::Hub,
        code,
        status: Some(status),
        said,
        duplicate,
    }
}

fn bad_hub_answer(url: &str) -> Stop {
    Stop::new(
        Source::Hub,
        "bad_answer",
        format!("The hub at {} did not answer with an upload.", host_of(url)),
    )
}

// ---------------------------------------------------------------- the mirror

/// The largest chunk the mirror takes.
async fn mirror_limit(
    env: &Env<'_>,
    client: &reqwest::Client,
    reservation: &Reservation,
) -> Result<u64, Stop> {
    let url = &reservation.limits_url;
    let raw = send_with_retries(env, Source::Mirror, url, || {
        client.get(url).timeout(REQUEST_TIMEOUT)
    })
    .await?;
    if raw.status != 200 {
        return Err(mirror_stop(raw.status, &raw.body, url));
    }
    match raw.body.get("max_chunk_bytes").and_then(Value::as_u64) {
        Some(max) if max >= 1 => Ok(max),
        _ => Err(bad_mirror_answer(url)),
    }
}

struct Held {
    received: u64,
    complete: bool,
}

/// How many bytes the mirror holds for this upload.
async fn mirror_held(
    env: &Env<'_>,
    client: &reqwest::Client,
    reservation: &Reservation,
) -> Result<Held, Stop> {
    let url = &reservation.upload_url;
    let raw = send_with_retries(env, Source::Mirror, url, || {
        client
            .get(url)
            .timeout(REQUEST_TIMEOUT)
            .header("X-Mirror-Token", &reservation.token)
    })
    .await?;
    if raw.status != 200 {
        return Err(mirror_stop(raw.status, &raw.body, url));
    }
    let received = raw.body.get("received").and_then(Value::as_u64);
    let complete = raw.body.get("complete").and_then(Value::as_bool);
    match (received, complete) {
        (Some(received), Some(complete)) => Ok(Held { received, complete }),
        _ => Err(bad_mirror_answer(url)),
    }
}

enum Posted {
    /// Accepted, and the mirror now holds this many bytes.
    Held(u64),
    /// The mirror has the whole file and has put it in place.
    Finished,
    /// The mirror holds this many bytes, not the number the chunk was for.
    Resync(u64),
    Expired,
    /// Worth sending again. Carries what to end with if it never goes through.
    Retry(Stop),
    Final(Stop),
}

/// Send one chunk and say what the mirror made of it.
///
/// The request is the envelope `limits.php`'s figure assumes: one part named
/// `chunk`, with the file name `chunk` and `application/octet-stream`, and no
/// other header on the part.
async fn post_chunk(
    env: &Env<'_>,
    client: &reqwest::Client,
    reservation: &Reservation,
    offset: u64,
    bytes: Vec<u8>,
) -> Posted {
    let url = &reservation.upload_url;
    let len = bytes.len() as u64;
    let sent = send_once(url, || {
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name("chunk")
            .mime_str("application/octet-stream")
            .expect("a literal media type");
        client
            .post(url)
            .timeout(env.pacing.chunk_timeout)
            .header("X-Mirror-Token", &reservation.token)
            .header("X-Mirror-Offset", offset.to_string())
            .multipart(reqwest::multipart::Form::new().part("chunk", part))
    })
    .await;
    let raw = match sent {
        Ok(raw) => raw,
        Err(said) => return Posted::Retry(Stop::new(Source::Mirror, "unreachable", said)),
    };

    let error = raw.body.get("error").and_then(Value::as_str);
    match (raw.status, error) {
        (200, _) => Posted::Held(
            raw.body
                .get("received")
                .and_then(Value::as_u64)
                .unwrap_or(offset + len),
        ),
        (201, _) => Posted::Finished,
        // An upload id that has finished is one that got there, whether it was
        // this run or an earlier one whose answer was lost.
        (409, Some("used")) => Posted::Finished,
        (409, Some("bad_offset")) => match raw.body.get("received").and_then(Value::as_u64) {
            Some(held) => Posted::Resync(held),
            None => Posted::Final(bad_mirror_answer(url)),
        },
        (410, Some("expired")) => Posted::Expired,
        // The mirror failing on its own side, or a request it could not read.
        // The same chunk may well go through next time.
        (400 | 500..=599, _) => Posted::Retry(mirror_stop(raw.status, &raw.body, url)),
        _ => Posted::Final(mirror_stop(raw.status, &raw.body, url)),
    }
}

/// What the mirror's refusal is, in codes a page can word.
fn mirror_stop(status: u16, body: &Value, url: &str) -> Stop {
    let code = body
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("http_{status}"));
    let host = host_of(url);
    let said = match code.as_str() {
        "exists" => format!("The mirror at {host} already has a file with this name."),
        "hash_mismatch" => format!(
            "The mirror at {host} received the file, but its hash was not the one declared. The file may have changed while it was sent."
        ),
        "removed" => format!("The mirror at {host} will not take this archive. It is on the removal list."),
        "bad_token" | "wrong_mirror" => {
            format!("The mirror at {host} did not accept the hub's upload token.")
        }
        "too_large" => format!("The mirror at {host} says the file is larger than declared."),
        "uploads_disabled" => format!("The mirror at {host} has uploads turned off."),
        _ => format!("The mirror at {host} refused the upload: {code}."),
    };
    Stop {
        source: Source::Mirror,
        code,
        status: Some(status),
        said,
        duplicate: None,
    }
}

fn bad_mirror_answer(url: &str) -> Stop {
    Stop::new(
        Source::Mirror,
        "bad_answer",
        format!(
            "The mirror at {} answered with something this version of coilbox does not understand.",
            host_of(url)
        ),
    )
}

// ------------------------------------------------------------------ plumbing

/// Make a request once. `Err` is a sentence for a request that never came back.
async fn send_once(
    url: &str,
    build: impl FnOnce() -> reqwest::RequestBuilder,
) -> Result<Raw, String> {
    let response = build()
        .send()
        .await
        .map_err(|e| unreachable_message(url, e.is_timeout()))?;
    let status = response.status().as_u16();
    let bytes = read_capped(response, ANSWER_LIMIT)
        .await
        .map_err(|_| unreachable_message(url, false))?;
    Ok(Raw {
        status,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    })
}

/// [`send_once`], tried again while the request never comes back, up to
/// [`UPLOAD_ATTEMPTS`] times.
async fn send_with_retries(
    env: &Env<'_>,
    source: Source,
    url: &str,
    build: impl Fn() -> reqwest::RequestBuilder,
) -> Result<Raw, Stop> {
    let mut waiting = env.pacing.retry_backoff;
    let mut attempt = 1;
    loop {
        match send_once(url, &build).await {
            Ok(raw) => return Ok(raw),
            Err(said) if attempt >= UPLOAD_ATTEMPTS => {
                return Err(Stop::new(source, "unreachable", said))
            }
            Err(_) => {}
        }
        tokio::time::sleep(waiting).await;
        waiting *= 2;
        attempt += 1;
    }
}

/// Read `len` bytes of the archive from `from`. On a blocking thread, because a
/// chunk can be the better part of a gigabyte.
async fn read_chunk(path: &Path, from: u64, len: u64) -> Result<Vec<u8>, Stop> {
    let owned: PathBuf = path.to_owned();
    let read = tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(&owned)?;
        file.seek(SeekFrom::Start(from))?;
        let mut buf = vec![0u8; len as usize];
        file.read_exact(&mut buf)?;
        Ok::<_, std::io::Error>(buf)
    })
    .await;
    match read {
        Ok(Ok(bytes)) => Ok(bytes),
        _ => Err(Stop::local(
            "unreadable",
            format!("The archive at {} could not be read.", path.display()),
        )),
    }
}

fn cancelled(cancel: &Arc<AtomicBool>) -> bool {
    cancel.load(Ordering::Relaxed)
}

/// Resolves once the flag is up. Polled, because the flag is what [`cancel`]
/// reaches from another command with no channel between them.
async fn watch(cancel: &Arc<AtomicBool>) {
    while !cancelled(cancel) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

// ----------------------------------------------------------- running uploads

struct Entry {
    state: UploadState,
    cancel: Arc<AtomicBool>,
}

/// Every upload this run of the app has started, by op id. Finished ones stay
/// so a page opened afterwards can still read how it ended. A new send of the
/// same archive replaces the old entry.
fn registry() -> &'static Mutex<HashMap<String, Entry>> {
    static REG: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start sending an archive, unless the same archive is already on its way.
///
/// Answers as soon as the transfer is running. `consent` is the proof that the
/// user pressed "Send to hub" for this map or game, or has the uploads switch
/// on. It is checked here and not again, the way the other send paths do it:
/// the proof is that the user had agreed when the operation began.
pub fn begin<R: Runtime>(
    app: AppHandle<R>,
    hub_url: String,
    path: PathBuf,
    facts: ArchiveFacts,
    consent: &AssetUploadConsent,
) -> Result<UploadState, String> {
    api_url(&hub_url, UPLOADS_PATH, "Sending an archive to the hub")?;
    match (facts.kind, facts.shortname.as_deref()) {
        (ArchiveKind::Map, _) => consent.admits_maps([facts.internal_name.as_str()])?,
        (ArchiveKind::Game, shortname) => consent.admits_game(shortname.unwrap_or_default())?,
        (ArchiveKind::Engine, _) => consent.admits_engine(&facts.filename)?,
    }
    let on_disk = std::fs::metadata(&path)
        .map_err(|_| format!("There is no archive at {}.", path.display()))?
        .len();
    if on_disk != facts.size {
        return Err(format!(
            "The archive is {on_disk} bytes and its details say {}. Read them again.",
            facts.size
        ));
    }

    let op_id = coilbox_oauth::random_token(16).map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    let state = UploadState {
        op_id: op_id.clone(),
        hub_url: hub_url.clone(),
        filename: facts.filename.clone(),
        kind: facts.kind,
        sha256: facts.sha256.clone(),
        phase: Phase::Reserving,
        sent: 0,
        size: facts.size,
        upload_id: None,
        outcome: None,
    };
    if let Some(running) = claim(&state, &cancel) {
        return Ok(running);
    }

    let announce = app.clone();
    let report_id = op_id.clone();
    let started = state.clone();
    tauri::async_runtime::spawn(async move {
        let token_hub = hub_url.clone();
        let token = move || -> TokenFuture {
            let hub = token_hub.clone();
            Box::pin(async move {
                auth::access_token(&hub).await.map_err(|e| {
                    let code = if e.needs_sign_in() {
                        "unauthorised"
                    } else {
                        "unreachable"
                    };
                    Stop::local(code, auth::explain(&e, &hub))
                })
            })
        };
        let report = move |state: &UploadState| {
            update(&report_id, state);
            let _ = announce.emit(EVENT, state);
        };
        let env = Env {
            hub_url: &hub_url,
            token: &token,
            pacing: Pacing::REAL,
            cancel: &cancel,
            report: &report,
        };
        run(&env, started, &path, &facts).await;
    });
    Ok(state)
}

/// Record a new upload, unless the same archive to the same hub is already
/// running. Answers the running one in that case, so a page that lost track of
/// it and pressed the button again finds it.
fn claim(state: &UploadState, cancel: &Arc<AtomicBool>) -> Option<UploadState> {
    let mut registry = registry().lock().unwrap();
    if let Some(running) = registry.values().find(|entry| {
        entry.state.sha256 == state.sha256
            && entry.state.hub_url == state.hub_url
            && entry.state.phase != Phase::Done
    }) {
        return Some(running.state.clone());
    }
    registry.retain(|_, entry| entry.state.sha256 != state.sha256);
    registry.insert(
        state.op_id.clone(),
        Entry {
            state: state.clone(),
            cancel: cancel.clone(),
        },
    );
    None
}

fn update(op_id: &str, state: &UploadState) {
    if let Some(entry) = registry().lock().unwrap().get_mut(op_id) {
        entry.state = state.clone();
    }
}

/// Every upload this run of the app has started.
pub fn list() -> Vec<UploadState> {
    registry()
        .lock()
        .unwrap()
        .values()
        .map(|entry| entry.state.clone())
        .collect()
}

/// Stop an upload by its op id. A no-op for an unknown or finished one.
pub fn cancel(op_id: &str) {
    if let Some(entry) = registry().lock().unwrap().get(op_id) {
        entry.cancel.store(true, Ordering::Relaxed);
    }
}
