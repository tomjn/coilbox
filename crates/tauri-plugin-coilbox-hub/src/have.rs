//! Asking the hub what it already has, before rendering or encoding anything
//! (issue #1632).
//!
//! `POST <hub>/api/v1/assets/have` with a bearer token. Coilbox sends identity
//! keys with the `source_hash` it holds for each, and the hub answers which of
//! them it still wants. This is the first call the upload path makes, because the
//! expensive part is the render and the encode rather than the transfer, and most
//! of the time the answer is that the hub already has it.
//!
//! The comparison is on `source_hash`, over the source the picture was derived
//! from, and never on the hash of the encoded bytes. Two coilbox releases with
//! different encoders produce different output from identical source bytes, so
//! comparing encoded hashes would report the whole corpus as changed after any
//! encoder change.
//!
//! The wire shape is the hub's, at `lib/api/assetHave.ts` in tomjn/coilbox-hub,
//! which refuses a field name it does not know rather than ignoring it. Shaped
//! after [`crate::publish`]: an https check, a client with timeouts, a hard cap on
//! what will be read back, and failures worded for the person reading them.
//!
//! What this deliberately does not do is walk a roster. Every key handed to it is
//! one the caller already had a reason to ask about, because the allowance the
//! answers spend is shared across everybody using the hub.

use std::collections::HashSet;
use std::time::Duration;

use coilbox_assets::{class_for_variant, KeyedOn};
use coilbox_oauth::HTTP_TIMEOUT;
use serde::{Deserialize, Serialize};

use crate::auth;
use crate::consent::AssetUploadConsent;
use crate::endpoint::{api_url, host_of, read_capped};

/// The route that answers the have check.
const HAVE_PATH: &str = "/api/v1/assets/have";

/// The envelope the answer carries, so a build that has been on disk for months
/// can say the service is newer than it understands rather than reading a shape
/// that changed under it. Both are `ASSET_HAVE_FORMAT` and `ASSET_HAVE_VERSION` in
/// the hub's `lib/api/assetHave.ts`.
const HAVE_FORMAT: &str = "coilbox-hub-asset-have";
const HAVE_VERSION: u32 = 1;

/// How many keys one request may carry, which is the hub's own
/// `ASSET_HAVE_MAX_KEYS`. Over it the hub answers 413 and refuses the batch
/// whole, so this is honoured rather than discovered: [`have`] splits a larger set
/// into requests of this size.
pub const MAX_KEYS_PER_REQUEST: usize = 500;

/// Longest one batch may take end to end, matching the publish timeout for the
/// same reason: a hub asleep on a free tier is woken by the first request, which
/// is slow rather than broken.
const HAVE_TIMEOUT: Duration = Duration::from_secs(60);

/// Bound the initial connect on its own, so a dead host fails before any of the
/// above is spent waiting.
const CONNECT_TIMEOUT: Duration = HTTP_TIMEOUT;

/// Largest answer that will be read.
///
/// One result echoes the key it answers, so a full batch is 500 of them. The
/// longest a key can be is the table's own limits, a 256 character map name and a
/// 64 character variant, plus the field names, which is under 400 bytes, and JSON
/// escaping can at worst double the strings. A megabyte leaves room for that and
/// is still far under anything that could be a picture rather than an answer.
const ANSWER_LIMIT: usize = 1024 * 1024;

/// Which of the hub's two key shapes addresses this picture. They are different
/// shapes on purpose and do not unify, so a caller says which one it means rather
/// than filling in whichever fields it happens to have.
///
/// `game` is the game's modinfo shortname, never a version and never the archive
/// name: the key exists to survive a version bump, and an archive name pins one
/// build. See `src/container/gameIdentity.ts`.
///
/// `map_name` is the full name unitsync reports from `GetMapName`, version string
/// and all, and is never split. A map is not scoped to a game, because the same
/// map archive is used across all of them.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "keyed_on", rename_all = "snake_case")]
pub enum AssetIdentity {
    Unit {
        game: String,
        unit_name: String,
        variant: String,
    },
    Map {
        map_name: String,
        variant: String,
    },
}

impl AssetIdentity {
    fn variant(&self) -> &str {
        match self {
            Self::Unit { variant, .. } | Self::Map { variant, .. } => variant,
        }
    }
}

/// One key to ask about: which picture, and the `source_hash` the caller holds for
/// it. The hash is over the source the picture comes from, so it is known before
/// the picture is made, which is what lets the check come first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssetKey {
    #[serde(flatten)]
    pub identity: AssetIdentity,
    pub source_hash: String,
}

/// What the hub wants done with one key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HaveStatus {
    /// The hub holds this identity at this `source_hash`. Render nothing, encode
    /// nothing, upload nothing.
    Have,
    /// The hub holds this identity at a different `source_hash`, so the source it
    /// was given is not the source these bytes came from. Encode and upload.
    Changed,
    /// The hub has no row for this identity at all. Make the picture, encode it,
    /// and upload it.
    Missing,
}

impl HaveStatus {
    /// Whether this key is worth spending a render and an encode on. The whole
    /// point of asking first is that most of a real batch answers `false` here.
    pub fn wants_upload(self) -> bool {
        !matches!(self, Self::Have)
    }
}

/// One answer, carrying the key it is about in the shape it was sent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct HaveResult {
    #[serde(flatten)]
    pub identity: AssetIdentity,
    pub status: HaveStatus,
}

/// The whole answer, as the hub sends it.
#[derive(Debug, Deserialize)]
struct HaveBody {
    format: String,
    version: u32,
    results: Vec<HaveResult>,
}

/// Ask the hub which of these it still wants, as the signed-in account.
///
/// Answers in the order the keys were given, however many requests it took, so a
/// caller can zip the two by index.
///
/// An empty set is answered without asking anybody, which matters because the
/// callers of this are loops and the hub refuses an empty batch.
///
/// `_consent` is the user's agreement to send pictures off this machine, and is the
/// reason this takes an argument it never reads (issue #1635). It is asked for here
/// rather than at the upload because this is the first call the upload path makes,
/// so a path that starts here cannot begin without the check having run. See
/// [`crate::consent`].
pub async fn have(
    hub_url: &str,
    keys: &[AssetKey],
    _consent: &AssetUploadConsent,
) -> Result<Vec<HaveResult>, String> {
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

    ask_in_batches(&url, &token, keys).await
}

/// Everything about a set of keys that can be known without asking.
///
/// Not a copy of the hub's validation, which stays the authority and rejects the
/// whole batch for one bad key. Two things are checked here because being wrong
/// about them costs more than a round trip:
///
/// - A repeated identity. The hub refuses one within a batch, but a set larger
///   than [`MAX_KEYS_PER_REQUEST`] can put the two copies in different requests,
///   where nothing catches them and the caller gets two answers for one picture
///   at indexes it will read as two different pictures.
/// - A variant that does not belong to the key shape it was sent with. The hub
///   answers `missing` for a unit variant nobody has, and `missing` is an
///   instruction to go and make the picture, so a typo becomes a render and an
///   encode before the upload says what was wrong with it.
///
/// A unit key with no game is the third, and is its own message. A game with no
/// modinfo shortname is a broken game rather than an unusual one, since the engine
/// does not allow it, so the caller skips it and flags it rather than keying an
/// asset on something else.
fn check_keys(keys: &[AssetKey]) -> Result<(), String> {
    let mut seen: HashSet<&AssetIdentity> = HashSet::with_capacity(keys.len());
    for (index, key) in keys.iter().enumerate() {
        let at = format!("key {index}");
        match &key.identity {
            AssetIdentity::Unit {
                game, unit_name, ..
            } => {
                if game.trim().is_empty() {
                    return Err(format!(
                        "{at} has no game shortname. A game with no shortname in its modinfo cannot key a unit picture, so skip it and flag it for review rather than keying it on the archive name."
                    ));
                }
                if unit_name.trim().is_empty() {
                    return Err(format!("{at} has no unit name."));
                }
            }
            AssetIdentity::Map { map_name, .. } => {
                if map_name.trim().is_empty() {
                    return Err(format!("{at} has no map name."));
                }
            }
        }
        if key.source_hash.trim().is_empty() {
            return Err(format!(
                "{at} has no source_hash. The have check compares on it, so a key without one cannot be answered."
            ));
        }

        let variant = key.identity.variant();
        let wants = match class_for_variant(variant) {
            Some(class) => class.keyed_on,
            None => return Err(format!("{at} asks for \"{variant}\", which is not a picture the hub keeps. See shared/asset-vocabulary.json.")),
        };
        let keyed_on = match key.identity {
            AssetIdentity::Unit { .. } => KeyedOn::Unit,
            AssetIdentity::Map { .. } => KeyedOn::Map,
        };
        if wants != keyed_on {
            return Err(format!(
                "{at} sends \"{variant}\" as a {} picture, and it is a {} one.",
                name_of(keyed_on),
                name_of(wants)
            ));
        }

        if !seen.insert(&key.identity) {
            return Err(format!("{at} asks about a picture already in the set."));
        }
    }
    Ok(())
}

fn name_of(keyed_on: KeyedOn) -> &'static str {
    match keyed_on {
        KeyedOn::Unit => "unit",
        KeyedOn::Map => "map",
    }
}

/// Split the set into requests the hub will accept and join the answers back up.
///
/// One client for all of them, so a set of several batches reuses the connection
/// rather than paying a fresh TLS handshake per request.
async fn ask_in_batches(
    url: &str,
    token: &str,
    keys: &[AssetKey],
) -> Result<Vec<HaveResult>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(HAVE_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut answers = Vec::with_capacity(keys.len());
    for batch in keys.chunks(MAX_KEYS_PER_REQUEST) {
        answers.extend(ask(&client, url, token, batch).await?);
    }
    Ok(answers)
}

/// One request, and what it answered.
async fn ask(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    batch: &[AssetKey],
) -> Result<Vec<HaveResult>, String> {
    let body = serde_json::json!({ "keys": batch }).to_string();
    let response = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| unreachable_message(url, e.is_timeout()))?;

    let status = response.status().as_u16();
    let bytes = read_capped(response, ANSWER_LIMIT).await?;
    if status != 200 {
        return Err(refusal(status, &bytes, url));
    }

    let answered: HaveBody = serde_json::from_slice(&bytes).map_err(|_| {
        format!(
            "The hub at {} did not answer with a have check.",
            host_of(url)
        )
    })?;
    if answered.format != HAVE_FORMAT {
        return Err(format!(
            "The hub at {} answered with something other than a have check.",
            host_of(url)
        ));
    }
    if answered.version > HAVE_VERSION {
        return Err(format!(
            "The hub at {} speaks version {} of the have check and this version of coilbox understands {HAVE_VERSION}. Update coilbox.",
            host_of(url),
            answered.version
        ));
    }
    // Results are answered in request order, which is what makes them readable by
    // index. A different count is not a batch this caller can line up, and
    // guessing at which answer belongs to which key would upload the wrong
    // pictures or skip the right ones.
    if answered.results.len() != batch.len() {
        return Err(format!(
            "The hub at {} answered {} of {} keys.",
            host_of(url),
            answered.results.len(),
            batch.len()
        ));
    }
    Ok(answered.results)
}

/// What the hub said no with. Its own words when it gave any, because it is the
/// side that knows which key it objected to.
fn refusal(status: u16, body: &[u8], url: &str) -> String {
    let said = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.as_str().map(str::to_owned));
    let host = host_of(url);
    match (status, said) {
        (401, _) => format!(
            "The hub at {host} did not accept the sign-in. Sign in again and try once more."
        ),
        (_, Some(said)) => format!("The hub at {host} refused the check: {said}"),
        (_, None) => format!("The hub at {host} refused the check, with a {status}."),
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
    use crate::testing::HaveServer;

    fn unit(game: &str, unit_name: &str, source_hash: &str) -> AssetKey {
        AssetKey {
            identity: AssetIdentity::Unit {
                game: game.into(),
                unit_name: unit_name.into(),
                variant: "buildpic".into(),
            },
            source_hash: source_hash.into(),
        }
    }

    fn map(map_name: &str, source_hash: &str) -> AssetKey {
        AssetKey {
            identity: AssetIdentity::Map {
                map_name: map_name.into(),
                variant: "minimap".into(),
            },
            source_hash: source_hash.into(),
        }
    }

    // ------------------------------------------------------------------ shape

    /// The body the hub is sent, by the names it insists on. `parseAssetHaveBody`
    /// rejects a field name it does not know rather than ignoring it, and a client
    /// that sent `sourceHash` would be told the hub is missing its whole corpus.
    #[test]
    fn the_two_key_shapes_are_the_hubs_own() {
        let sent = serde_json::json!({ "keys": [
            unit("bar", "armsolar", "src-a"),
            map("Comet Catcher Remake 1.8", "src-b"),
        ]});
        assert_eq!(
            sent,
            serde_json::json!({ "keys": [
                {
                    "keyed_on": "unit",
                    "game": "bar",
                    "unit_name": "armsolar",
                    "variant": "buildpic",
                    "source_hash": "src-a",
                },
                {
                    "keyed_on": "map",
                    "map_name": "Comet Catcher Remake 1.8",
                    "variant": "minimap",
                    "source_hash": "src-b",
                },
            ]})
        );
    }

    /// A map key carries no game, and a unit key carries no map name. The hub
    /// reads the two shapes separately and treats a field from the other one as an
    /// unknown field, so the shapes cannot be mixed even by accident.
    #[test]
    fn neither_shape_carries_the_others_fields() {
        let unit = serde_json::to_value(unit("bar", "armsolar", "src-a")).unwrap();
        assert!(unit.get("map_name").is_none(), "{unit}");
        let map = serde_json::to_value(map("Isis 1.3", "src-b")).unwrap();
        assert!(map.get("game").is_none(), "{map}");
    }

    /// Answers as the hub actually builds them, copied out of `buildAssetHaveBody`
    /// run over the bytes this client sends. The stand-in below imitates the same
    /// shape, so this is what stops the two imitating each other.
    #[test]
    fn the_hubs_own_answer_parses() {
        let unit: HaveBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-asset-have","version":1,"results":[{"keyed_on":"unit","game":"bar","unit_name":"armsolar","variant":"buildpic","status":"have"}]}"#,
        )
        .unwrap();
        assert_eq!(unit.format, HAVE_FORMAT);
        assert_eq!(unit.version, HAVE_VERSION);
        assert_eq!(
            unit.results,
            vec![HaveResult {
                identity: AssetIdentity::Unit {
                    game: "bar".into(),
                    unit_name: "armsolar".into(),
                    variant: "buildpic".into(),
                },
                status: HaveStatus::Have,
            }]
        );

        let map: HaveBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-asset-have","version":1,"results":[{"keyed_on":"map","map_name":"Comet Catcher Remake 1.8","variant":"minimap","status":"changed"}]}"#,
        )
        .unwrap();
        assert_eq!(
            map.results,
            vec![HaveResult {
                identity: AssetIdentity::Map {
                    map_name: "Comet Catcher Remake 1.8".into(),
                    variant: "minimap".into(),
                },
                status: HaveStatus::Changed,
            }]
        );
    }

    #[test]
    fn the_route_is_built_off_the_configured_base() {
        assert_eq!(
            api_url("https://hub.example/", HAVE_PATH, "Asking").unwrap(),
            "https://hub.example/api/v1/assets/have"
        );
    }

    #[test]
    fn plain_http_will_not_carry_a_token() {
        let refused = api_url("http://hub.example", HAVE_PATH, "Asking").unwrap_err();
        assert!(refused.contains("https"), "{refused}");
    }

    // ------------------------------------------------------------------- keys

    #[test]
    fn a_game_with_no_shortname_is_refused_with_what_to_do_about_it() {
        let refused = check_keys(&[unit("", "armsolar", "src-a")]).unwrap_err();
        assert!(refused.contains("shortname"), "{refused}");
        assert!(refused.contains("flag it"), "{refused}");
    }

    #[test]
    fn a_key_with_no_source_hash_cannot_be_compared() {
        let refused = check_keys(&[unit("bar", "armsolar", "")]).unwrap_err();
        assert!(refused.contains("source_hash"), "{refused}");
    }

    /// The #137 case. `overlay:metel` is not a picture anybody has, so the hub
    /// would answer `missing`, and `missing` means go and make it.
    #[test]
    fn a_misspelled_variant_is_caught_before_it_becomes_a_render() {
        let mut key = map("Isis 1.3", "src-b");
        if let AssetIdentity::Map { variant, .. } = &mut key.identity {
            *variant = "overlay:metel".into();
        }
        let refused = check_keys(&[key]).unwrap_err();
        assert!(refused.contains("overlay:metel"), "{refused}");
    }

    #[test]
    fn a_map_variant_on_a_unit_key_is_refused() {
        let mut key = unit("bar", "armsolar", "src-a");
        if let AssetIdentity::Unit { variant, .. } = &mut key.identity {
            *variant = "minimap".into();
        }
        let refused = check_keys(&[key]).unwrap_err();
        assert!(refused.contains("minimap"), "{refused}");
    }

    /// Two copies of one identity in a set big enough to be split would land in
    /// different requests, where the hub's own duplicate check cannot see them.
    #[test]
    fn one_picture_asked_about_twice_is_refused() {
        let refused = check_keys(&[
            unit("bar", "armsolar", "src-a"),
            unit("bar", "armsolar", "src-b"),
        ])
        .unwrap_err();
        assert!(refused.contains("already in the set"), "{refused}");
    }

    /// A render is askable like anything else once the caller can get its
    /// `source_hash` without drawing it, which is what `--unit-render-keys`
    /// answers (issue #1672). The `source_hash` here is a real one, from that
    /// mode run over Beyond All Reason's `armsolar`.
    #[tokio::test]
    async fn a_render_can_be_asked_about_before_it_is_drawn() {
        let mut key = unit(
            "bar",
            "armsolar",
            "c02dd0dd13f9bc896c6387b538338a20dd9f46a71dbb87033f0eb31941687512",
        );
        if let AssetIdentity::Unit { variant, .. } = &mut key.identity {
            *variant = "render:top".into();
        }
        check_keys(std::slice::from_ref(&key)).expect("a render key is askable");

        let hub = HaveServer::holding(&[(key.identity.clone(), &key.source_hash)]);
        let answers = ask_in_batches(&hub.url(), "a-token", &[key.clone()])
            .await
            .unwrap();
        assert_eq!(answers[0].status, HaveStatus::Have);
        assert!(!answers[0].status.wants_upload());

        // And a game that has re-skinned the model since is told apart, which is
        // the whole reason the key is over the model rather than over the pixels.
        let mut moved = key;
        moved.source_hash = "a-different-model-digest".into();
        let answers = ask_in_batches(&hub.url(), "a-token", &[moved])
            .await
            .unwrap();
        assert_eq!(answers[0].status, HaveStatus::Changed);
    }

    /// The same unit name in two games is two pictures, which is the reason `game`
    /// is in the key at all.
    #[test]
    fn the_same_unit_in_two_games_is_two_pictures() {
        check_keys(&[
            unit("bar", "armsolar", "src-a"),
            unit("xta", "armsolar", "src-a"),
        ])
        .unwrap();
    }

    // ----------------------------------------------------------------- asking

    #[tokio::test]
    async fn an_empty_set_asks_nobody() {
        // No server, no token, no address that could carry one: an empty set must
        // not reach any of it.
        assert_eq!(
            have("http://hub.example", &[], &AssetUploadConsent::for_test())
                .await
                .unwrap(),
            Vec::new()
        );
    }

    /// The comparison the whole design rests on: same `source_hash` is `have`, a
    /// different one is `changed`, and an identity the hub has never seen is
    /// `missing`.
    #[tokio::test]
    async fn a_changed_source_hash_reads_as_changed_and_an_unchanged_one_as_have() {
        let hub = HaveServer::holding(&[
            (unit("bar", "armsolar", "src-a").identity, "src-a"),
            (unit("bar", "armcom", "src-a").identity, "src-old"),
        ]);
        let keys = [
            unit("bar", "armsolar", "src-a"),
            unit("bar", "armcom", "src-new"),
            unit("bar", "armllt", "src-c"),
        ];

        let answers = ask_in_batches(&hub.url(), "a-token", &keys).await.unwrap();

        assert_eq!(
            answers.iter().map(|a| a.status).collect::<Vec<_>>(),
            vec![HaveStatus::Have, HaveStatus::Changed, HaveStatus::Missing]
        );
        assert_eq!(answers[0].identity, keys[0].identity);
        assert!(!answers[0].status.wants_upload());
        assert!(answers[1].status.wants_upload());
    }

    /// The encoded hash is not what is compared. Nothing in the request carries
    /// one, so a re-encode of an unchanged source cannot read as changed.
    #[tokio::test]
    async fn the_request_carries_no_encoded_hash() {
        let hub = HaveServer::holding(&[]);
        ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap();
        let sent = hub.last_body();
        assert!(sent.contains("source_hash"), "{sent}");
        assert!(!sent.contains("\"hash\""), "{sent}");
    }

    #[tokio::test]
    async fn the_token_goes_out_as_a_bearer_header() {
        let hub = HaveServer::holding(&[]);
        ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap();
        assert!(hub.last_headers().contains("authorization: bearer a-token"));
    }

    /// A batch is a batch. Twelve hundred keys is three requests of the hub's own
    /// maximum and not twelve hundred requests, and the answers still line up with
    /// the keys by index.
    #[tokio::test]
    async fn a_large_set_is_a_few_requests_and_not_one_per_key() {
        let keys: Vec<AssetKey> = (0..1200)
            .map(|n| unit("bar", &format!("unit{n}"), "src-a"))
            .collect();
        let hub = HaveServer::holding(&[]);

        let answers = ask_in_batches(&hub.url(), "a-token", &keys).await.unwrap();

        assert_eq!(hub.requests(), 3);
        assert_eq!(hub.batch_sizes(), vec![500, 500, 200]);
        assert_eq!(answers.len(), 1200);
        assert_eq!(answers[1199].identity, keys[1199].identity);
    }

    #[tokio::test]
    async fn a_hub_that_speaks_a_newer_version_is_not_guessed_at() {
        let hub = HaveServer::answering(
            200,
            serde_json::json!({ "format": HAVE_FORMAT, "version": 2, "results": [] }),
        );
        let refused = ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("Update coilbox"), "{refused}");
    }

    #[tokio::test]
    async fn something_that_is_not_a_hub_is_not_read_as_an_answer() {
        let hub = HaveServer::answering(200, serde_json::json!({ "results": [] }));
        let refused = ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap_err();
        assert!(
            refused.contains("did not answer with a have check"),
            "{refused}"
        );
    }

    /// An answer that does not cover the batch cannot be read by index, and
    /// guessing would upload the wrong pictures.
    #[tokio::test]
    async fn a_short_answer_is_refused_rather_than_lined_up_wrongly() {
        let hub = HaveServer::answering(
            200,
            serde_json::json!({ "format": HAVE_FORMAT, "version": 1, "results": [] }),
        );
        let refused = ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("answered 0 of 1"), "{refused}");
    }

    /// What the local hub answers an unauthenticated request with, word for word,
    /// so a refusal reads as one rather than as the hub being unreachable.
    #[tokio::test]
    async fn a_refused_sign_in_says_to_sign_in_again() {
        let hub = HaveServer::answering(
            401,
            serde_json::json!({ "error": "Send an access token as \"Authorization: Bearer <token>\"." }),
        );
        let refused = ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("Sign in again"), "{refused}");
    }

    /// Anything else the hub objected to comes back in its own words, because it
    /// is the side that knows which key it was about.
    #[tokio::test]
    async fn the_hubs_own_words_survive_a_refusal() {
        let hub = HaveServer::answering(
            400,
            serde_json::json!({ "error": "keys[3] unknown field: hash" }),
        );
        let refused = ask_in_batches(&hub.url(), "a-token", &[unit("bar", "armsolar", "src-a")])
            .await
            .unwrap_err();
        assert!(refused.contains("keys[3] unknown field: hash"), "{refused}");
    }

    // ------------------------------------------------------------------- live

    /// What a hub says to a have check with no token. Needs a hub running at the
    /// address below and no account, and uploads nothing.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_have_needs_a_token -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches a running hub, so it cannot run in CI"]
    async fn live_have_needs_a_token() {
        let url = api_url("http://localhost:3000", HAVE_PATH, "Asking").unwrap();
        let response = reqwest::Client::new()
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "keys": [unit("bar", "armsolar", "src-a")] }).to_string())
            .send()
            .await
            .expect("the hub could not be reached");
        let status = response.status().as_u16();
        println!("{status}: {}", response.text().await.unwrap_or_default());
        assert_eq!(status, 401);
    }
}
