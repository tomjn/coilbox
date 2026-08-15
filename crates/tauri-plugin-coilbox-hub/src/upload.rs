//! Sending a picture to the hub (issue #1633).
//!
//! `POST <hub>/api/v1/assets/upload` with a bearer token: a `multipart/form-data`
//! body carrying a JSON `asset` part and a binary `file` part. The hub writes the
//! bytes to Blob itself. Coilbox never talks to Blob, because the only Rust client
//! for it is unmaintained and reverse engineering the HTTP contract would work
//! right up until an unpublished interface changed under a desktop build already
//! on people's machines. coilbox-hub#133 closed the client direct path on purpose.
//!
//! Shaped after [`crate::publish`]: an https check, a client with timeouts, a hard
//! cap on what will be read back, and failures worded for the person reading them.
//!
//! # The have check comes first
//!
//! [`upload_all`] asks `/api/v1/assets/have` before it sends anything, and that is
//! the whole economy of the design rather than an optimisation. Most of a real
//! batch is already on the hub, the expensive part is the render and the encode
//! rather than the transfer, and every write spends an allowance the community
//! shares. An asset the hub already holds is never sent.
//!
//! # The bytes come off disk
//!
//! An asset arrives as a path, not as bytes. The unitsync worker is where the
//! archive is, and it is a one shot process that prints one JSON document on
//! stdout, so a few hundred WebPs is the wrong shape to hand back that way. It
//! writes each encoded file into a cache directory named after the sha256 of its
//! own bytes and reports the path (issue #1624), and this reads it.
//!
//! # What a refusal is worth doing about
//!
//! [`Verdict`] is issue #1634: three answers to "is another request going to say
//! anything different", and every refusal carries one. The run acts on it rather
//! than on the status, and the frontend words a notification from it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use coilbox_assets::{class_for_variant, KeyedOn};
use coilbox_oauth::HTTP_TIMEOUT;
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::consent::AssetUploadConsent;
use crate::endpoint::{api_url, host_of, read_capped};
use crate::have::{self, AssetIdentity, AssetKey, HaveStatus};

/// The route that takes an upload.
const UPLOAD_PATH: &str = "/api/v1/assets/upload";

/// The route the have check is on, so one hub address reaches both.
const HAVE_PATH: &str = "/api/v1/assets/have";

/// The envelope the answer carries, so a build that has been on disk for months
/// can say the service is newer than it understands rather than reading a shape
/// that changed under it. Both are `ASSET_UPLOAD_FORMAT` and
/// `ASSET_UPLOAD_VERSION` in the hub's `lib/api/assetUpload.ts`.
const UPLOAD_FORMAT: &str = "coilbox-hub-asset-upload";
const UPLOAD_VERSION: u32 = 1;

/// Longest one upload may take end to end, matching the publish and have timeouts
/// for the same reason: a hub asleep on a free tier is woken by the first request,
/// which is slow rather than broken.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// Bound the initial connect on its own, so a dead host fails before any of the
/// above is spent waiting.
const CONNECT_TIMEOUT: Duration = HTTP_TIMEOUT;

/// Largest answer that will be read. The hub replies with three short fields and
/// never with the picture it was sent, so anything approaching this is not an
/// answer from a hub.
const ANSWER_LIMIT: usize = 64 * 1024;

/// How many times one picture may be sent before the run gives up on it.
///
/// Only a [`Verdict::Transient`] answer is ever sent twice, and a run that
/// exhausts these ends, so a hub answering 503 to everything costs three requests
/// rather than three hundred. That second bound is the point: an unbounded retry
/// on a persistent 5xx is a worse bug than the one this file is fixing.
const UPLOAD_ATTEMPTS: u32 = 3;

/// How long to wait before the second attempt, doubled before the third.
///
/// Short, because the failure being waited out is an answer rather than a
/// silence: a cold start is already covered by [`UPLOAD_TIMEOUT`], and a 502 or a
/// quota read that failed comes back straight away. So the whole of a picture's
/// retry budget is a second and a half.
const RETRY_BACKOFF: Duration = Duration::from_millis(500);

/// How many pictures in a row may be refused with the same status before the run
/// stops asking.
///
/// A terminal refusal is about one picture, so the run carries on past it. But a
/// backfill is one game's roster made by one encoder, so when the encoder is wrong
/// the hub says the same thing about all three hundred of them, and so does an
/// account over its storage quota or a game the hub has no licence for. None of
/// those is a picture worth learning about individually.
///
/// Five, because one or two odd pictures in a batch is ordinary and five in a row
/// saying the same thing is a rule.
const SAME_REFUSAL_LIMIT: usize = 5;

/// The largest request body the platform the hub runs on will carry.
///
/// Not a number the hub chose and not one it can raise: the platform refuses the
/// body before any hub code runs, so an upload over it comes back as a platform
/// error rather than as anything the hub wrote. That is the whole reason it is
/// checked here.
///
/// 4,500,000 is the lower of the two readings of "4.5 MB", and which one the
/// platform means is not established (coilbox-hub#162). Taking the lower one
/// refuses a little more than it has to and never lets through a body that would
/// come back as an opaque platform error, which is the failure worth avoiding.
pub const MAX_BODY_BYTES: u64 = 4_500_000;

/// What the multipart framing and the JSON declaration cost on top of the picture.
///
/// Generous rather than measured: the declaration is a few hundred bytes at the
/// table's own field lengths, and the framing is two boundaries and two sets of
/// headers. Being wrong in this direction refuses a picture that would have just
/// fitted, and being wrong in the other direction is the opaque platform error.
const ENVELOPE_ALLOWANCE: u64 = 4 * 1024;

/// The largest picture that leaves room for the envelope inside
/// [`MAX_BODY_BYTES`].
pub const MAX_ASSET_BYTES: u64 = MAX_BODY_BYTES - ENVELOPE_ALLOWANCE;

/// The one variant that carries a world height range, spelled once so the
/// declaration and the rule about it cannot come apart. The same string
/// `coilbox_unitsync_worker::assetencode::HEIGHT_OVERLAY_VARIANT` is, and the
/// vocabulary's, which the test below holds it to.
const HEIGHT_OVERLAY_VARIANT: &str = "overlay:height";

/// What produced the bytes, which the hub records on the row so a later re-encode
/// pass can target only what needs redoing. The hub's own `ASSET_ORIGINS`, and the
/// test below holds it to the shared vocabulary rather than to a memory of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetOrigin {
    /// Read out of the archive as it was stored, which is a build pic or an
    /// infomap layer.
    Extracted,
    /// Drawn from the model, which is `render:<angle>`.
    Rendered,
    /// Handed over by a person rather than made from an archive.
    Uploaded,
}

/// One picture to send: what it is, and where its encoded bytes are on disk.
///
/// The field names on the wire are the hub's, from `parseAssetUpload`, which
/// refuses a name it does not know rather than ignoring it. Three fields a caller
/// might expect are deliberately absent:
///
/// - `width` and `height`, because the hub reads them out of the image header
///   (coilbox-hub#105). A declared pair could only agree with the bytes or be
///   wrong.
/// - `hash`, over the encoded bytes, because those bytes are in the request and
///   the hub computes it (coilbox-hub#154). It is the leaf of the object's path,
///   so a client that could declare it could choose which picture a later
///   promotion overwrote.
/// - `bytes`, which is in the hub's declaration but is filled in here from the
///   file's own length rather than taken from the caller. The hub refuses a
///   declaration whose length disagrees with what arrived, and there is only one
///   thing that can be right about a file's size.
///
/// `source_hash` stays the caller's word, and that is not an inconsistency: it is
/// over the raw archive bytes, which never reach the hub.
///
/// The four map fields are flat optionals rather than one nested struct because
/// this type is both the wire shape and the shape the webview hands over, and the
/// hub wants them at the top level. Which combinations are legal is [`check`]'s
/// job: a map row needs its extent, and a height range belongs to `overlay:height`
/// and to nothing else.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssetUpload {
    #[serde(flatten)]
    pub identity: AssetIdentity,
    /// sha256 over the source the picture was derived from, never over the encoded
    /// bytes. This is what the have check compares on, so it has to be the same
    /// hash the have check was asked with.
    pub source_hash: String,
    /// The vocabulary's `encodeProfile` for this variant's class, e.g.
    /// `webp-q80-512`.
    pub encode_profile: String,
    pub origin: AssetOrigin,
    /// The type the bytes are, which the hub checks twice: against the class, and
    /// against the header it sniffs off the bytes themselves.
    pub mime: String,
    /// The name the archive the picture came out of declares for itself, which is
    /// the worker's `sourceArchive` verbatim and never a file name (issue #1678).
    /// Provenance on the row, and the field coilbox-hub#116 compares source bytes
    /// within, so it has to be the same string on two honest installs of one
    /// build however each was installed.
    pub source_archive: String,
    /// The map's size in elmos, which is what `coilbox_assets::map_extent_elmos`
    /// answers and never the "16 by 12" a player says out loud. Required on a map
    /// row and refused on a unit one: nothing downstream of extraction can recover
    /// the world size, and without it every overlay is subtly misaligned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_height: Option<u32>,
    /// World height at sample 0 and at sample 65535, for `overlay:height` and
    /// nothing else. They are the whole of what turns a grayscale sample back into
    /// a height, and only the archive has them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_height_min: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_height_max: Option<f32>,
    /// Where the encoded file is. Never serialised: it is this machine's path and
    /// the hub has no use for it.
    #[serde(skip_serializing)]
    pub path: PathBuf,
}

impl AssetUpload {
    /// A short name for this picture, for a progress line and for a refusal. Not a
    /// key and not parsed by anything.
    pub fn describe(&self) -> String {
        match &self.identity {
            AssetIdentity::Unit {
                game,
                unit_name,
                variant,
            } => format!("{game}'s {unit_name} {variant}"),
            AssetIdentity::Map { map_name, variant } => format!("{map_name}'s {variant}"),
        }
    }

    fn variant(&self) -> &str {
        match &self.identity {
            AssetIdentity::Unit { variant, .. } | AssetIdentity::Map { variant, .. } => variant,
        }
    }

    /// The key that asks the hub whether it wants this one.
    fn key(&self) -> AssetKey {
        AssetKey {
            identity: self.identity.clone(),
            source_hash: self.source_hash.clone(),
        }
    }
}

/// What became of one asset. Answered in the order the assets were given, so a
/// caller can zip the two by index.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetOutcome {
    pub result: Outcome,
    /// The hub's status, when the hub answered, and `None` when nothing was sent.
    pub status: Option<u16>,
    /// Why not, in the words of whoever objected, naming the picture it was about.
    pub said: Option<String>,
    /// What that refusal is worth doing about, and `None` when there was no
    /// refusal. See [`Verdict`].
    pub verdict: Option<Verdict>,
}

/// Whether another request would say anything different (issue #1634).
///
/// The same split [`coilbox_oauth::AuthError::needs_sign_in`] makes one layer
/// down, and made for the same reason: a failure that will never come out
/// differently has to be told apart from one that will, or the client sends the
/// same bytes until something else stops it.
///
/// Read off the hub's status alone. The hub's own words are what a person is
/// shown, but nothing here parses them: a rule about a message is a rule that
/// breaks when somebody rewords an error.
///
/// # What the hub actually answers, and what each one means
///
/// Replayed through the hub's own `checkAssetImage` and read out of its upload
/// route (`app/api/v1/assets/upload/route.ts`), rather than assumed:
///
/// - **400** the bytes are not what the class is: not square, not lossless, too
///   few bits a channel, not grayscale, no header the hub can measure, a variant
///   it stores nothing for, or a declaration it will not parse.
/// - **413** too many pixels on the longest edge, more bytes than the class
///   allows, or an account over its storage quota.
/// - **415** the declared type is not the class's, or the bytes are not the
///   declared type.
/// - **403** the hub has no recorded permission to redistribute pictures for that
///   game or map.
/// - **409** the identity is another account's, or was rejected by a moderator, or
///   is already held at this `source_hash`, or the unit is at its render ceiling.
/// - **401** no token, or one the hub will not take.
/// - **429** more uploads for that game, or for maps, than the hourly cap.
/// - **5xx** the asset store refused, a quota could not be read, the row could not
///   be written, or the hub is not configured.
///
/// Every one of those is refused before a byte is written, which is why retrying
/// one costs the hub nothing and buys the sender nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// These bytes get this answer for ever. Sent once, never again, and somebody
    /// is told: a dimension or type refusal means coilbox made a picture that does
    /// not match the class it labelled it with, which is a bug here rather than
    /// anything the hub or the user did.
    ///
    /// The run carries on to the next picture, because this is about one picture.
    /// [`SAME_REFUSAL_LIMIT`] is what stops that being true three hundred times in
    /// a row.
    Terminal,
    /// The hub could not answer just now. Tried again, up to [`UPLOAD_ATTEMPTS`],
    /// and the run ends if it still cannot.
    Transient,
    /// Not about this picture at all: the account, or the allowance. The same
    /// answer for every asset left in the run and not one another request changes,
    /// so the run ends without a retry.
    Blocked,
}

/// What the hub's status is worth doing about.
///
/// 429 is [`Verdict::Blocked`] rather than [`Verdict::Transient`] on purpose. It
/// is worth trying again, but not in this run: the cap is a count of rows written
/// in the last hour, so a second attempt half a second later asks a question whose
/// answer cannot have moved. Ending the run is what "later" means here.
///
/// Two of these are imprecise and cannot be made precise from a status. The
/// account storage quota shares 413 with the pixel and byte caps, and the hub's
/// monthly allowance shares 503 with the failures that really are transient. Both
/// err in the affordable direction: the quota costs at most
/// [`SAME_REFUSAL_LIMIT`] requests before the run stops, and the allowance at most
/// [`UPLOAD_ATTEMPTS`].
fn verdict_for(status: u16) -> Verdict {
    match status {
        401 | 429 => Verdict::Blocked,
        500..=599 => Verdict::Transient,
        _ => Verdict::Terminal,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The hub had no row for this identity and now has one, pending review.
    Uploaded,
    /// The hub held this identity at a different `source_hash` and the row now
    /// holds these bytes, back to pending.
    Replaced,
    /// The have check said the hub already holds it, so nothing was sent.
    AlreadyHad,
    /// Refused, either here before any request or by the hub.
    Refused,
    /// Never got as far as being tried: the run was cancelled, or an answer about
    /// the account or the hub ended it.
    NotAttempted,
}

impl AssetOutcome {
    /// Refused here, before any request. Always terminal: everything [`check`]
    /// objects to is a fact about the file on disk, and no number of requests
    /// changes one.
    fn refused_locally(said: String) -> Self {
        Self {
            result: Outcome::Refused,
            status: None,
            said: Some(said),
            verdict: Some(Verdict::Terminal),
        }
    }

    /// An outcome with nothing to explain: taken, already held, or never tried.
    fn nothing_said(result: Outcome, status: Option<u16>) -> Self {
        Self {
            result,
            status,
            said: None,
            verdict: None,
        }
    }
}

/// One progress sample. Flat and camelCase over a `tauri::ipc::Channel`, the same
/// shape the downloads plugin's `DownloadProgress` is, so the frontend reads a
/// familiar thing.
///
/// The samples are per asset rather than per chunk. A backfill is a few hundred
/// pictures of 5 to 150 KB each, and what a reader needs to see move is which
/// picture and how many are left, not the bytes inside one POST that finishes in a
/// single write.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetUploadProgress {
    /// Coarse stage: `"asking"` while the have check runs, `"uploading"` while an
    /// asset is in flight, `"done"` at the end.
    pub phase: String,
    /// How many of the set have been decided, however they were decided.
    pub done: usize,
    pub total: usize,
    /// 0..=100, and `None` for an empty set.
    pub percent: Option<f64>,
    pub uploaded: usize,
    pub already_had: usize,
    pub refused: usize,
    pub uploaded_bytes: u64,
    /// Which picture this sample is about, when it is about one.
    pub subject: Option<String>,
}

/// Percentage `done` is of `total`, or `None` when there is nothing to be a
/// fraction of.
fn percent(done: usize, total: usize) -> Option<f64> {
    (total > 0).then(|| ((done as f64 / total as f64) * 100.0).min(100.0))
}

/// Everything about one asset that can be known without asking the hub.
///
/// Not a copy of the hub's validation, which stays the authority. These are the
/// three that cost more than a round trip to be wrong about:
///
/// - A body the platform will refuse, which comes back as a platform error rather
///   than as anything the hub wrote.
/// - A variant that is not a picture the hub keeps, or one sent under the wrong key
///   shape, which the have check would answer `missing` for and `missing` means go
///   and make it.
/// - A declaration whose shape the hub will refuse for free: a map without its
///   extent, a height range on something that is not a height overlay, a MIME that
///   is not the one the class is.
fn check(asset: &AssetUpload, bytes: u64) -> Result<(), String> {
    let what = asset.describe();
    let variant = asset.variant();

    let Some(class) = class_for_variant(variant) else {
        return Err(format!(
            "{what} is a \"{variant}\", which is not a picture the hub keeps. See shared/asset-vocabulary.json."
        ));
    };
    let keyed_on = match asset.identity {
        AssetIdentity::Unit { .. } => KeyedOn::Unit,
        AssetIdentity::Map { .. } => KeyedOn::Map,
    };
    if class.keyed_on != keyed_on {
        return Err(format!(
            "{what} sends \"{variant}\" under the wrong key shape: it is a {} picture.",
            match class.keyed_on {
                KeyedOn::Unit => "unit",
                KeyedOn::Map => "map",
            }
        ));
    }
    if asset.mime != class.mime {
        return Err(format!(
            "{what} is declared {} and a \"{variant}\" is {}.",
            asset.mime, class.mime
        ));
    }
    if asset.source_hash.trim().is_empty() {
        return Err(format!(
            "{what} has no source_hash. The have check compares on it, so it cannot be asked about or stored."
        ));
    }
    if bytes == 0 {
        return Err(format!(
            "{what} is an empty file at {}.",
            asset.path.display()
        ));
    }

    // Before the class cap, because this is the one the reader cannot act on by
    // re-encoding and the one that would otherwise arrive as a platform error.
    if bytes > MAX_ASSET_BYTES {
        return Err(format!(
            "{what} is {bytes} bytes and the hub's upload route cannot carry a picture over {MAX_ASSET_BYTES}. Nothing is wrong with the picture: the platform refuses the request before the hub sees it. What to do about it is coilbox-hub#162."
        ));
    }
    if let Some(cap) = class.max_bytes {
        if bytes > cap {
            return Err(format!(
                "{what} is {bytes} bytes and a \"{variant}\" may be at most {cap}."
            ));
        }
    }

    let extent = asset.map_width.is_some() || asset.map_height.is_some();
    let is_map = matches!(asset.identity, AssetIdentity::Map { .. });
    if is_map && !(asset.map_width.is_some() && asset.map_height.is_some()) {
        return Err(format!(
            "{what} carries no map size. The hub stores the extent on every map row, and nothing downstream of extraction can recover it."
        ));
    }
    if !is_map && extent {
        return Err(format!("{what} is a unit picture carrying a map's size."));
    }

    let range = (asset.world_height_min, asset.world_height_max);
    let is_height_overlay = variant == HEIGHT_OVERLAY_VARIANT;
    match range {
        (Some(min), Some(max)) if is_height_overlay => {
            if max < min {
                return Err(format!("{what} has a world height range that runs backwards."));
            }
        }
        (None, None) if !is_height_overlay => {}
        (_, _) if is_height_overlay => {
            return Err(format!(
                "{what} carries no world height range, and a height overlay without one is a picture of a heightmap rather than a heightmap."
            ))
        }
        _ => {
            return Err(format!(
                "{what} carries a world height range, which belongs to \"{HEIGHT_OVERLAY_VARIANT}\" and to nothing else."
            ))
        }
    }
    Ok(())
}

/// Why a request produced no answer at all, which is not the same as an answer
/// that says no.
struct SendError {
    said: String,
    /// Whether the same request is worth making again. A request that never
    /// arrived or never came back is. An answer that was not an upload never will
    /// be, and neither is a picture that cannot be framed as a request.
    worth_another_go: bool,
}

impl SendError {
    fn never(said: String) -> Self {
        Self {
            said,
            worth_another_go: false,
        }
    }
}

/// Send one asset, trying again while the answer is one another request could
/// change.
///
/// Bounded twice over, and the second bound is the one that matters: only
/// [`UPLOAD_ATTEMPTS`] per picture, and a picture that uses them all ends the run,
/// so a hub answering 503 to everything costs three requests and not three
/// hundred.
async fn send_with_retries(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    asset: &AssetUpload,
    body: &[u8],
    cancel: &Arc<AtomicBool>,
) -> Result<AssetOutcome, String> {
    let mut waiting = RETRY_BACKOFF;
    let mut attempt = 1;
    loop {
        let sent = send(client, url, token, asset, body.to_vec()).await;
        let again = match &sent {
            Ok(outcome) => outcome.verdict == Some(Verdict::Transient),
            Err(e) => e.worth_another_go,
        };
        if !again || attempt >= UPLOAD_ATTEMPTS {
            return sent.map_err(|e| e.said);
        }
        // Raced against the flag rather than slept through, so a cancel during a
        // wait lands then rather than a second and a half later.
        tokio::select! {
            biased;
            () = watch(cancel) => return sent.map_err(|e| e.said),
            () = tokio::time::sleep(waiting) => {}
        }
        waiting *= 2;
        attempt += 1;
    }
}

/// Send one asset, and say what the hub made of it.
///
/// `bytes` is the file's own length, read by the caller, so the declaration and
/// the part can never disagree about it.
async fn send(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    asset: &AssetUpload,
    body: Vec<u8>,
) -> Result<AssetOutcome, SendError> {
    let declaration = declaration_json(asset, body.len() as u64).map_err(SendError::never)?;
    // A named part, because the route asks for a `Blob` and a multipart part with
    // no filename arrives as a string. The name is the file's own, which is its
    // content hash and says nothing about this machine.
    let file_name = asset
        .path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "asset".to_owned());
    let part = reqwest::multipart::Part::bytes(body)
        .file_name(file_name)
        .mime_str(&asset.mime)
        .map_err(|_| {
            SendError::never(format!(
                "{} is declared as {}, which is not a type.",
                asset.describe(),
                asset.mime
            ))
        })?;
    let form = reqwest::multipart::Form::new()
        .text("asset", declaration)
        .part("file", part);

    let response = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .multipart(form)
        .send()
        .await
        // A request that never arrived or never came back is the most retryable
        // failure there is, so this is the one thing here worth another go.
        .map_err(|e| SendError {
            said: unreachable_message(url, e.is_timeout()),
            worth_another_go: true,
        })?;

    let status = response.status().as_u16();
    let read = read_capped(response, ANSWER_LIMIT)
        .await
        .map_err(SendError::never)?;
    if status != 200 && status != 201 {
        return Ok(AssetOutcome {
            result: Outcome::Refused,
            status: Some(status),
            said: Some(refusal(status, &read, url, asset)),
            verdict: Some(verdict_for(status)),
        });
    }

    let answered: UploadBody = serde_json::from_slice(&read).map_err(|_| {
        SendError::never(format!(
            "The hub at {} did not answer with an upload.",
            host_of(url)
        ))
    })?;
    if answered.format != UPLOAD_FORMAT {
        return Err(SendError::never(format!(
            "The hub at {} answered with something other than an upload.",
            host_of(url)
        )));
    }
    if answered.version > UPLOAD_VERSION {
        return Err(SendError::never(format!(
            "The hub at {} speaks version {} of the upload and this version of coilbox understands {UPLOAD_VERSION}. Update coilbox.",
            host_of(url),
            answered.version
        )));
    }
    // 201 is a row the hub did not have and 200 is one it replaced, which is the
    // hub's own distinction rather than one read off the body.
    Ok(AssetOutcome::nothing_said(
        if status == 201 {
            Outcome::Uploaded
        } else {
            Outcome::Replaced
        },
        Some(status),
    ))
}

/// The JSON part, by the names the hub insists on.
///
/// `bytes` is added here rather than carried on [`AssetUpload`] because it is the
/// file's own length. The hub refuses a declaration whose length disagrees with
/// what arrived, and there is only one thing that can be right about a file's size.
fn declaration_json(asset: &AssetUpload, bytes: u64) -> Result<String, String> {
    #[derive(Serialize)]
    struct Declared<'a> {
        #[serde(flatten)]
        asset: &'a AssetUpload,
        bytes: u64,
    }
    serde_json::to_string(&Declared { asset, bytes }).map_err(|e| e.to_string())
}

/// The whole answer, as the hub sends it.
#[derive(Debug, Deserialize)]
struct UploadBody {
    format: String,
    version: u32,
}

/// Send a set of pictures to the hub, as the signed-in account.
///
/// `consent` is the user's agreement to send pictures off this machine (issue
/// #1635), and is the reason this takes an argument it never reads. The type has a
/// private field and one constructor, so an upload path cannot compile without the
/// check having run. See [`crate::consent`].
///
/// `report` is called with every progress sample, and `cancel` is polled between
/// assets and raced against each request, so a cancel lands mid transfer rather
/// than after it.
pub async fn upload_all(
    hub_url: &str,
    assets: &[AssetUpload],
    consent: &AssetUploadConsent,
    report: &(dyn Fn(AssetUploadProgress) + Send + Sync),
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<AssetOutcome>, String> {
    if assets.is_empty() {
        return Ok(Vec::new());
    }
    // Both addresses before the token, so a hub that could never carry one does not
    // spend a refresh finding out.
    api_url(hub_url, UPLOAD_PATH, "Sending pictures to the hub")?;
    api_url(hub_url, HAVE_PATH, "Sending pictures to the hub")?;

    let token = auth::access_token(hub_url)
        .await
        .map_err(|e| auth::explain(&e, hub_url))?;
    run(hub_url, &token, assets, consent, report, cancel).await
}

/// Everything below the token, which is what a test over loopback can reach: a
/// keychain prompt in a test run is a test that hangs.
pub(crate) async fn run(
    hub_url: &str,
    token: &str,
    assets: &[AssetUpload],
    _consent: &AssetUploadConsent,
    report: &(dyn Fn(AssetUploadProgress) + Send + Sync),
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<AssetOutcome>, String> {
    let upload_url = api_url(hub_url, UPLOAD_PATH, "Sending pictures to the hub")?;
    let have_url = api_url(hub_url, HAVE_PATH, "Sending pictures to the hub")?;

    let mut tally = Tally::new(assets.len());
    let mut outcomes: Vec<Option<AssetOutcome>> = vec![None; assets.len()];

    // Everything knowable without asking, first, so a set that could never be
    // stored does not reach the hub at all. An asset refused here is left out of
    // the have batch too: asking about a picture that can never be sent spends an
    // allowance the whole community shares.
    let mut askable: Vec<usize> = Vec::with_capacity(assets.len());
    for (index, asset) in assets.iter().enumerate() {
        match file_size(&asset.path).and_then(|bytes| check(asset, bytes)) {
            Ok(()) => askable.push(index),
            Err(said) => {
                outcomes[index] = Some(AssetOutcome::refused_locally(said));
                tally.refused(report, assets[index].describe());
            }
        }
    }
    if askable.is_empty() {
        tally.finish(report);
        return Ok(settle(outcomes));
    }
    if cancelled(cancel) {
        tally.finish(report);
        return Ok(settle(outcomes));
    }

    // The have check, before any render, encode or transfer this run could still
    // avoid. Answered in request order, so it zips with `askable` by index.
    tally.asking(report);
    let keys: Vec<AssetKey> = askable.iter().map(|&i| assets[i].key()).collect();
    let answers = have::ask_in_batches(&have_url, token, &keys).await?;
    if answers.len() != askable.len() {
        return Err(format!(
            "The hub at {} answered {} of {} keys.",
            host_of(&have_url),
            answers.len(),
            askable.len()
        ));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(UPLOAD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    // How many pictures in a row the hub has refused with the same status, which
    // is what [`SAME_REFUSAL_LIMIT`] reads.
    let mut same_refusal = 0usize;
    let mut said_before: Option<u16> = None;

    for (slot, &index) in askable.iter().enumerate() {
        if answers[slot].status == HaveStatus::Have {
            outcomes[index] = Some(AssetOutcome::nothing_said(Outcome::AlreadyHad, None));
            tally.already_had(report, assets[index].describe());
            continue;
        }
        if cancelled(cancel) {
            break;
        }

        let asset = &assets[index];
        tally.uploading(report, asset.describe());
        let body = match std::fs::read(&asset.path) {
            Ok(body) => body,
            Err(_) => {
                outcomes[index] = Some(AssetOutcome::refused_locally(format!(
                    "{} could not be read from {}.",
                    asset.describe(),
                    asset.path.display()
                )));
                tally.refused(report, asset.describe());
                continue;
            }
        };
        let sent = body.len() as u64;

        // Raced against the flag rather than polled after the fact, so a cancel
        // during a transfer drops the request in flight. Dropping the future is
        // what closes the connection.
        let outcome = tokio::select! {
            biased;
            () = watch(cancel) => break,
            outcome = send_with_retries(&client, &upload_url, token, asset, &body, cancel) => outcome?,
        };

        match outcome.result {
            Outcome::Refused => tally.refused(report, asset.describe()),
            _ => tally.uploaded(report, asset.describe(), sent),
        }

        // Two ways a run ends on a refusal, and neither of them is a retry.
        let stop = match outcome.verdict {
            // About the account, the allowance, or a hub that will not answer.
            // Every asset left gets the same, and a `Transient` that reaches here
            // has already had its attempts.
            Some(Verdict::Blocked | Verdict::Transient) => true,
            // One picture the hub will never take does not end a backfill. The
            // same answer five times running is not about one picture.
            Some(Verdict::Terminal) => {
                same_refusal = if outcome.status == said_before {
                    same_refusal + 1
                } else {
                    1
                };
                said_before = outcome.status;
                same_refusal >= SAME_REFUSAL_LIMIT
            }
            None => {
                same_refusal = 0;
                said_before = None;
                false
            }
        };
        outcomes[index] = Some(outcome);
        if stop {
            break;
        }
    }

    tally.finish(report);
    Ok(settle(outcomes))
}

/// Anything still undecided was never tried, which is a cancelled run or one that
/// stopped on an answer about the account rather than about a picture.
fn settle(outcomes: Vec<Option<AssetOutcome>>) -> Vec<AssetOutcome> {
    outcomes
        .into_iter()
        .map(|o| o.unwrap_or(AssetOutcome::nothing_said(Outcome::NotAttempted, None)))
        .collect()
}

fn cancelled(cancel: &Arc<AtomicBool>) -> bool {
    cancel.load(Ordering::Relaxed)
}

/// Resolves once the flag is up. Polled rather than notified, because the flag is
/// what `hub_upload_cancel` can reach from another command with no channel between
/// them, and a second's granularity is well inside a person's patience.
async fn watch(cancel: &Arc<AtomicBool>) {
    while !cancelled(cancel) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// The file's length, without reading it. A picture is read only once it is known
/// to be worth sending.
fn file_size(path: &Path) -> Result<u64, String> {
    std::fs::metadata(path)
        .map(|md| md.len())
        .map_err(|_| format!("There is no encoded picture at {}.", path.display()))
}

/// The running counts, and the samples they produce.
struct Tally {
    done: usize,
    total: usize,
    uploaded: usize,
    already_had: usize,
    refused: usize,
    uploaded_bytes: u64,
}

impl Tally {
    fn new(total: usize) -> Self {
        Self {
            done: 0,
            total,
            uploaded: 0,
            already_had: 0,
            refused: 0,
            uploaded_bytes: 0,
        }
    }

    fn sample(&self, phase: &str, subject: Option<String>) -> AssetUploadProgress {
        AssetUploadProgress {
            phase: phase.to_owned(),
            done: self.done,
            total: self.total,
            percent: percent(self.done, self.total),
            uploaded: self.uploaded,
            already_had: self.already_had,
            refused: self.refused,
            uploaded_bytes: self.uploaded_bytes,
            subject,
        }
    }

    fn asking(&self, report: &(dyn Fn(AssetUploadProgress) + Send + Sync)) {
        report(self.sample("asking", None));
    }

    fn uploading(&self, report: &(dyn Fn(AssetUploadProgress) + Send + Sync), what: String) {
        report(self.sample("uploading", Some(what)));
    }

    fn uploaded(
        &mut self,
        report: &(dyn Fn(AssetUploadProgress) + Send + Sync),
        what: String,
        bytes: u64,
    ) {
        self.done += 1;
        self.uploaded += 1;
        self.uploaded_bytes += bytes;
        report(self.sample("uploading", Some(what)));
    }

    fn already_had(&mut self, report: &(dyn Fn(AssetUploadProgress) + Send + Sync), what: String) {
        self.done += 1;
        self.already_had += 1;
        report(self.sample("uploading", Some(what)));
    }

    fn refused(&mut self, report: &(dyn Fn(AssetUploadProgress) + Send + Sync), what: String) {
        self.done += 1;
        self.refused += 1;
        report(self.sample("uploading", Some(what)));
    }

    fn finish(&self, report: &(dyn Fn(AssetUploadProgress) + Send + Sync)) {
        report(self.sample("done", None));
    }
}

/// What the hub said no with. Its own words when it gave any, because it is the
/// side that knows what it objected to.
///
/// The picture is named, so the sentence stands on its own. A backfill's outcomes
/// are positional and a notification is not, and "a buildpic is not square" is no
/// use to anybody without which buildpic. The exception is 401, which is about the
/// account and would be misleading with a picture's name attached to it.
fn refusal(status: u16, body: &[u8], url: &str, asset: &AssetUpload) -> String {
    let said = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.as_str().map(str::to_owned));
    let host = host_of(url);
    let what = asset.describe();
    match (status, said) {
        (401, _) => format!(
            "The hub at {host} did not accept the sign-in. Sign in again and try once more."
        ),
        (_, Some(said)) => format!("The hub at {host} refused {what}: {said}"),
        (_, None) => format!("The hub at {host} refused {what}, with a {status}."),
    }
}

/// Why the hub was never reached. Both cases name the host, because it is a
/// setting and often not the default one, and both name waking up, because a hub
/// asleep on a free tier is the likeliest reason a request never lands.
fn unreachable_message(url: &str, timed_out: bool) -> String {
    let host = host_of(url);
    if timed_out {
        format!("The hub at {host} took too long to answer. It may be waking up after a quiet spell, so try again in a moment.")
    } else {
        format!("Could not reach the hub at {host}. Check your connection, and give it a moment if it is waking up after a quiet spell.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::HubServer;
    use std::sync::Mutex;

    /// A directory of this test's own, cleared first, so a run is not reading what
    /// the last one left.
    fn asset_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-hub-upload-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A file of `bytes` bytes, named the way the encoder names one.
    fn file(dir: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, vec![0x42u8; bytes]).unwrap();
        path
    }

    fn unit(path: PathBuf, unit_name: &str, source_hash: &str) -> AssetUpload {
        AssetUpload {
            identity: AssetIdentity::Unit {
                game: "bar".into(),
                unit_name: unit_name.into(),
                variant: "buildpic".into(),
            },
            source_hash: source_hash.into(),
            encode_profile: "webp-lossless-256".into(),
            origin: AssetOrigin::Extracted,
            mime: "image/webp".into(),
            source_archive: "Beyond All Reason test-1.sdd".into(),
            map_width: None,
            map_height: None,
            world_height_min: None,
            world_height_max: None,
            path,
        }
    }

    fn overlay(path: PathBuf, variant: &str) -> AssetUpload {
        AssetUpload {
            identity: AssetIdentity::Map {
                map_name: "Mediterraneum_V1".into(),
                variant: variant.into(),
            },
            source_hash: "src-map".into(),
            encode_profile: "png16-lossless-source".into(),
            origin: AssetOrigin::Extracted,
            mime: "image/png".into(),
            source_archive: "mediterraneum_v1.sd7".into(),
            map_width: Some(16384),
            map_height: Some(16384),
            world_height_min: Some(-120.5),
            world_height_max: Some(880.0),
            path,
        }
    }

    /// Every sample a run reported, so progress can be asserted on rather than
    /// assumed to have happened.
    #[derive(Default)]
    struct Samples(Mutex<Vec<AssetUploadProgress>>);

    impl Samples {
        fn report(&self) -> impl Fn(AssetUploadProgress) + Send + Sync + '_ {
            move |sample| self.0.lock().unwrap().push(sample)
        }

        fn taken(&self) -> Vec<AssetUploadProgress> {
            self.0.lock().unwrap().clone()
        }
    }

    async fn upload(
        hub: &HubServer,
        assets: &[AssetUpload],
        samples: &Samples,
        cancel: &Arc<AtomicBool>,
    ) -> Result<Vec<AssetOutcome>, String> {
        run(
            &hub.base(),
            "a-token",
            assets,
            &AssetUploadConsent::for_test(),
            &samples.report(),
            cancel,
        )
        .await
    }

    fn results(outcomes: &[AssetOutcome]) -> Vec<Outcome> {
        outcomes.iter().map(|o| o.result).collect()
    }

    fn open() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    // ------------------------------------------------------------------ shape

    /// The declaration the hub is sent, by the names it insists on.
    /// `parseAssetUpload` refuses a field name it does not know rather than
    /// ignoring it, so a client that sent `sourceHash` would get a 400 naming it.
    #[test]
    fn the_declaration_uses_the_hubs_field_names() {
        let dir = asset_dir("shape");
        let sent: serde_json::Value = serde_json::from_str(
            &declaration_json(&unit(file(&dir, "a.webp", 9), "armsolar", "src-a"), 9).unwrap(),
        )
        .unwrap();
        assert_eq!(
            sent,
            serde_json::json!({
                "keyed_on": "unit",
                "game": "bar",
                "unit_name": "armsolar",
                "variant": "buildpic",
                "source_hash": "src-a",
                "encode_profile": "webp-lossless-256",
                "origin": "extracted",
                "mime": "image/webp",
                "bytes": 9,
                "source_archive": "Beyond All Reason test-1.sdd",
            })
        );
    }

    /// The three the hub computes for itself, and refuses to be told. `width` and
    /// `height` come off the image header (coilbox-hub#105) and `hash` is the leaf
    /// of the object's path, so a client that could declare it could choose which
    /// picture a later promotion overwrote (coilbox-hub#154).
    #[test]
    fn the_declaration_claims_nothing_the_hub_reads_off_the_bytes() {
        let dir = asset_dir("claims");
        let sent: serde_json::Value = serde_json::from_str(
            &declaration_json(&unit(file(&dir, "a.webp", 9), "armsolar", "src-a"), 9).unwrap(),
        )
        .unwrap();
        for field in ["width", "height", "hash"] {
            assert!(sent.get(field).is_none(), "{field} in {sent}");
        }
    }

    /// A map declaration carries the extent and, for a height overlay, the range
    /// that turns a sample back into a height. Neither belongs on a unit row and
    /// the hub refuses both there.
    #[test]
    fn a_map_declaration_carries_the_extent_and_the_height_range() {
        let dir = asset_dir("mapshape");
        let sent: serde_json::Value = serde_json::from_str(
            &declaration_json(&overlay(file(&dir, "h.png", 9), "overlay:height"), 9).unwrap(),
        )
        .unwrap();
        assert_eq!(
            sent,
            serde_json::json!({
                "keyed_on": "map",
                "map_name": "Mediterraneum_V1",
                "variant": "overlay:height",
                "source_hash": "src-map",
                "encode_profile": "png16-lossless-source",
                "origin": "extracted",
                "mime": "image/png",
                "bytes": 9,
                "source_archive": "mediterraneum_v1.sd7",
                "map_width": 16384,
                "map_height": 16384,
                "world_height_min": -120.5,
                "world_height_max": 880.0,
            })
        );
    }

    /// What produced the bytes, held to the shared vocabulary rather than to a
    /// memory of it. The hub refuses anything outside its own `ASSET_ORIGINS`.
    #[test]
    fn the_origins_are_the_shared_vocabularys_own() {
        let spelled: Vec<String> = [
            AssetOrigin::Extracted,
            AssetOrigin::Rendered,
            AssetOrigin::Uploaded,
        ]
        .iter()
        .map(|o| {
            serde_json::to_value(o)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
        assert_eq!(spelled, coilbox_assets::vocabulary().origins);
    }

    /// The variant a world height range belongs to is the vocabulary's, not a
    /// second spelling of it.
    #[test]
    fn the_height_overlay_is_a_variant_the_vocabulary_lists() {
        assert!(coilbox_assets::vocabulary()
            .map_variants
            .iter()
            .any(|v| v == HEIGHT_OVERLAY_VARIANT));
    }

    // ------------------------------------------- built from the worker's JSON

    /// One build pic row exactly as `--seed` printed it, copied out of a manifest
    /// written over this machine's library.
    ///
    /// Beyond All Reason on purpose, because it installs through the rapid pool:
    /// the file the bytes came out of is
    /// `ded9b29714a05164e4b4523b09809af2.sdp` and what the row carries is the
    /// build's own name (issue #1678).
    const WORKER_UNIT_ROW: &str = r#"{"kind":"unit","game":"BYAR","unitName":"armaak","variant":"buildpic","origin":"extracted","tier":"static","batch":5,"file":"batch-0005/33ca2586ee23893d0b33d6638b7b9244b188fd42755cd87f8490b0c8bc28acd0.webp","hash":"33ca2586ee23893d0b33d6638b7b9244b188fd42755cd87f8490b0c8bc28acd0","sourceHash":"2ca8d90a74d6b233dfd5469477e78411487c90dd7ab0c26add83764093d38182","encodeProfile":"webp-lossless-256","mime":"image/webp","width":256,"height":256,"bytes":121042,"sourceArchive":"Beyond All Reason test-30922-8064a43","sourceMember":"unitpics/armaak.dds"}"#;

    /// And one map row, which is the other key shape and the only variant
    /// carrying a world height range.
    const WORKER_MAP_ROW: &str = r#"{"kind":"map","mapName":"1 Pass Greenland Redux v3","variant":"overlay:height","origin":"extracted","tier":"static","batch":1,"file":"batch-0001/3deb27ba72cf8aa390d7dfb5dc78390af1bfc77dd6240d0b965aa5604cee1da8.png","hash":"3deb27ba72cf8aa390d7dfb5dc78390af1bfc77dd6240d0b965aa5604cee1da8","sourceHash":"430af906ed2a7353a6ebebb24e0a41b40f97b103e11b73892fb1dcaa05108053","encodeProfile":"png16-lossless-source","mime":"image/png","width":769,"height":1281,"bytes":346656,"mapWidth":6144,"mapHeight":10240,"minHeight":90.0,"maxHeight":485.0,"sourceArchive":"1 Pass Greenland Redux v3"}"#;

    /// An [`AssetUpload`] from one of those rows and from nothing else.
    ///
    /// Every value is read straight out of the JSON. Nothing is derived from the
    /// variant, nothing defaults, and the caller passes nothing in, which is the
    /// whole of what #1678 asked for: a driver that had to invent
    /// `source_archive` would be inventing it onto a permanent public row.
    ///
    /// `path` is the one field the hub never sees, and the row names the file.
    fn from_worker_row(row: &str) -> (AssetUpload, u64) {
        let row: serde_json::Value = serde_json::from_str(row).unwrap();
        let text = |field: &str| row[field].as_str().unwrap().to_owned();
        let count = |field: &str| row.get(field).and_then(|v| v.as_u64()).map(|n| n as u32);
        let measure = |field: &str| row.get(field).and_then(|v| v.as_f64()).map(|n| n as f32);

        let identity = match row["kind"].as_str().unwrap() {
            "unit" => AssetIdentity::Unit {
                game: text("game"),
                unit_name: text("unitName"),
                variant: text("variant"),
            },
            _ => AssetIdentity::Map {
                map_name: text("mapName"),
                variant: text("variant"),
            },
        };
        let asset = AssetUpload {
            identity,
            source_hash: text("sourceHash"),
            encode_profile: text("encodeProfile"),
            origin: serde_json::from_value(row["origin"].clone()).unwrap(),
            mime: text("mime"),
            source_archive: text("sourceArchive"),
            map_width: count("mapWidth"),
            map_height: count("mapHeight"),
            world_height_min: measure("minHeight"),
            world_height_max: measure("maxHeight"),
            path: PathBuf::from(text("file")),
        };
        (asset, row["bytes"].as_u64().unwrap())
    }

    /// The unit declaration as `from_worker_row` builds it, and as the hub's own
    /// `parseAssetUpload` was run against it. Written out here rather than
    /// rebuilt from the struct, so this is the string the hub read.
    ///
    /// `parseAssetUpload` answered:
    ///
    /// ```json
    /// {"ok":true,"declaration":{"identity":{"keyedOn":"unit","game":"BYAR","unitName":"armaak","variant":"buildpic"},"sourceHash":"2ca8d90a74d6b233dfd5469477e78411487c90dd7ab0c26add83764093d38182","encodeProfile":"webp-lossless-256","origin":"extracted","mime":"image/webp","bytes":121042,"sourceArchive":"Beyond All Reason test-30922-8064a43","mapWidth":null,"mapHeight":null,"worldHeightMin":null,"worldHeightMax":null}}
    /// ```
    const WORKER_UNIT_DECLARATION: &str = r#"{"keyed_on":"unit","game":"BYAR","unit_name":"armaak","variant":"buildpic","source_hash":"2ca8d90a74d6b233dfd5469477e78411487c90dd7ab0c26add83764093d38182","encode_profile":"webp-lossless-256","origin":"extracted","mime":"image/webp","source_archive":"Beyond All Reason test-30922-8064a43","bytes":121042}"#;

    /// The map declaration, likewise. `parseAssetUpload` answered:
    ///
    /// ```json
    /// {"ok":true,"declaration":{"identity":{"keyedOn":"map","mapName":"1 Pass Greenland Redux v3","variant":"overlay:height"},"sourceHash":"430af906ed2a7353a6ebebb24e0a41b40f97b103e11b73892fb1dcaa05108053","encodeProfile":"png16-lossless-source","origin":"extracted","mime":"image/png","bytes":346656,"sourceArchive":"1 Pass Greenland Redux v3","mapWidth":6144,"mapHeight":10240,"worldHeightMin":90,"worldHeightMax":485}}
    /// ```
    const WORKER_MAP_DECLARATION: &str = r#"{"keyed_on":"map","map_name":"1 Pass Greenland Redux v3","variant":"overlay:height","source_hash":"430af906ed2a7353a6ebebb24e0a41b40f97b103e11b73892fb1dcaa05108053","encode_profile":"png16-lossless-source","origin":"extracted","mime":"image/png","source_archive":"1 Pass Greenland Redux v3","map_width":6144,"map_height":10240,"world_height_min":90.0,"world_height_max":485.0,"bytes":346656}"#;

    /// A driver can build a declaration out of what the worker printed, with no
    /// second source and no rule of its own.
    #[test]
    fn a_declaration_is_built_from_the_workers_json_alone() {
        let (unit, bytes) = from_worker_row(WORKER_UNIT_ROW);
        assert_eq!(
            declaration_json(&unit, bytes).unwrap(),
            WORKER_UNIT_DECLARATION
        );

        let (map, bytes) = from_worker_row(WORKER_MAP_ROW);
        assert_eq!(
            declaration_json(&map, bytes).unwrap(),
            WORKER_MAP_DECLARATION
        );
    }

    #[test]
    fn plain_http_will_not_carry_a_token() {
        let refused = api_url("http://hub.example", UPLOAD_PATH, "Sending").unwrap_err();
        assert!(refused.contains("https"), "{refused}");
    }

    #[test]
    fn the_route_is_built_off_the_configured_base() {
        assert_eq!(
            api_url("https://hub.example/", UPLOAD_PATH, "Sending").unwrap(),
            "https://hub.example/api/v1/assets/upload"
        );
    }

    // --------------------------------------------------------------- refusals

    /// The size exception. Two height overlays in this machine's map library are
    /// over the platform's body limit, and the platform refuses the body before any
    /// hub code runs, so the caller would get an opaque platform error instead of
    /// anything the hub wrote. Refused here, with what it is and why.
    #[test]
    fn a_picture_over_the_platforms_body_limit_is_refused_with_the_reason() {
        let dir = asset_dir("oversize");
        // Mediterraneum_V1's height overlay, measured at 5,326,359 bytes.
        let asset = overlay(file(&dir, "med.png", 0), "overlay:height");
        let refused = check(&asset, 5_326_359).unwrap_err();
        assert!(refused.contains("Mediterraneum_V1"), "{refused}");
        assert!(refused.contains("5326359"), "{refused}");
        assert!(refused.contains("cannot carry"), "{refused}");
        assert!(refused.contains("coilbox-hub#162"), "{refused}");
        assert!(
            refused.contains("Nothing is wrong with the picture"),
            "{refused}"
        );
    }

    /// Special Hotstepper 1.1.1's height overlay, at 4,645,750 bytes, lands between
    /// the two readings of "4.5 MB": over 4,500,000 and under 4,718,592. Which one
    /// the platform means is not established, so it is refused rather than gambled
    /// on, and the refusal is the same one that names the issue.
    #[test]
    fn a_picture_in_the_gap_between_the_two_readings_of_the_limit_is_refused() {
        let dir = asset_dir("gap");
        let mut asset = overlay(file(&dir, "hotstepper.png", 0), "overlay:height");
        if let AssetIdentity::Map { map_name, .. } = &mut asset.identity {
            *map_name = "Special Hotstepper 1.1.1".into();
        }
        let refused = check(&asset, 4_645_750).unwrap_err();
        assert!(refused.contains("Special Hotstepper 1.1.1"), "{refused}");
        assert!(refused.contains("coilbox-hub#162"), "{refused}");
    }

    #[test]
    fn a_picture_that_fits_is_not_refused_for_its_size() {
        let dir = asset_dir("fits");
        let asset = overlay(file(&dir, "ok.png", 0), "overlay:height");
        check(&asset, MAX_ASSET_BYTES).expect("the largest that fits is allowed");
    }

    #[test]
    fn a_variant_the_hub_does_not_keep_is_refused_before_it_is_sent() {
        let dir = asset_dir("variant");
        let mut asset = overlay(file(&dir, "a.png", 9), "overlay:metel");
        asset.world_height_min = None;
        asset.world_height_max = None;
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("overlay:metel"), "{refused}");
    }

    #[test]
    fn a_map_variant_on_a_unit_key_is_refused() {
        let dir = asset_dir("keyshape");
        let mut asset = unit(file(&dir, "a.webp", 9), "armsolar", "src-a");
        if let AssetIdentity::Unit { variant, .. } = &mut asset.identity {
            *variant = "minimap".into();
        }
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("wrong key shape"), "{refused}");
    }

    /// The class's own type, which the hub checks twice: against the class, and
    /// against the header it sniffs off the bytes. Being wrong here is a 415 the
    /// caller pays a round trip for.
    #[test]
    fn a_type_that_is_not_the_classs_is_refused() {
        let dir = asset_dir("mime");
        let mut asset = unit(file(&dir, "a.webp", 9), "armsolar", "src-a");
        asset.mime = "image/png".into();
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("image/png"), "{refused}");
        assert!(refused.contains("image/webp"), "{refused}");
    }

    #[test]
    fn a_map_picture_without_the_maps_size_is_refused() {
        let dir = asset_dir("noextent");
        let mut asset = overlay(file(&dir, "a.png", 9), "overlay:height");
        asset.map_width = None;
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("no map size"), "{refused}");
    }

    #[test]
    fn a_height_overlay_without_its_world_range_is_refused() {
        let dir = asset_dir("norange");
        let mut asset = overlay(file(&dir, "a.png", 9), "overlay:height");
        asset.world_height_min = None;
        asset.world_height_max = None;
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("world height range"), "{refused}");
    }

    /// The hub refuses a range on anything else, because a range is what makes the
    /// grayscale ramp mean something and no other layer is one.
    #[test]
    fn a_world_range_on_something_that_is_not_a_height_overlay_is_refused() {
        let dir = asset_dir("range");
        let mut asset = overlay(file(&dir, "a.webp", 9), "overlay:metal");
        asset.mime = "image/webp".into();
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("overlay:height"), "{refused}");
    }

    #[test]
    fn a_unit_picture_carrying_a_maps_size_is_refused() {
        let dir = asset_dir("unitextent");
        let mut asset = unit(file(&dir, "a.webp", 9), "armsolar", "src-a");
        asset.map_width = Some(8192);
        asset.map_height = Some(8192);
        let refused = check(&asset, 9).unwrap_err();
        assert!(refused.contains("carrying a map's size"), "{refused}");
    }

    // -------------------------------------------------------------- uploading

    /// The whole request, off the wire: the two parts the route reads, the bearer
    /// header, and the type the body is.
    #[tokio::test]
    async fn the_request_is_an_authenticated_multipart_post() {
        let dir = asset_dir("post");
        let bytes = b"RIFF....WEBPVP8L pretend".to_vec();
        let path = dir.join("armsolar.webp");
        std::fs::write(&path, &bytes).unwrap();
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();

        let outcomes = upload(&hub, &[unit(path, "armsolar", "src-a")], &samples, &open())
            .await
            .unwrap();

        assert_eq!(results(&outcomes), vec![Outcome::Uploaded]);
        assert_eq!(outcomes[0].status, Some(201));

        let sent = &hub.uploads()[0];
        assert!(sent.headers.contains("authorization: bearer a-token"));
        assert!(sent.headers.contains("content-type: multipart/form-data"));
        assert_eq!(sent.file, bytes);
        assert_eq!(sent.file_type, "image/webp");
        // The route asks for a `Blob`, and a part with no filename arrives as a
        // string, so the file part has to be named. The name is the file's own,
        // which is its content hash and says nothing about this machine.
        assert_eq!(sent.file_name, "armsolar.webp");
        assert_eq!(sent.declaration["unit_name"], "armsolar");
    }

    /// The declared length is the file's own, so the hub's check that the two agree
    /// cannot fail over something a caller got wrong.
    #[tokio::test]
    async fn the_declared_length_is_the_length_that_arrives() {
        let dir = asset_dir("length");
        let path = file(&dir, "a.webp", 1234);
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();

        upload(&hub, &[unit(path, "armsolar", "src-a")], &samples, &open())
            .await
            .unwrap();

        let sent = &hub.uploads()[0];
        assert_eq!(sent.declaration["bytes"], 1234);
        assert_eq!(sent.file.len(), 1234);
    }

    /// The gate the whole design rests on. An asset the hub already holds is one
    /// key in a have batch and no upload at all, and the count is what says so.
    #[tokio::test]
    async fn the_have_check_runs_first_and_stops_an_asset_the_hub_holds() {
        let dir = asset_dir("gate");
        let held = unit(file(&dir, "a.webp", 9), "armsolar", "src-a");
        let hub = HubServer::holding(&[(held.identity.clone(), "src-a")]);
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[held, unit(file(&dir, "b.webp", 9), "armcom", "src-b")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(
            results(&outcomes),
            vec![Outcome::AlreadyHad, Outcome::Uploaded]
        );
        assert_eq!(hub.have_requests(), 1);
        assert_eq!(hub.uploads().len(), 1);
        assert_eq!(hub.uploads()[0].declaration["unit_name"], "armcom");
    }

    /// A whole batch the hub already has costs one request. This is what the have
    /// check is for: the transfer is the cheap part and the allowance is shared.
    #[tokio::test]
    async fn a_batch_the_hub_already_has_uploads_nothing() {
        let dir = asset_dir("allheld");
        let assets: Vec<AssetUpload> = (0..8)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();
        let rows: Vec<(AssetIdentity, &str)> = assets
            .iter()
            .map(|a| (a.identity.clone(), "src-a"))
            .collect();
        let hub = HubServer::holding(&rows);
        let samples = Samples::default();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert!(outcomes.iter().all(|o| o.result == Outcome::AlreadyHad));
        assert_eq!(hub.have_requests(), 1);
        assert_eq!(hub.uploads().len(), 0);
    }

    /// A source that moved reads as `changed`, and a changed row is replaced in
    /// place, which the hub answers 200 to rather than 201.
    #[tokio::test]
    async fn a_changed_source_hash_replaces_the_row() {
        let dir = asset_dir("changed");
        let asset = unit(file(&dir, "a.webp", 9), "armsolar", "src-new");
        let hub = HubServer::holding(&[(asset.identity.clone(), "src-old")]);
        let samples = Samples::default();

        // Twice: the first takes the identity, so the second is a replacement,
        // which is the hub's own 200.
        upload(&hub, std::slice::from_ref(&asset), &samples, &open())
            .await
            .unwrap();
        let outcomes = upload(&hub, &[asset], &samples, &open()).await.unwrap();

        assert_eq!(results(&outcomes), vec![Outcome::Replaced]);
        assert_eq!(outcomes[0].status, Some(200));
    }

    /// Nothing is sent and nothing is asked about when the only asset in the set
    /// could never be stored. Zero requests, not one.
    #[tokio::test]
    async fn an_oversized_asset_reaches_no_route_at_all() {
        let dir = asset_dir("oversend");
        let path = file(&dir, "huge.png", (MAX_ASSET_BYTES + 1) as usize);
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();

        let mut asset = overlay(path, "overlay:height");
        asset.map_width = Some(16384);
        let outcomes = upload(&hub, &[asset], &samples, &open()).await.unwrap();

        assert_eq!(results(&outcomes), vec![Outcome::Refused]);
        assert!(outcomes[0]
            .said
            .as_ref()
            .unwrap()
            .contains("coilbox-hub#162"));
        assert_eq!(hub.have_requests(), 0);
        assert_eq!(hub.uploads().len(), 0);
    }

    /// One picture the hub can never store does not end a backfill. It is left out
    /// of the have batch, and everything else goes as it would have.
    #[tokio::test]
    async fn one_refused_asset_does_not_stop_the_rest() {
        let dir = asset_dir("carryon");
        let huge = {
            let mut a = overlay(
                file(&dir, "huge.png", (MAX_ASSET_BYTES + 1) as usize),
                "overlay:height",
            );
            a.map_width = Some(16384);
            a
        };
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[
                unit(file(&dir, "a.webp", 9), "armsolar", "src-a"),
                huge,
                unit(file(&dir, "b.webp", 9), "armcom", "src-b"),
            ],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(
            results(&outcomes),
            vec![Outcome::Uploaded, Outcome::Refused, Outcome::Uploaded]
        );
        assert_eq!(hub.uploads().len(), 2);
    }

    /// The hub's own status and words survive a refusal, and the sentence names
    /// the picture it is about. A backfill's outcomes are positional and a
    /// notification is not.
    #[tokio::test]
    async fn a_refusal_comes_back_in_the_hubs_own_words() {
        let dir = asset_dir("refusal");
        let hub = HubServer::refusing(
            400,
            serde_json::json!({ "error": "A \"buildpic\" must be square, and that one is 256x128." }),
        );
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(results(&outcomes), vec![Outcome::Refused]);
        assert_eq!(outcomes[0].status, Some(400));
        let said = outcomes[0].said.as_ref().unwrap();
        assert!(said.contains("must be square"), "{said}");
        assert!(said.contains("bar's armsolar buildpic"), "{said}");
    }

    // ------------------------------------------------------------- verdicts

    /// The statuses, against what the hub actually answers rather than what a
    /// status code means in general. Each of these was produced by running the
    /// hub's own `checkAssetImage` and reading its upload route.
    #[test]
    fn the_verdict_is_read_off_the_status_the_hub_answers() {
        // Bytes that are not the class they were labelled with, which is coilbox's
        // bug and the whole of issue #1634. 400 is not square, not lossless, the
        // wrong bit depth, not grayscale, or no header the hub can measure. 413 is
        // too many pixels or too many bytes. 415 is the wrong type either way
        // round. 403 is a game the hub may not redistribute and 409 is an identity
        // that is not this account's to write.
        for status in [400, 403, 409, 413, 415] {
            assert_eq!(verdict_for(status), Verdict::Terminal, "{status}");
        }
        // The account and the allowance. Neither is about a picture and neither
        // moves inside one run.
        for status in [401, 429] {
            assert_eq!(verdict_for(status), Verdict::Blocked, "{status}");
        }
        // The asset store, a quota that could not be read, a row that could not be
        // written, a hub that is not configured.
        for status in [500, 502, 503] {
            assert_eq!(verdict_for(status), Verdict::Transient, "{status}");
        }
    }

    /// The point of the issue. A dimension refusal is coilbox having made the
    /// wrong picture, so the same bytes get the same answer for ever and one
    /// request is all it costs.
    #[tokio::test]
    async fn a_dimension_refusal_costs_exactly_one_request() {
        let dir = asset_dir("terminalonce");
        let hub = HubServer::refusing(
            400,
            serde_json::json!({ "error": "A \"buildpic\" must be square, and that one is 256x128." }),
        );
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(hub.uploads().len(), 1);
        assert_eq!(outcomes[0].verdict, Some(Verdict::Terminal));
    }

    /// And a type refusal, which is the other half of the pair the issue names.
    /// 415 is what the hub answers when the declared type is not the class's, or
    /// when the bytes turn out not to be the declared type.
    #[tokio::test]
    async fn a_type_refusal_costs_exactly_one_request() {
        let dir = asset_dir("mimeonce");
        let hub = HubServer::refusing(
            415,
            serde_json::json!({ "error": "The declaration says image/webp and the bytes are image/png." }),
        );
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(hub.uploads().len(), 1);
        assert_eq!(outcomes[0].verdict, Some(Verdict::Terminal));
    }

    /// A picture refused before any request is terminal too, and joins the same
    /// taxonomy rather than being a second concept. There is nothing a retry does
    /// about a file that is too big for the platform to carry.
    #[tokio::test]
    async fn a_picture_refused_before_any_request_is_terminal() {
        let dir = asset_dir("localterminal");
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();

        let mut asset = overlay(
            file(&dir, "huge.png", (MAX_ASSET_BYTES + 1) as usize),
            "overlay:height",
        );
        asset.map_width = Some(16384);
        let outcomes = upload(&hub, &[asset], &samples, &open()).await.unwrap();

        assert_eq!(outcomes[0].verdict, Some(Verdict::Terminal));
        assert_eq!(hub.uploads().len(), 0);
    }

    // -------------------------------------------------------------- retrying

    /// A hub that could not answer is asked again, and then left alone. Both
    /// bounds in one assertion: three attempts on the picture, and a run that ends
    /// rather than spending three more on the next one.
    #[tokio::test]
    async fn a_hub_that_will_not_answer_is_asked_again_and_then_left_alone() {
        let dir = asset_dir("transient");
        let hub = HubServer::refusing(
            503,
            serde_json::json!({ "error": "The upload quotas could not be read just now. Try again shortly." }),
        );
        let samples = Samples::default();
        let assets: Vec<AssetUpload> = (0..4)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert_eq!(hub.uploads().len(), UPLOAD_ATTEMPTS as usize);
        assert_eq!(outcomes[0].verdict, Some(Verdict::Transient));
        assert!(outcomes[1..]
            .iter()
            .all(|o| o.result == Outcome::NotAttempted));
    }

    /// The reason retrying is worth doing at all. A hub that fails once and then
    /// answers gets the picture, on the second request rather than the first.
    #[tokio::test]
    async fn a_retry_lands_when_the_hub_recovers() {
        let dir = asset_dir("recovers");
        let hub = HubServer::answering_in_turn(&[
            (
                503,
                serde_json::json!({ "error": "The upload quotas could not be read just now. Try again shortly." }),
            ),
            (
                201,
                serde_json::json!({ "format": UPLOAD_FORMAT, "version": 1, "moderation": "pending" }),
            ),
        ]);
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert_eq!(hub.uploads().len(), 2);
        assert_eq!(results(&outcomes), vec![Outcome::Uploaded]);
        assert_eq!(outcomes[0].verdict, None);
    }

    // ------------------------------------------------------ the same answer

    /// A backfill is one roster made by one encoder, so an encoder that is wrong
    /// is wrong about all three hundred pictures. The run stops once the hub has
    /// said the same thing five times running, rather than paying for the rest of
    /// an answer it already has.
    #[tokio::test]
    async fn the_same_refusal_five_times_running_ends_the_run() {
        let dir = asset_dir("samerefusal");
        let hub = HubServer::refusing(
            400,
            serde_json::json!({ "error": "A \"buildpic\" must be square, and that one is 256x128." }),
        );
        let samples = Samples::default();
        let assets: Vec<AssetUpload> = (0..20)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert_eq!(hub.uploads().len(), SAME_REFUSAL_LIMIT);
        assert!(outcomes[..SAME_REFUSAL_LIMIT]
            .iter()
            .all(|o| o.result == Outcome::Refused));
        assert!(outcomes[SAME_REFUSAL_LIMIT..]
            .iter()
            .all(|o| o.result == Outcome::NotAttempted));
    }

    /// And the other side of it. One odd picture here and there is what a backfill
    /// looks like when nothing is systematically wrong, so a run of refusals that
    /// are not the same refusal carries on to the end.
    #[tokio::test]
    async fn refusals_that_are_not_the_same_refusal_do_not_end_the_run() {
        let dir = asset_dir("mixedrefusal");
        let hub = HubServer::answering_in_turn(&[
            (400, serde_json::json!({ "error": "not square" })),
            (413, serde_json::json!({ "error": "too many pixels" })),
            (415, serde_json::json!({ "error": "not that type" })),
        ]);
        let samples = Samples::default();
        let assets: Vec<AssetUpload> = (0..9)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert_eq!(hub.uploads().len(), 9);
        assert!(outcomes.iter().all(|o| o.result == Outcome::Refused));
    }

    /// A picture the hub takes clears the count, so five refusals spread across a
    /// batch that is otherwise working never adds up to a stop.
    #[tokio::test]
    async fn a_picture_the_hub_takes_clears_the_count() {
        let dir = asset_dir("cleared");
        let hub = HubServer::answering_in_turn(&[
            (400, serde_json::json!({ "error": "not square" })),
            (
                201,
                serde_json::json!({ "format": UPLOAD_FORMAT, "version": 1, "moderation": "pending" }),
            ),
        ]);
        let samples = Samples::default();
        let assets: Vec<AssetUpload> = (0..12)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert_eq!(hub.uploads().len(), 12);
        assert!(outcomes.iter().all(|o| o.result != Outcome::NotAttempted));
    }

    /// A rate limit is worth trying again, and not in this run. The hub's cap is a
    /// count of rows written in the last hour, so a second request half a second
    /// later asks a question whose answer cannot have moved. One request, then the
    /// run ends.
    #[tokio::test]
    async fn a_rate_limit_ends_the_run_rather_than_being_asked_again() {
        let dir = asset_dir("ratelimit");
        let hub = HubServer::refusing(
            429,
            serde_json::json!({ "error": "Too many uploads for that subject in the last hour, which is capped at 100. Try again later." }),
        );
        let samples = Samples::default();
        let assets: Vec<AssetUpload> = (0..5)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = upload(&hub, &assets, &samples, &open()).await.unwrap();

        assert_eq!(hub.uploads().len(), 1);
        assert_eq!(outcomes[0].result, Outcome::Refused);
        assert_eq!(outcomes[0].verdict, Some(Verdict::Blocked));
        assert!(outcomes[1..]
            .iter()
            .all(|o| o.result == Outcome::NotAttempted));
    }

    /// A sign-in the hub will not take is the same for every asset too, and it
    /// says to sign in again rather than repeating whatever the hub sent.
    ///
    /// The body is the local hub's own, word for word. It answers 401 to a request
    /// with no header and 401 with "That access token is not valid. Sign in again
    /// and use a fresh one." to one carrying a token it will not take, both before
    /// reading the body as multipart at all.
    #[tokio::test]
    async fn a_refused_sign_in_ends_the_run_and_says_to_sign_in_again() {
        let dir = asset_dir("unauth");
        let hub = HubServer::refusing(
            401,
            serde_json::json!({ "error": "Send an access token as \"Authorization: Bearer <token>\"." }),
        );
        let samples = Samples::default();

        let outcomes = upload(
            &hub,
            &[
                unit(file(&dir, "a.webp", 9), "armsolar", "src-a"),
                unit(file(&dir, "b.webp", 9), "armcom", "src-b"),
            ],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        assert!(outcomes[0].said.as_ref().unwrap().contains("Sign in again"));
        // Not the picture's fault, so it is not filed with the pictures coilbox
        // got wrong, and not worth another request with the same token either.
        assert_eq!(outcomes[0].verdict, Some(Verdict::Blocked));
        assert_eq!(outcomes[1].result, Outcome::NotAttempted);
        assert_eq!(hub.uploads().len(), 1);
    }

    #[tokio::test]
    async fn a_hub_that_speaks_a_newer_upload_is_not_guessed_at() {
        let dir = asset_dir("newer");
        let hub = HubServer::refusing(
            201,
            serde_json::json!({ "format": UPLOAD_FORMAT, "version": 2, "moderation": "pending" }),
        );
        let samples = Samples::default();

        let refused = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap_err();

        assert!(refused.contains("Update coilbox"), "{refused}");
    }

    #[tokio::test]
    async fn something_that_is_not_a_hub_is_not_read_as_an_answer() {
        let dir = asset_dir("nothub");
        let hub = HubServer::refusing(201, serde_json::json!({ "moderation": "pending" }));
        let samples = Samples::default();

        let refused = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap_err();

        assert!(
            refused.contains("did not answer with an upload"),
            "{refused}"
        );
    }

    #[tokio::test]
    async fn an_empty_set_asks_nobody() {
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();
        assert_eq!(
            upload(&hub, &[], &samples, &open()).await.unwrap(),
            Vec::new()
        );
        assert_eq!(hub.have_requests(), 0);
    }

    // --------------------------------------------------------------- progress

    /// A run reports what it is doing as it does it: the have check, then a sample
    /// per asset, then a last one saying it is over.
    #[tokio::test]
    async fn progress_names_the_phase_the_picture_and_how_far_through_it_is() {
        let dir = asset_dir("progress");
        let held = unit(file(&dir, "a.webp", 9), "armsolar", "src-a");
        let hub = HubServer::holding(&[(held.identity.clone(), "src-a")]);
        let samples = Samples::default();

        upload(
            &hub,
            &[held, unit(file(&dir, "b.webp", 40), "armcom", "src-b")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        let taken = samples.taken();
        assert_eq!(taken[0].phase, "asking");
        assert_eq!(taken[0].done, 0);
        assert_eq!(taken[0].total, 2);

        let last = taken.last().unwrap();
        assert_eq!(last.phase, "done");
        assert_eq!((last.done, last.total), (2, 2));
        assert_eq!(last.percent, Some(100.0));
        assert_eq!((last.uploaded, last.already_had, last.refused), (1, 1, 0));
        // Only what actually went over the wire is counted, so a skipped asset does
        // not read as bytes sent.
        assert_eq!(last.uploaded_bytes, 40);

        // The picture in flight is named, so a running line can say what it is on.
        assert!(taken
            .iter()
            .any(|s| s.subject.as_deref() == Some("bar's armcom buildpic")));
        // And the count never runs backwards.
        let done: Vec<usize> = taken.iter().map(|s| s.done).collect();
        assert!(done.windows(2).all(|w| w[1] >= w[0]), "{done:?}");
    }

    #[tokio::test]
    async fn a_refused_asset_is_counted_as_refused_rather_than_uploaded() {
        let dir = asset_dir("progrefused");
        let hub = HubServer::refusing(400, serde_json::json!({ "error": "not square" }));
        let samples = Samples::default();

        upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &open(),
        )
        .await
        .unwrap();

        let last = samples.taken().last().unwrap().clone();
        assert_eq!((last.uploaded, last.refused), (0, 1));
        assert_eq!(last.uploaded_bytes, 0);
    }

    // ----------------------------------------------------------- cancellation

    /// A cancel while a picture is in flight stops that transfer, rather than
    /// waiting for it to finish. The stand-in reads the request and never answers,
    /// so a run that came back at all is one that dropped the request.
    #[tokio::test]
    async fn cancelling_stops_the_upload_in_flight() {
        let dir = asset_dir("cancelflight");
        let hub = HubServer::hanging();
        let samples = Samples::default();
        let cancel = open();

        let flag = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            flag.store(true, Ordering::Relaxed);
        });

        let assets: Vec<AssetUpload> = (0..3)
            .map(|n| {
                unit(
                    file(&dir, &format!("{n}.webp"), 9),
                    &format!("u{n}"),
                    "src-a",
                )
            })
            .collect();

        let outcomes = tokio::time::timeout(
            Duration::from_secs(5),
            upload(&hub, &assets, &samples, &cancel),
        )
        .await
        .expect("a cancelled run has to come back, not wait out the request")
        .unwrap();

        // The first is in flight when the cancel lands and the other two never
        // start, so the hub saw exactly one upload.
        assert_eq!(hub.uploads().len(), 1);
        assert!(outcomes.iter().all(|o| o.result == Outcome::NotAttempted));
        assert_eq!(samples.taken().last().unwrap().phase, "done");
    }

    /// A cancel between assets stops the rest without touching the one that
    /// already went.
    #[tokio::test]
    async fn cancelling_before_a_run_starts_sends_nothing() {
        let dir = asset_dir("cancelearly");
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();
        let cancel = Arc::new(AtomicBool::new(true));

        let outcomes = upload(
            &hub,
            &[unit(file(&dir, "a.webp", 9), "armsolar", "src-a")],
            &samples,
            &cancel,
        )
        .await
        .unwrap();

        assert_eq!(results(&outcomes), vec![Outcome::NotAttempted]);
        assert_eq!(hub.have_requests(), 0);
        assert_eq!(hub.uploads().len(), 0);
    }

    // ---------------------------------------------------- against the hub's own

    /// The request this client emits, captured off the wire and written where the
    /// hub's own code can be replayed against it. This is how the two fixtures
    /// below were produced, and re-running it is how they are refreshed.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub capture_the_wire -- --ignored --nocapture
    /// bun run <the hub's parser> over /tmp/coilbox-upload-body.bin
    /// ```
    #[tokio::test]
    #[ignore = "writes a capture for the hub's own parser to be run against by hand"]
    async fn capture_the_wire_for_the_hubs_own_parser() {
        let dir = asset_dir("capture");
        let path = dir.join("armsolar.webp");
        std::fs::write(&path, b"RIFF....WEBPVP8L pretend").unwrap();
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();
        upload(&hub, &[unit(path, "armsolar", "src-a")], &samples, &open())
            .await
            .unwrap();

        let sent = &hub.uploads()[0];
        std::fs::write("/tmp/coilbox-upload-body.bin", &sent.raw).unwrap();
        std::fs::write("/tmp/coilbox-upload-content-type.txt", &sent.content_type).unwrap();
        println!("declaration: {}", sent.declaration_json);
        println!("content-type: {}", sent.content_type);

        // And the other key shape, over a real 1x1 16 bit grayscale PNG, so the
        // hub's dimension read has something it can actually measure rather than
        // the placeholder above.
        let png: &[u8] = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x10\x00\x00\x00\x00\x6a\xee\x47\x16\x00\x00\x00\x0b\x49\x44\x41\x54\x78\x9c\x63\x10\x32\x01\x00\x00\x5b\x00\x47\x96\xfb\x1b\x65\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82";
        let height_path = dir.join("height.png");
        std::fs::write(&height_path, png).unwrap();
        let map_hub = HubServer::holding(&[]);
        let mut asset = overlay(height_path, "overlay:height");
        asset.map_width = Some(8);
        asset.map_height = Some(8);
        upload(&map_hub, &[asset], &samples, &open()).await.unwrap();
        let sent = &map_hub.uploads()[0];
        std::fs::write("/tmp/coilbox-upload-map-body.bin", &sent.raw).unwrap();
        std::fs::write(
            "/tmp/coilbox-upload-map-content-type.txt",
            &sent.content_type,
        )
        .unwrap();
        println!("map declaration: {}", sent.declaration_json);
    }

    /// The unit declaration byte for byte, as the capture above produced it, and as
    /// the hub's own `parseAssetUpload` was run against it. Written out here rather
    /// than rebuilt from the struct, so this is the string the hub read and not a
    /// second rendering of the same intention.
    ///
    /// `request.formData()` on the whole captured body answered `file` as a `Blob`
    /// of 24 bytes named `armsolar.webp` typed `image/webp`, and `asset` as a
    /// string, which are the two things the route requires. `parseAssetUpload`
    /// answered:
    ///
    /// ```json
    /// {"ok":true,"declaration":{"identity":{"keyedOn":"unit","game":"bar","unitName":"armsolar","variant":"buildpic"},"sourceHash":"src-a","encodeProfile":"webp-lossless-256","origin":"extracted","mime":"image/webp","bytes":24,"sourceArchive":"Beyond All Reason test-1.sdd","mapWidth":null,"mapHeight":null,"worldHeightMin":null,"worldHeightMax":null}}
    /// ```
    const CAPTURED_DECLARATION: &str = r#"{"keyed_on":"unit","game":"bar","unit_name":"armsolar","variant":"buildpic","source_hash":"src-a","encode_profile":"webp-lossless-256","origin":"extracted","mime":"image/webp","source_archive":"Beyond All Reason test-1.sdd","bytes":24}"#;

    /// The map shape, over a real 1x1 16 bit grayscale PNG. `parseAssetUpload`
    /// answered:
    ///
    /// ```json
    /// {"ok":true,"declaration":{"identity":{"keyedOn":"map","mapName":"Mediterraneum_V1","variant":"overlay:height"},"sourceHash":"src-map","encodeProfile":"png16-lossless-source","origin":"extracted","mime":"image/png","bytes":68,"sourceArchive":"mediterraneum_v1.sd7","mapWidth":8,"mapHeight":8,"worldHeightMin":-120.5,"worldHeightMax":880}}
    /// ```
    ///
    /// and `checkAssetImage`, which is the dimension read of coilbox-hub#105,
    /// answered `{"ok":true,"width":1,"height":1}` off the header alone.
    const CAPTURED_MAP_DECLARATION: &str = r#"{"keyed_on":"map","map_name":"Mediterraneum_V1","variant":"overlay:height","source_hash":"src-map","encode_profile":"png16-lossless-source","origin":"extracted","mime":"image/png","source_archive":"mediterraneum_v1.sd7","map_width":8,"map_height":8,"world_height_min":-120.5,"world_height_max":880.0,"bytes":68}"#;

    #[tokio::test]
    async fn the_asset_part_is_the_json_the_hubs_parser_was_run_against() {
        let dir = asset_dir("captured");
        let path = dir.join("armsolar.webp");
        std::fs::write(&path, b"RIFF....WEBPVP8L pretend").unwrap();
        let hub = HubServer::holding(&[]);
        let samples = Samples::default();
        upload(&hub, &[unit(path, "armsolar", "src-a")], &samples, &open())
            .await
            .unwrap();
        assert_eq!(hub.uploads()[0].declaration_json, CAPTURED_DECLARATION);

        let height = dir.join("height.png");
        std::fs::write(&height, vec![0u8; 68]).unwrap();
        let map_hub = HubServer::holding(&[]);
        let mut asset = overlay(height, "overlay:height");
        asset.map_width = Some(8);
        asset.map_height = Some(8);
        upload(&map_hub, &[asset], &samples, &open()).await.unwrap();
        assert_eq!(
            map_hub.uploads()[0].declaration_json,
            CAPTURED_MAP_DECLARATION
        );
    }

    /// The answer as the hub actually builds it, copied out of
    /// `buildAssetUploadBody`. The stand-in above imitates the same shape, so this
    /// is what stops the two imitating each other.
    #[test]
    fn the_hubs_own_answer_parses() {
        let answered: UploadBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-asset-upload","version":1,"moderation":"pending"}"#,
        )
        .unwrap();
        assert_eq!(answered.format, UPLOAD_FORMAT);
        assert_eq!(answered.version, UPLOAD_VERSION);
    }

    // ------------------------------------------------------------------- live

    /// What a hub says to an upload with no token. Needs a hub running at the
    /// address below and no account, and uploads nothing: the bearer is checked
    /// before the body is even read as multipart.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_upload_needs_a_token -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches a running hub, so it cannot run in CI"]
    async fn live_upload_needs_a_token() {
        let url = api_url("http://localhost:3000", UPLOAD_PATH, "Sending").unwrap();
        let form = reqwest::multipart::Form::new().text("asset", "{}").part(
            "file",
            reqwest::multipart::Part::bytes(b"not a picture".to_vec())
                .file_name("a.webp")
                .mime_str("image/webp")
                .unwrap(),
        );
        let response = reqwest::Client::new()
            .post(&url)
            .multipart(form)
            .send()
            .await
            .expect("the hub could not be reached");
        let status = response.status().as_u16();
        println!("{status}: {}", response.text().await.unwrap_or_default());
        assert_eq!(status, 401);
    }
}
