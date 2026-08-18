//! Sending a map's facts to the hub (issue #1736).
//!
//! Two routes, and they are the twins of [`crate::have`] and [`crate::upload`]:
//! `POST <hub>/api/v1/maps/have` asks which maps the hub still wants, and
//! `POST <hub>/api/v1/maps` sends them. Both carry a bearer token through
//! [`crate::auth`], so the request is made here rather than in the webview.
//!
//! ## What the have check is for
//!
//! A library of three thousand maps is almost entirely maps the hub already
//! knows. Asking first turns three thousand writes into six reads.
//!
//! Three statuses, and `changed` covers two cases that both mean send it: the
//! hub holds a different archive under that name, or it holds an older
//! `catalog_version`. Which of the two it was is the hub's to decide, and the
//! client does the same thing either way.
//!
//! ## Where this parts company with the asset upload
//!
//! An asset upload carries bytes, so it is multipart and one asset per request.
//! Facts are small, so a whole batch goes as one JSON body and the answer is per
//! map inside a 200. One map coming back `conflict` does not mean the other forty
//! nine failed, and a caller has to read every result rather than the status
//! code.
//!
//! The batch is capped twice, on maps and on bytes, because fifty entries are
//! small until one of them carries a description and six hundred metal spots.
//! Both numbers come from `shared/map-catalog.json` rather than from constants
//! here, so the number this splits on and the number the hub refuses at cannot
//! drift apart.
//!
//! ## Consent
//!
//! Both sit behind the same `hub.assetUploads` gate the pictures use rather than
//! a second setting. Somebody who agreed to send what coilbox extracted from
//! their archives agreed to this, and two switches for one decision is worse than
//! one.

use std::collections::HashSet;
use std::time::Duration;

use coilbox_map_catalog::{caps, MapCatalogEntry};
use coilbox_oauth::HTTP_TIMEOUT;
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::consent::AssetUploadConsent;
use crate::endpoint::{api_url, host_of, read_capped};
use crate::upload::{verdict_for, Verdict, RETRY_BACKOFF, UPLOAD_ATTEMPTS};

/// The route that answers what the hub already holds.
const HAVE_PATH: &str = "/api/v1/maps/have";
/// The route that takes a batch of entries.
const SUBMIT_PATH: &str = "/api/v1/maps";

/// The envelopes, so a build that has been on disk for months can say the
/// service is newer than it understands rather than reading a shape that changed
/// under it. Both pairs are the hub's own, in `lib/api/mapHave.ts` and
/// `lib/api/mapSubmit.ts`.
const HAVE_FORMAT: &str = "coilbox-hub-map-have";
const HAVE_VERSION: u32 = 1;
const SUBMIT_FORMAT: &str = "coilbox-hub-maps";
const SUBMIT_VERSION: u32 = 1;

/// Longest one request may take end to end, matching the other hub routes for
/// the same reason: a hub asleep on a free tier is woken by the first request,
/// which is slow rather than broken.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Bound the initial connect on its own, so a dead host fails before any of the
/// above is spent waiting.
const CONNECT_TIMEOUT: Duration = HTTP_TIMEOUT;

/// Largest answer that will be read.
///
/// A have check answers 500 keys, each echoing a map name of at most 256
/// characters with a status, so a full batch is well under 200 KB. A submission
/// answers 50, and a refusal carries the hub's own sentence. A megabyte leaves
/// room for both and is still far under anything that could be a corpus rather
/// than an answer.
const ANSWER_LIMIT: usize = 1024 * 1024;

/// What the body costs before any map is in it: the envelope, the array, and the
/// commas between entries. Subtracted from the hub's byte cap so a batch built to
/// the cap is a batch the hub accepts rather than one it answers 413 to.
const ENVELOPE_ALLOWANCE: usize = 1024;

/// One key: which map, which archive it came from, and which extraction read it.
///
/// All three are required. `catalog_version` is what lets the hub tell a better
/// read of the same bytes from the same read, and a key without one cannot be
/// answered at all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapHaveKey {
    pub map_name: String,
    pub source_hash: String,
    pub catalog_version: u32,
}

impl MapHaveKey {
    /// The key for an entry, so the two calls cannot disagree about what was
    /// asked and what is then sent.
    pub fn of(entry: &MapCatalogEntry) -> Self {
        Self {
            map_name: entry.map_name.clone(),
            source_hash: entry.source_hash.clone(),
            catalog_version: entry.catalog_version,
        }
    }
}

/// What the hub wants done with one key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapHaveStatus {
    /// The hub holds these facts, from this archive, read by this extraction or a
    /// later one. Send nothing.
    Have,
    /// The hub holds something older or different. Send it.
    Changed,
    /// The hub holds nothing under that name. Send it.
    Missing,
}

impl MapHaveStatus {
    /// Whether this map is worth sending. The whole point of asking first is that
    /// most of a real library answers `false` here.
    pub fn wants_submission(self) -> bool {
        !matches!(self, Self::Have)
    }
}

/// One answer, carrying the name it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapHaveResult {
    pub map_name: String,
    pub status: MapHaveStatus,
}

#[derive(Debug, Deserialize)]
struct MapHaveBody {
    format: String,
    version: u32,
    results: Vec<MapHaveResult>,
}

/// What the hub did with one map.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapSubmitOutcome {
    /// The hub held nothing under that name and now holds these facts.
    Stored,
    /// The same archive, read by a newer extraction. The row took the new facts.
    Replaced,
    /// The hub already holds these facts, or better ones.
    Unchanged,
    /// The submission disagrees with what the hub holds about an archive that
    /// cannot have two answers. Nothing was written.
    Conflict,
    /// The entry is malformed, and `said` carries why.
    Refused,
}

impl MapSubmitOutcome {
    /// Whether this is worth telling anybody about. The other three are the hub
    /// deciding about facts it already holds, which a person can do nothing with.
    pub fn is_worth_reporting(self) -> bool {
        matches!(self, Self::Conflict | Self::Refused)
    }
}

/// The answer for one map, in request order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapSubmitResult {
    pub map_name: String,
    pub outcome: MapSubmitOutcome,
    /// Why, on a refusal, and absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub said: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MapSubmitBody {
    format: String,
    version: u32,
    results: Vec<MapSubmitResult>,
}

/// Ask the hub which of these maps it still wants, as the signed-in account.
///
/// Answers in the order the keys were given, however many requests it took, so a
/// caller can zip the two by index.
///
/// An empty set is answered without asking anybody, which matters because the
/// callers of this are loops and the hub refuses an empty batch.
///
/// `_consent` is the user's agreement to send what coilbox read off their
/// machine, and is the reason this takes an argument it never reads. It is asked
/// for here rather than only at the submission because this is the first call the
/// path makes, the same way [`crate::have::have`] is for pictures.
pub async fn have_maps(
    hub_url: &str,
    keys: &[MapHaveKey],
    _consent: &AssetUploadConsent,
) -> Result<Vec<MapHaveResult>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let url = api_url(hub_url, HAVE_PATH, "Asking the hub what it has")?;
    check_keys(keys)?;

    // After the keys are known to be askable, so a set that could never be
    // answered does not spend a token refresh first.
    let token = auth::access_token(hub_url)
        .await
        .map_err(|e| auth::explain(&e, hub_url))?;

    have_in_batches(&url, &token, keys).await
}

/// Split the keys into requests the hub will accept and join the answers back
/// up.
///
/// One client for all of them, so a library of three thousand maps reuses the
/// connection rather than paying a fresh TLS handshake six times.
async fn have_in_batches(
    url: &str,
    token: &str,
    keys: &[MapHaveKey],
) -> Result<Vec<MapHaveResult>, String> {
    let client = client()?;
    let mut answers = Vec::with_capacity(keys.len());
    for batch in keys.chunks(caps().have_keys) {
        answers.extend(ask(&client, url, token, batch).await?);
    }
    Ok(answers)
}

/// Everything about a set of keys that can be known without asking.
///
/// One name twice is the case worth catching here rather than at the hub. The
/// hub refuses a repeat within a batch, and a set larger than the cap can put the
/// two copies in different requests, where nothing catches them and the caller
/// gets two answers for one map at indexes it reads as two maps.
fn check_keys(keys: &[MapHaveKey]) -> Result<(), String> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(keys.len());
    for (index, key) in keys.iter().enumerate() {
        let at = format!("key {index}");
        if key.map_name.trim().is_empty() {
            return Err(format!("{at} has no map name."));
        }
        if key.source_hash.trim().is_empty() {
            return Err(format!(
                "{at} has no source_hash. The have check compares on it, so a key without one cannot be answered."
            ));
        }
        if key.catalog_version < 1 {
            return Err(format!(
                "{at} has no catalog_version. It says which extraction read the archive, and the hub cannot tell an improvement from a repeat without it."
            ));
        }
        if !seen.insert(key.map_name.as_str()) {
            return Err(format!(
                "{at} asks about \"{}\", which is already in the set.",
                key.map_name
            ));
        }
    }
    Ok(())
}

/// One have request, and what it answered.
async fn ask(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    batch: &[MapHaveKey],
) -> Result<Vec<MapHaveResult>, String> {
    let body = serde_json::json!({ "keys": batch }).to_string();
    let read = send_with_retries(client, url, token, &body).await?;
    if read.status != 200 {
        return Err(refusal(read.status, &read.bytes, url));
    }

    let answered: MapHaveBody = serde_json::from_slice(&read.bytes).map_err(|_| {
        format!(
            "The hub at {} did not answer with a have check.",
            host_of(url)
        )
    })?;
    check_envelope(
        &answered.format,
        answered.version,
        HAVE_FORMAT,
        HAVE_VERSION,
        url,
    )?;
    check_order(
        batch.iter().map(|key| key.map_name.as_str()),
        answered.results.iter().map(|r| r.map_name.as_str()),
        url,
    )?;
    Ok(answered.results)
}

/// Send these maps' facts to the hub, as the signed-in account.
///
/// One result per entry in the order they were given, so a caller can zip by
/// index. An outcome is per map inside a 200: one map the hub will not take says
/// nothing about the rest of the batch, and the status code is not the answer.
///
/// An entry too large to travel even on its own is refused here rather than sent,
/// because the hub would answer 413 for the whole batch it was in and the other
/// forty nine maps would pay for it.
///
/// A batch the hub refuses whole is an error rather than fifty refusals, since
/// nothing in the answer is about any particular map. Earlier batches in the same
/// call have already landed, and their results are lost with the error, which is
/// the cost of not inventing a shape for a partial failure the caller has no
/// decision to make about.
pub async fn publish_maps(
    hub_url: &str,
    entries: &[MapCatalogEntry],
    _consent: &AssetUploadConsent,
) -> Result<Vec<MapSubmitResult>, String> {
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let url = api_url(hub_url, SUBMIT_PATH, "Sending a map's facts")?;
    check_entries(entries)?;

    // After the entries are known to be sendable, for the reason [`have_maps`]
    // gives.
    let token = auth::access_token(hub_url)
        .await
        .map_err(|e| auth::explain(&e, hub_url))?;

    publish_in_batches(&url, &token, entries).await
}

/// Build the batches and send them, writing each answer back where its entry
/// was.
///
/// Two caps, and both are the hub's own. A batch fills up on maps or on bytes,
/// whichever comes first, because fifty entries are small until one carries a
/// description and six hundred metal spots.
async fn publish_in_batches(
    url: &str,
    token: &str,
    entries: &[MapCatalogEntry],
) -> Result<Vec<MapSubmitResult>, String> {
    let client = client()?;
    let mut results: Vec<Option<MapSubmitResult>> = vec![None; entries.len()];
    let mut batch: Vec<(usize, &MapCatalogEntry)> = Vec::new();
    let mut batch_bytes = 0usize;

    for (index, entry) in entries.iter().enumerate() {
        let size = match measure(entry) {
            Ok(size) => size,
            Err(said) => {
                results[index] = Some(refused_locally(entry, said));
                continue;
            }
        };
        let full = batch.len() >= caps().submit_maps
            || (!batch.is_empty() && batch_bytes + size > body_budget());
        if full {
            send_batch(&client, url, token, &batch, &mut results).await?;
            batch.clear();
            batch_bytes = 0;
        }
        batch.push((index, entry));
        batch_bytes += size;
    }
    if !batch.is_empty() {
        send_batch(&client, url, token, &batch, &mut results).await?;
    }

    // Every index was either sent and answered, or refused before it was sent.
    Ok(results
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.unwrap_or_else(|| MapSubmitResult {
                map_name: entries[index].map_name.clone(),
                outcome: MapSubmitOutcome::Refused,
                said: Some("The hub gave no answer for this map.".into()),
            })
        })
        .collect())
}

/// What a batch may carry, which is the hub's cap less what the envelope around
/// the entries costs.
fn body_budget() -> usize {
    caps().submit_bytes.saturating_sub(ENVELOPE_ALLOWANCE)
}

/// How many bytes an entry adds to a body, or why it can never be sent.
fn measure(entry: &MapCatalogEntry) -> Result<usize, String> {
    let size = serde_json::to_string(entry)
        .map_err(|e| format!("This map's facts could not be written out: {e}"))?
        .len();
    if size > body_budget() {
        return Err(format!(
            "This map's facts are {size} bytes and the hub takes at most {} in one request, so they cannot be sent even on their own.",
            caps().submit_bytes
        ));
    }
    Ok(size)
}

fn refused_locally(entry: &MapCatalogEntry, said: String) -> MapSubmitResult {
    MapSubmitResult {
        map_name: entry.map_name.clone(),
        outcome: MapSubmitOutcome::Refused,
        said: Some(said),
    }
}

/// Everything about a set of entries that can be known without asking.
///
/// One name twice, for the reason [`check_keys`] gives, and with the same
/// consequence one step later: the hub refuses a batch naming one map twice, so a
/// set split across requests would have the copies land in different ones and
/// write over each other.
fn check_entries(entries: &[MapCatalogEntry]) -> Result<(), String> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        if entry.map_name.trim().is_empty() {
            return Err(format!("map {index} has no name."));
        }
        if !seen.insert(entry.map_name.as_str()) {
            return Err(format!(
                "map {index} is \"{}\", which is already in the set.",
                entry.map_name
            ));
        }
    }
    Ok(())
}

/// One submission request, writing its answers back into the caller's slots.
async fn send_batch(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    batch: &[(usize, &MapCatalogEntry)],
    into: &mut [Option<MapSubmitResult>],
) -> Result<(), String> {
    let maps: Vec<&MapCatalogEntry> = batch.iter().map(|(_, entry)| *entry).collect();
    let body = serde_json::json!({
        "format": SUBMIT_FORMAT,
        "version": SUBMIT_VERSION,
        "maps": maps,
    })
    .to_string();

    let read = send_with_retries(client, url, token, &body).await?;
    if read.status != 200 {
        return Err(refusal(read.status, &read.bytes, url));
    }

    let answered: MapSubmitBody = serde_json::from_slice(&read.bytes).map_err(|_| {
        format!(
            "The hub at {} did not answer with a map submission.",
            host_of(url)
        )
    })?;
    check_envelope(
        &answered.format,
        answered.version,
        SUBMIT_FORMAT,
        SUBMIT_VERSION,
        url,
    )?;
    check_order(
        batch.iter().map(|(_, entry)| entry.map_name.as_str()),
        answered.results.iter().map(|r| r.map_name.as_str()),
        url,
    )?;

    for ((index, _), result) in batch.iter().zip(answered.results) {
        into[*index] = Some(result);
    }
    Ok(())
}

/// A hub's answer, once it has one.
struct Read {
    status: u16,
    bytes: Vec<u8>,
}

/// Send a body, trying again while the answer is one another request could
/// change.
///
/// The same taxonomy the picture upload reads off a status
/// ([`crate::upload::Verdict`]) rather than a second copy of it: a 5xx or a
/// request that never arrived is worth another go, a 401 or a 429 is not about
/// this batch and is not, and everything else is the same answer for ever.
///
/// Bounded at [`UPLOAD_ATTEMPTS`], so a hub answering 503 to everything costs
/// three requests per batch rather than three hundred.
async fn send_with_retries(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &str,
) -> Result<Read, String> {
    let mut waiting = RETRY_BACKOFF;
    let mut attempt = 1;
    loop {
        let sent = send(client, url, token, body).await;
        let again = match &sent {
            Ok(read) => verdict_for(read.status) == Verdict::Transient,
            Err(_) => true,
        };
        if !again || attempt >= UPLOAD_ATTEMPTS {
            return sent;
        }
        tokio::time::sleep(waiting).await;
        waiting *= 2;
        attempt += 1;
    }
}

async fn send(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &str,
) -> Result<Read, String> {
    let response = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_owned())
        .send()
        .await
        .map_err(|e| unreachable_message(url, e.is_timeout()))?;
    let status = response.status().as_u16();
    let bytes = read_capped(response, ANSWER_LIMIT).await?;
    Ok(Read { status, bytes })
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Whether the answer is the document this build knows how to read.
fn check_envelope(
    format: &str,
    version: u32,
    wanted_format: &str,
    wanted_version: u32,
    url: &str,
) -> Result<(), String> {
    if format != wanted_format {
        return Err(format!(
            "The hub at {} answered with something other than {wanted_format}.",
            host_of(url)
        ));
    }
    if version > wanted_version {
        return Err(format!(
            "The hub at {} speaks version {version} of {wanted_format} and this version of coilbox understands {wanted_version}. Update coilbox.",
            host_of(url)
        ));
    }
    Ok(())
}

/// Whether the answers line up with what was asked, name for name.
///
/// Both routes answer in request order, which is what makes a result readable by
/// index. A short or reordered batch is refused whole rather than lined up
/// wrongly, because misattributing an answer would report one map's facts as
/// another's and there is no way to tell afterwards.
fn check_order<'a>(
    asked: impl ExactSizeIterator<Item = &'a str>,
    answered: impl ExactSizeIterator<Item = &'a str>,
    url: &str,
) -> Result<(), String> {
    let host = host_of(url);
    if asked.len() != answered.len() {
        return Err(format!(
            "The hub at {host} answered {} of {} maps.",
            answered.len(),
            asked.len()
        ));
    }
    for (index, (asked, answered)) in asked.zip(answered).enumerate() {
        if asked != answered {
            return Err(format!(
                "The hub at {host} answered about \"{answered}\" where \"{asked}\" was asked about, at position {index}."
            ));
        }
    }
    Ok(())
}

/// What the hub said no with. Its own words when it gave any, because it is the
/// side that knows which map it objected to.
fn refusal(status: u16, body: &[u8], url: &str) -> String {
    let said = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.as_str().map(str::to_owned));
    let host = host_of(url);
    match (status, said) {
        (401, _) => {
            format!(
                "The hub at {host} did not accept the sign-in. Sign in again and try once more."
            )
        }
        (_, Some(said)) => format!("The hub at {host} refused the request: {said}"),
        (_, None) => format!("The hub at {host} refused the request, with a {status}."),
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
    use crate::testing::MapHubServer;
    use std::collections::BTreeMap;

    fn key(map_name: &str, source_hash: &str) -> MapHaveKey {
        MapHaveKey {
            map_name: map_name.into(),
            source_hash: source_hash.into(),
            catalog_version: 1,
        }
    }

    /// The smallest entry the hub accepts: every required fact and nothing else.
    fn entry(map_name: &str, source_hash: &str) -> MapCatalogEntry {
        MapCatalogEntry {
            map_name: map_name.into(),
            display_name: None,
            description: None,
            map_version: None,
            author: None,
            archive_filename: None,
            source_archive: map_name.into(),
            source_hash: source_hash.into(),
            catalog_version: 1,
            width_elmos: 8192,
            height_elmos: 8192,
            world_height_min: -50.0,
            world_height_max: 300.0,
            min_wind: None,
            max_wind: None,
            tidal_strength: None,
            void_water: None,
            void_ground: None,
            water_coverage: None,
            appearance: BTreeMap::new(),
            points: Default::default(),
        }
    }

    /// An entry carrying `padding` bytes of description, for the byte cap.
    fn fat_entry(map_name: &str, padding: usize) -> MapCatalogEntry {
        MapCatalogEntry {
            description: Some("x".repeat(padding)),
            ..entry(map_name, "src-a")
        }
    }

    fn have_url(hub: &MapHubServer) -> String {
        api_url(&hub.base(), HAVE_PATH, "Asking").unwrap()
    }

    fn submit_url(hub: &MapHubServer) -> String {
        api_url(&hub.base(), SUBMIT_PATH, "Sending").unwrap()
    }

    // ------------------------------------------------------------------ shape

    /// The body the hub is sent, by the names `parseMapHaveBody` insists on. It
    /// refuses a field name it does not know rather than ignoring it, so a client
    /// sending `sourceHash` would be told the hub is missing its whole corpus.
    #[test]
    fn the_key_shape_is_the_hubs_own() {
        assert_eq!(
            serde_json::to_value(key("Isis 1.3", "src-a")).unwrap(),
            serde_json::json!({
                "map_name": "Isis 1.3",
                "source_hash": "src-a",
                "catalog_version": 1,
            })
        );
    }

    /// And the submission's, which carries its envelope on the request as well as
    /// on the reply. The hub reads `format` and `version` first and refuses a
    /// build whose shape it does not speak.
    #[test]
    fn a_submission_carries_the_envelope_on_the_way_out() {
        let body = serde_json::json!({
            "format": SUBMIT_FORMAT,
            "version": SUBMIT_VERSION,
            "maps": [entry("Isis 1.3", "src-a")],
        });
        assert_eq!(body["format"], "coilbox-hub-maps");
        assert_eq!(body["version"], 1);
        assert_eq!(body["maps"][0]["map_name"], "Isis 1.3");
        assert!(body["maps"][0].get("slug").is_none());
    }

    /// A key for an entry is built from the entry, so the two calls cannot
    /// disagree about which archive was asked about and which was then sent.
    #[test]
    fn a_key_is_taken_from_the_entry_it_will_send() {
        let entry = entry("Isis 1.3", "src-a");
        assert_eq!(MapHaveKey::of(&entry), key("Isis 1.3", "src-a"));
    }

    /// Answers as the hub actually builds them, copied out of `buildMapHaveBody`
    /// and `buildMapSubmitBody` run against the keys this client sends. The
    /// stand-in below imitates the same shapes, so this is what stops the two
    /// imitating each other.
    #[test]
    fn the_hubs_own_answers_parse() {
        let have: MapHaveBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-map-have","version":1,"results":[{"map_name":"Isis 1.3","status":"have"},{"map_name":"Tabula 3","status":"changed"},{"map_name":"Nuclear Winter 1.2","status":"missing"}]}"#,
        )
        .unwrap();
        assert_eq!(have.format, HAVE_FORMAT);
        assert_eq!(have.version, HAVE_VERSION);
        assert_eq!(
            have.results.iter().map(|r| r.status).collect::<Vec<_>>(),
            vec![
                MapHaveStatus::Have,
                MapHaveStatus::Changed,
                MapHaveStatus::Missing
            ]
        );

        let submitted: MapSubmitBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-maps","version":1,"results":[{"map_name":"Isis 1.3","outcome":"stored"},{"map_name":"Tabula 3","outcome":"replaced"},{"map_name":"Comet Catcher Remake 1.8","outcome":"unchanged"},{"map_name":"Nuclear Winter 1.2","outcome":"conflict"},{"map_name":"Broken 1.0","outcome":"refused","said":"`width_elmos` is required and must be a positive integer."}]}"#,
        )
        .unwrap();
        assert_eq!(submitted.format, SUBMIT_FORMAT);
        assert_eq!(
            submitted
                .results
                .iter()
                .map(|r| r.outcome)
                .collect::<Vec<_>>(),
            vec![
                MapSubmitOutcome::Stored,
                MapSubmitOutcome::Replaced,
                MapSubmitOutcome::Unchanged,
                MapSubmitOutcome::Conflict,
                MapSubmitOutcome::Refused,
            ]
        );
        assert!(submitted.results[4]
            .said
            .as_deref()
            .unwrap()
            .contains("width_elmos"));
        assert!(submitted.results[0].said.is_none());
    }

    #[test]
    fn the_routes_are_built_off_the_configured_base() {
        assert_eq!(
            api_url("https://hub.example/", HAVE_PATH, "Asking").unwrap(),
            "https://hub.example/api/v1/maps/have"
        );
        assert_eq!(
            api_url("https://hub.example", SUBMIT_PATH, "Sending").unwrap(),
            "https://hub.example/api/v1/maps"
        );
    }

    #[test]
    fn plain_http_will_not_carry_a_token() {
        assert!(api_url("http://hub.example", HAVE_PATH, "Asking")
            .unwrap_err()
            .contains("https"));
        assert!(api_url("http://hub.example", SUBMIT_PATH, "Sending")
            .unwrap_err()
            .contains("https"));
    }

    // ------------------------------------------------------------------- keys

    #[test]
    fn a_key_with_no_source_hash_cannot_be_compared() {
        let refused = check_keys(&[key("Isis 1.3", "")]).unwrap_err();
        assert!(refused.contains("source_hash"), "{refused}");
    }

    /// Without it the hub cannot tell a better read of the same archive from the
    /// same read, so it refuses the batch rather than guess.
    #[test]
    fn a_key_with_no_catalog_version_cannot_be_answered() {
        let mut key = key("Isis 1.3", "src-a");
        key.catalog_version = 0;
        let refused = check_keys(&[key]).unwrap_err();
        assert!(refused.contains("catalog_version"), "{refused}");
    }

    /// Two copies of one name in a set big enough to be split would land in
    /// different requests, where the hub's own duplicate check cannot see them.
    #[test]
    fn one_map_asked_about_twice_is_refused() {
        let refused =
            check_keys(&[key("Isis 1.3", "src-a"), key("Isis 1.3", "src-b")]).unwrap_err();
        assert!(refused.contains("already in the set"), "{refused}");
        let refused =
            check_entries(&[entry("Isis 1.3", "src-a"), entry("Isis 1.3", "src-b")]).unwrap_err();
        assert!(refused.contains("already in the set"), "{refused}");
    }

    /// The keys are checked before a token is asked for, so a set that could
    /// never be answered does not spend a refresh finding that out.
    #[tokio::test]
    async fn a_set_that_cannot_be_asked_about_fails_before_any_request() {
        let refused = have_maps(
            "https://hub.example",
            &[key("", "src-a")],
            &AssetUploadConsent::for_test(),
        )
        .await
        .unwrap_err();
        assert!(refused.contains("no map name"), "{refused}");
    }

    #[tokio::test]
    async fn an_empty_set_asks_nobody() {
        assert_eq!(
            have_maps("http://hub.example", &[], &AssetUploadConsent::for_test())
                .await
                .unwrap(),
            Vec::new()
        );
        assert_eq!(
            publish_maps("http://hub.example", &[], &AssetUploadConsent::for_test())
                .await
                .unwrap(),
            Vec::new()
        );
    }

    // ------------------------------------------------------------- have check

    /// The comparison the whole route rests on, in the hub's own words: a
    /// different archive is `changed`, a newer extraction of the same archive is
    /// `changed` too, an older one is `have`, and a name the hub has never seen is
    /// `missing`.
    #[tokio::test]
    async fn a_newer_extraction_of_a_held_archive_is_wanted_again() {
        let hub = MapHubServer::holding(&[
            ("Isis 1.3", "src-a", 1),
            ("Comet Catcher Remake 1.8", "src-old", 1),
            ("Tabula 3", "src-c", 4),
        ]);
        let mut newer = key("Isis 1.3", "src-a");
        newer.catalog_version = 2;
        let mut older = key("Tabula 3", "src-c");
        older.catalog_version = 2;
        let keys = [
            key("Isis 1.3", "src-a"),
            newer,
            key("Comet Catcher Remake 1.8", "src-new"),
            key("Nuclear Winter 1.2", "src-d"),
            older,
        ];

        let answers = have_in_batches(&have_url(&hub), "a-token", &keys)
            .await
            .unwrap();

        assert_eq!(
            answers.iter().map(|a| a.status).collect::<Vec<_>>(),
            vec![
                MapHaveStatus::Have,
                MapHaveStatus::Changed,
                MapHaveStatus::Changed,
                MapHaveStatus::Missing,
                MapHaveStatus::Have,
            ]
        );
        assert!(!answers[0].status.wants_submission());
        assert!(answers[1].status.wants_submission());
        assert!(answers[3].status.wants_submission());
    }

    /// A library of three thousand maps is six requests, not three thousand, and
    /// the answers still line up with the keys by index.
    #[tokio::test]
    async fn a_large_library_is_a_few_requests_and_not_one_per_map() {
        let keys: Vec<MapHaveKey> = (0..1200)
            .map(|n| key(&format!("Map {n}"), "src-a"))
            .collect();
        let hub = MapHubServer::holding(&[]);

        let answers = have_in_batches(&have_url(&hub), "a-token", &keys)
            .await
            .unwrap();

        assert_eq!(hub.have_batches(), vec![500, 500, 200]);
        assert_eq!(answers.len(), 1200);
        assert_eq!(answers[1199].map_name, "Map 1199");
    }

    #[tokio::test]
    async fn the_token_goes_out_as_a_bearer_header() {
        let hub = MapHubServer::holding(&[]);
        have_in_batches(&have_url(&hub), "a-token", &[key("Isis 1.3", "src-a")])
            .await
            .unwrap();
        assert!(hub.last_headers().contains("authorization: bearer a-token"));
    }

    // ------------------------------------------------------------ submissions

    /// The four outcomes that are not a local refusal, from a hub answering the
    /// way its own route does.
    #[tokio::test]
    async fn the_hubs_outcomes_come_back_per_map_inside_a_200() {
        let hub = MapHubServer::holding(&[
            ("Isis 1.3", "src-a", 1),
            ("Tabula 3", "src-b", 1),
            ("Comet Catcher Remake 1.8", "src-c", 1),
        ]);
        let mut newer = entry("Tabula 3", "src-b");
        newer.catalog_version = 2;
        let entries = [
            entry("Isis 1.3", "src-a"),
            newer,
            entry("Comet Catcher Remake 1.8", "src-moved"),
            entry("Nuclear Winter 1.2", "src-d"),
        ];

        let results = publish_in_batches(&submit_url(&hub), "a-token", &entries)
            .await
            .unwrap();

        assert_eq!(
            results.iter().map(|r| r.outcome).collect::<Vec<_>>(),
            vec![
                MapSubmitOutcome::Unchanged,
                MapSubmitOutcome::Replaced,
                MapSubmitOutcome::Conflict,
                MapSubmitOutcome::Stored,
            ]
        );
        assert_eq!(results[2].map_name, "Comet Catcher Remake 1.8");
        // Only the two a person could act on, and the conflict is the one that
        // says this machine's archive differs from everybody else's.
        assert!(results[2].outcome.is_worth_reporting());
        assert!(!results[0].outcome.is_worth_reporting());
        assert!(!results[1].outcome.is_worth_reporting());
    }

    /// One request the hub refuses does not stop the rest, because the refusal is
    /// per map inside the answer rather than in the status.
    #[tokio::test]
    async fn a_conflicting_map_does_not_stop_the_batch() {
        let hub = MapHubServer::holding(&[("Isis 1.3", "src-held", 1)]);
        let entries: Vec<MapCatalogEntry> = std::iter::once(entry("Isis 1.3", "src-mine"))
            .chain((0..9).map(|n| entry(&format!("Map {n}"), "src-a")))
            .collect();

        let results = publish_in_batches(&submit_url(&hub), "a-token", &entries)
            .await
            .unwrap();

        assert_eq!(results[0].outcome, MapSubmitOutcome::Conflict);
        assert!(results[1..]
            .iter()
            .all(|r| r.outcome == MapSubmitOutcome::Stored));
        assert_eq!(hub.submit_batches(), vec![10]);
    }

    #[tokio::test]
    async fn a_batch_larger_than_the_map_cap_is_split_and_every_part_is_sent() {
        let entries: Vec<MapCatalogEntry> = (0..120)
            .map(|n| entry(&format!("Map {n}"), "src-a"))
            .collect();
        let hub = MapHubServer::holding(&[]);

        let results = publish_in_batches(&submit_url(&hub), "a-token", &entries)
            .await
            .unwrap();

        assert_eq!(hub.submit_batches(), vec![50, 50, 20]);
        assert_eq!(results.len(), 120);
        assert_eq!(results[119].map_name, "Map 119");
        assert_eq!(hub.submitted().len(), 120);
    }

    /// The second cap, and the reason it exists: fifty entries are small until
    /// one of them carries a description.
    #[tokio::test]
    async fn a_batch_is_split_on_bytes_before_it_reaches_fifty_maps() {
        // A tenth of the body cap each, so five fit and a sixth does not.
        let padding = caps().submit_bytes / 10;
        let entries: Vec<MapCatalogEntry> = (0..12)
            .map(|n| fat_entry(&format!("Map {n}"), padding))
            .collect();
        let hub = MapHubServer::holding(&[]);

        let results = publish_in_batches(&submit_url(&hub), "a-token", &entries)
            .await
            .unwrap();

        assert_eq!(results.len(), 12);
        assert!(
            hub.submit_batches().len() > 1,
            "one request carried all twelve: {:?}",
            hub.submit_batches()
        );
        assert!(hub.submit_batches().iter().all(|&n| n < caps().submit_maps));
        for bytes in hub.submit_bodies() {
            assert!(
                bytes <= caps().submit_bytes,
                "a body of {bytes} is past the hub's {} cap",
                caps().submit_bytes
            );
        }
    }

    /// An entry too large to travel even on its own never becomes a request. The
    /// hub would answer 413 for the whole batch it was in, and the other maps in
    /// that batch would pay for it.
    #[tokio::test]
    async fn a_map_too_large_for_any_batch_is_refused_here_rather_than_by_the_hub() {
        let hub = MapHubServer::holding(&[]);
        let entries = [
            entry("Isis 1.3", "src-a"),
            fat_entry("Enormous 1.0", caps().submit_bytes),
            entry("Tabula 3", "src-b"),
        ];

        let results = publish_in_batches(&submit_url(&hub), "a-token", &entries)
            .await
            .unwrap();

        assert_eq!(results[1].outcome, MapSubmitOutcome::Refused);
        assert!(
            results[1]
                .said
                .as_deref()
                .unwrap()
                .contains("cannot be sent"),
            "{:?}",
            results[1].said
        );
        // And the other two still went, in one request, without it.
        assert_eq!(results[0].outcome, MapSubmitOutcome::Stored);
        assert_eq!(results[2].outcome, MapSubmitOutcome::Stored);
        assert_eq!(hub.submit_batches(), vec![2]);
        assert_eq!(hub.submitted().len(), 2);
    }

    // ------------------------------------------------------- what is refused

    /// Answers are read by index, so an answer that does not echo what was asked
    /// is refused whole. Accepting it would report one map's facts as another's,
    /// with nothing afterwards to tell.
    #[tokio::test]
    async fn results_out_of_request_order_are_refused_rather_than_misattributed() {
        let hub = MapHubServer::misordering();
        let keys = [key("Isis 1.3", "src-a"), key("Tabula 3", "src-b")];

        let refused = have_in_batches(&have_url(&hub), "a-token", &keys)
            .await
            .unwrap_err();

        assert!(refused.contains("at position 0"), "{refused}");
        assert!(refused.contains("Tabula 3"), "{refused}");
    }

    #[tokio::test]
    async fn a_short_answer_is_refused_rather_than_lined_up_wrongly() {
        let hub = MapHubServer::answering(
            200,
            serde_json::json!({ "format": HAVE_FORMAT, "version": 1, "results": [] }),
        );
        let refused = have_in_batches(&have_url(&hub), "a-token", &[key("Isis 1.3", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("answered 0 of 1"), "{refused}");
    }

    #[tokio::test]
    async fn a_hub_that_speaks_a_newer_version_is_not_guessed_at() {
        let hub = MapHubServer::answering(
            200,
            serde_json::json!({ "format": SUBMIT_FORMAT, "version": 2, "results": [] }),
        );
        let refused =
            publish_in_batches(&submit_url(&hub), "a-token", &[entry("Isis 1.3", "src-a")])
                .await
                .unwrap_err();
        assert!(refused.contains("Update coilbox"), "{refused}");
    }

    /// An answer with no envelope at all does not parse, and one carrying
    /// somebody else's envelope is refused by name.
    #[tokio::test]
    async fn something_that_is_not_a_hub_is_not_read_as_an_answer() {
        let hub = MapHubServer::answering(200, serde_json::json!({ "results": [] }));
        let refused = have_in_batches(&have_url(&hub), "a-token", &[key("Isis 1.3", "src-a")])
            .await
            .unwrap_err();
        assert!(
            refused.contains("did not answer with a have check"),
            "{refused}"
        );

        let wrong_envelope = MapHubServer::answering(
            200,
            serde_json::json!({ "format": "coilbox-hub-asset-have", "version": 1, "results": [] }),
        );
        let refused = have_in_batches(
            &have_url(&wrong_envelope),
            "a-token",
            &[key("Isis 1.3", "src-a")],
        )
        .await
        .unwrap_err();
        assert!(refused.contains(HAVE_FORMAT), "{refused}");
    }

    // -------------------------------------------------------- what is retried

    /// A 401 is not about this batch and another request with the same token
    /// answers the same, so it is sent once and the words say what to do.
    #[tokio::test]
    async fn a_refused_sign_in_is_not_tried_again() {
        let hub = MapHubServer::answering(
            401,
            serde_json::json!({ "error": "Send an access token as \"Authorization: Bearer <token>\"." }),
        );
        let refused =
            publish_in_batches(&submit_url(&hub), "a-token", &[entry("Isis 1.3", "src-a")])
                .await
                .unwrap_err();
        assert!(refused.contains("Sign in again"), "{refused}");
        assert_eq!(hub.submit_batches().len(), 1);
    }

    /// A 5xx is the hub not answering just now, so it is worth another go, and
    /// the batch that follows is the same batch rather than a new one.
    #[tokio::test]
    async fn a_hub_that_recovers_gets_the_same_batch_again() {
        let hub = MapHubServer::answering_in_turn(&[
            (503, serde_json::json!({ "error": "no" })),
            (
                200,
                serde_json::json!({
                    "format": SUBMIT_FORMAT,
                    "version": 1,
                    "results": [{ "map_name": "Isis 1.3", "outcome": "stored" }],
                }),
            ),
        ]);

        let results =
            publish_in_batches(&submit_url(&hub), "a-token", &[entry("Isis 1.3", "src-a")])
                .await
                .unwrap();

        assert_eq!(results[0].outcome, MapSubmitOutcome::Stored);
        assert_eq!(hub.submit_batches().len(), 2);
    }

    /// And it is bounded, so a hub answering 503 to everything costs three
    /// requests rather than three hundred.
    #[tokio::test]
    async fn a_hub_that_never_recovers_costs_three_requests() {
        let hub = MapHubServer::answering(503, serde_json::json!({ "error": "no" }));
        let refused = have_in_batches(&have_url(&hub), "a-token", &[key("Isis 1.3", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("refused"), "{refused}");
        assert_eq!(hub.have_batches().len(), UPLOAD_ATTEMPTS as usize);
    }

    /// The hub's own words survive a refusal, because it is the side that knows
    /// which map it objected to.
    #[tokio::test]
    async fn the_hubs_own_words_survive_a_refusal() {
        let hub = MapHubServer::answering(
            400,
            serde_json::json!({ "error": "maps[3] Unknown field: sourceHash" }),
        );
        let refused =
            publish_in_batches(&submit_url(&hub), "a-token", &[entry("Isis 1.3", "src-a")])
                .await
                .unwrap_err();
        assert!(refused.contains("Unknown field: sourceHash"), "{refused}");
    }

    // ------------------------------------------------------------------- live

    /// What a hub says to either route with no token. Needs a hub running at the
    /// address below and no account, and sends no facts.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_maps_need_a_token -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches a running hub, so it cannot run in CI"]
    async fn live_maps_need_a_token() {
        for (path, body) in [
            (
                HAVE_PATH,
                serde_json::json!({ "keys": [key("Isis 1.3", "src-a")] }),
            ),
            (
                SUBMIT_PATH,
                serde_json::json!({
                    "format": SUBMIT_FORMAT,
                    "version": SUBMIT_VERSION,
                    "maps": [entry("Isis 1.3", "src-a")],
                }),
            ),
        ] {
            let url = api_url("http://localhost:3000", path, "Asking").unwrap();
            let response = reqwest::Client::new()
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body.to_string())
                .send()
                .await
                .expect("the hub could not be reached");
            let status = response.status().as_u16();
            println!(
                "{path} {status}: {}",
                response.text().await.unwrap_or_default()
            );
            assert_eq!(status, 401);
        }
    }
}
