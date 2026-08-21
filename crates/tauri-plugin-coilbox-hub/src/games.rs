//! Sending what a game says about its units to the hub (issue #1875).
//!
//! One route, `POST <hub>/api/v1/games/facts`, carrying a bearer token through
//! [`crate::auth`], so the request is made here rather than in the webview.
//!
//! ## One request is one whole game
//!
//! A map submission batches fifty maps because maps are independent. A game's
//! units are not: `complete` tells the hub the batch is the game's entire unit
//! set, so it retires every unit the batch did not name. Half a game would
//! therefore retire the other half. [`publish_game_facts`] takes one game and
//! there is no batching anywhere in it.
//!
//! That also decides what a failure looks like. A map batch answers per map
//! inside a 200, and a game answers per unit inside a 200, but a body the hub
//! will not parse is a 400 for the whole request naming the field it objected
//! to. So the caller's unit of failure is the game, and a sweep over an
//! installed library carries on to the next one.
//!
//! ## Why the body is built here and not passed through
//!
//! The hub refuses an unknown field rather than ignoring it, in the body and in
//! every unit. Building the body out of the types below means the webview cannot
//! add one: a stray field on the way in is dropped by serde, and what goes out
//! is whatever these structs say. `format`, `version` and `complete` are not the
//! caller's to set at all.
//!
//! A digest is the field a client most obviously wants to send and must not.
//! The hub computes it over the normalised entry, and a declared one would read
//! as unchanged facts for ever.
//!
//! ## Consent
//!
//! The same `hub.assetUploads` gate the pictures and the map facts use rather
//! than a fourth setting. Somebody who agreed to send what coilbox extracted
//! from their archives agreed to this.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::auth;
use crate::consent::AssetUploadConsent;
use crate::endpoint::{
    api_url, check_envelope, host_of, json_client, post_json_with_retries, refusal,
};

/// The route that takes one game's facts.
const SUBMIT_PATH: &str = "/api/v1/games/facts";

/// The envelope, carried on the request as well as the reply, so a build that
/// has been on disk for months can say the service is newer than it understands
/// rather than reading a shape that changed under it. The hub's own, in
/// `lib/api/gameFacts.ts`.
const SUBMIT_FORMAT: &str = "coilbox-hub-games";
const SUBMIT_VERSION: u32 = 1;

/// Largest answer that will be read. A full game answers one result per unit, so
/// two thousand short objects, which is well under a megabyte.
const ANSWER_LIMIT: usize = 1024 * 1024;

/// What one request may carry, all of them the hub's own numbers from
/// `lib/api/gameFacts.ts`.
///
/// Checked here rather than only there because the hub's answer to any of them
/// is a 400 or a 413 for the whole game, and a refusal that names the unit is
/// worth more to whoever has to fix the extraction than one that names the
/// request. They are constants rather than a vendored file because nothing
/// batches on them: a game either fits or is refused whole.
const MAX_BYTES: usize = 2_000_000;
const MAX_UNITS: usize = 2_000;
const MAX_START_UNITS: usize = 64;
const MAX_SHORTNAME: usize = 64;
const MAX_RELEASE: usize = 64;
const MAX_UNIT_NAME: usize = 128;
const MAX_FULL_NAME: usize = 256;
const MAX_FACTION_KEY: usize = 128;
const MAX_BUILD_OPTION: usize = 128;

/// One unit as the game declares it.
///
/// Named the way the hub names them, because this struct is the wire shape as
/// well as the shape the webview hands over. Every other type crossing that
/// boundary is snake case, and this one is not, which is the price of having one
/// struct rather than two and a mapping between them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameUnitFacts {
    /// The unit's internal name, which is what the hub keys on.
    pub name: String,
    /// The name a player sees, when the game gives one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Which faction reaches this unit, worked out over the build graph. Absent
    /// for a unit no start unit can reach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub faction_key: Option<String>,
    /// The units this one can build. Sent in whatever order the game listed
    /// them: the hub sorts and deduplicates before it digests, so order here
    /// cannot churn a revision.
    #[serde(default)]
    pub build_options: Vec<String>,
    /// Everything else the unit declares. Empty until issue #1876 extends the
    /// extraction, and sent anyway so the shape does not change when it does.
    #[serde(default)]
    pub stats: Map<String, Value>,
}

/// One whole game, as the webview read it off the archive.
///
/// No `complete` and no envelope: both are this module's to decide, and
/// `complete` in particular is the field that would make a partial read retire
/// the units it did not manage to read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFacts {
    /// The modinfo shortname, never an archive name. It is what the hub files a
    /// game under, and it is what survives a version bump.
    pub shortname: String,
    /// The archive's declared version string, verbatim. Never parsed, here or
    /// on the hub: a version is whatever the game's author typed.
    pub release: String,
    /// The start unit of each side that has one, which is what roots the build
    /// graph the faction keys came from.
    #[serde(default)]
    pub start_units: Vec<String>,
    pub units: Vec<GameUnitFacts>,
}

/// What the hub did with one faction or unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameFactsOutcome {
    /// Current facts changed, and this release's revision was written.
    Accepted,
    /// The facts were already held, but this release had no revision yet. The
    /// ordinary answer the second time a release is reported.
    Recorded,
    /// Nothing was written at all.
    Unchanged,
    /// The entry is malformed, and `said` carries why.
    Refused,
}

/// The answer for one faction or unit. `kind` says which list the name came
/// from, since a faction key and a unit name share no namespace but do share a
/// response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameFactsResult {
    pub kind: String,
    pub name: String,
    pub outcome: GameFactsOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub said: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GameFactsBody {
    format: String,
    version: u32,
    results: Vec<GameFactsResult>,
}

/// Send one game's facts to the hub, as the signed-in account.
///
/// One result per unit inside a 200, in the order the hub walked them. A unit
/// the hub would not take says nothing about the rest, so a caller reads every
/// result rather than the status code.
///
/// A game the hub could never accept is refused here rather than sent, because
/// the answer to any of it is a 400 for the whole game and the reason would name
/// a field rather than the unit that carries it.
///
/// `_consent` is the user's agreement to send what coilbox read off their
/// machine, and is the reason this takes an argument it never reads.
pub async fn publish_game_facts(
    hub_url: &str,
    game: &GameFacts,
    _consent: &AssetUploadConsent,
) -> Result<Vec<GameFactsResult>, String> {
    let url = api_url(hub_url, SUBMIT_PATH, "Sending a game's units")?;
    let body = check_and_build(game)?;

    // After the game is known to be sendable, so one that could never be
    // accepted does not spend a token refresh finding that out.
    let token = auth::access_token(hub_url)
        .await
        .map_err(|e| auth::explain(&e, hub_url))?;

    send_facts(&url, &token, &body).await
}

/// The body this game will be sent as, or why it cannot be sent at all.
///
/// The size check is on the finished body rather than on an estimate, since it
/// is the only one of these the hub measures in the same units.
fn check_and_build(game: &GameFacts) -> Result<String, String> {
    check_game(game)?;
    let body = serde_json::json!({
        "format": SUBMIT_FORMAT,
        "version": SUBMIT_VERSION,
        "shortname": game.shortname.trim(),
        "release": game.release.trim(),
        // The batch is the game, always. See the module docs.
        "complete": true,
        "startUnits": game.start_units,
        "units": game.units,
    })
    .to_string();
    if body.len() > MAX_BYTES {
        return Err(format!(
            "{}'s units come to {} bytes and the hub takes at most {MAX_BYTES} in one request.",
            game.shortname.trim(),
            body.len()
        ));
    }
    Ok(body)
}

/// Everything about a game that can be known without asking.
fn check_game(game: &GameFacts) -> Result<(), String> {
    text("shortname", &game.shortname, MAX_SHORTNAME)?;
    text("release", &game.release, MAX_RELEASE)?;

    // The one that is not a length. A complete batch with no units in it is an
    // instruction to retire every unit the hub holds for this game, so a read
    // that came back empty must not travel as one.
    if game.units.is_empty() {
        return Err(format!(
            "No units could be read out of {}, and sending none would retire every unit the hub holds for it.",
            game.shortname.trim()
        ));
    }
    if game.units.len() > MAX_UNITS {
        return Err(format!(
            "{} has {} units and the hub takes at most {MAX_UNITS} in one request.",
            game.shortname.trim(),
            game.units.len()
        ));
    }
    if game.start_units.len() > MAX_START_UNITS {
        return Err(format!(
            "{} declares {} start units and the hub takes at most {MAX_START_UNITS}.",
            game.shortname.trim(),
            game.start_units.len()
        ));
    }
    for start in &game.start_units {
        text("a start unit", start, MAX_UNIT_NAME)?;
    }

    for unit in &game.units {
        text("a unit name", &unit.name, MAX_UNIT_NAME)?;
        let about = |field: &str| format!("{}'s {field}", unit.name);
        if let Some(full_name) = &unit.full_name {
            text(&about("full name"), full_name, MAX_FULL_NAME)?;
        }
        if let Some(faction_key) = &unit.faction_key {
            text(&about("faction"), faction_key, MAX_FACTION_KEY)?;
        }
        if unit.build_options.len() > MAX_UNITS {
            return Err(format!(
                "{} lists more than {MAX_UNITS} build options.",
                unit.name
            ));
        }
        for option in &unit.build_options {
            text(&about("build options"), option, MAX_BUILD_OPTION)?;
        }
    }
    Ok(())
}

/// One string the hub holds to a length, measured after trimming the way its own
/// parser measures it.
fn text(what: &str, value: &str, max: usize) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{what} is empty, and the hub requires it."));
    }
    if trimmed.chars().count() > max {
        return Err(format!(
            "{what} is longer than the {max} characters the hub stores."
        ));
    }
    Ok(())
}

/// One submission request, and what it answered.
async fn send_facts(url: &str, token: &str, body: &str) -> Result<Vec<GameFactsResult>, String> {
    let client = json_client()?;
    let read = post_json_with_retries(&client, url, token, body, ANSWER_LIMIT).await?;
    if read.status != 200 {
        return Err(refusal(read.status, &read.bytes, url));
    }

    let answered: GameFactsBody = serde_json::from_slice(&read.bytes).map_err(|_| {
        format!(
            "The hub at {} did not answer with a game submission.",
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
    Ok(answered.results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::GameHubServer;

    fn unit(name: &str) -> GameUnitFacts {
        GameUnitFacts {
            name: name.into(),
            full_name: Some(format!("The {name}")),
            faction_key: Some("armada".into()),
            build_options: Vec::new(),
            stats: Map::new(),
        }
    }

    fn game() -> GameFacts {
        GameFacts {
            shortname: "BA".into(),
            release: "12.24".into(),
            start_units: vec!["armcom".into(), "corcom".into()],
            units: vec![unit("armcom"), unit("corcom")],
        }
    }

    fn submit_url(hub: &GameHubServer) -> String {
        api_url(&hub.base(), SUBMIT_PATH, "Sending").unwrap()
    }

    // ------------------------------------------------------------------ shape

    /// The body the hub is sent, by the names `parseGameFactsBody` insists on.
    /// It refuses a field name it does not know rather than ignoring it, so a
    /// client sending `full_name` would have the whole game turned away.
    #[test]
    fn the_body_is_the_hubs_own_shape() {
        let sent: Value = serde_json::from_str(&check_and_build(&game()).unwrap()).unwrap();

        assert_eq!(sent["format"], "coilbox-hub-games");
        assert_eq!(sent["version"], 1);
        assert_eq!(sent["shortname"], "BA");
        assert_eq!(sent["release"], "12.24");
        assert_eq!(sent["startUnits"], serde_json::json!(["armcom", "corcom"]));
        assert_eq!(sent["units"][0]["name"], "armcom");
        assert_eq!(sent["units"][0]["fullName"], "The armcom");
        assert_eq!(sent["units"][0]["factionKey"], "armada");
        assert_eq!(sent["units"][0]["buildOptions"], serde_json::json!([]));
        assert_eq!(sent["units"][0]["stats"], serde_json::json!({}));
    }

    /// Every field the body carries, so a field added here without the hub
    /// knowing about it fails a test rather than a whole backfill.
    #[test]
    fn the_body_carries_nothing_the_hub_does_not_know() {
        let sent: Value = serde_json::from_str(&check_and_build(&game()).unwrap()).unwrap();

        let mut fields: Vec<&String> = sent.as_object().unwrap().keys().collect();
        fields.sort();
        assert_eq!(
            fields,
            vec![
                "complete",
                "format",
                "release",
                "shortname",
                "startUnits",
                "units",
                "version",
            ]
        );

        let mut unit_fields: Vec<&String> = sent["units"][0].as_object().unwrap().keys().collect();
        unit_fields.sort();
        assert_eq!(
            unit_fields,
            vec!["buildOptions", "factionKey", "fullName", "name", "stats"]
        );
    }

    /// The hub computes the digest over the normalised entry, and a declared one
    /// reads as unchanged facts for ever. It is not a field this can send,
    /// because the body is built from the struct rather than passed through.
    #[test]
    fn no_digest_travels_however_hard_a_caller_tries() {
        let claimed: GameUnitFacts = serde_json::from_str(
            r#"{"name":"armcom","factsDigest":"deadbeef","facts_digest":"deadbeef"}"#,
        )
        .unwrap();
        let sent = serde_json::to_value(claimed).unwrap();
        assert!(sent.get("factsDigest").is_none());
        assert!(sent.get("facts_digest").is_none());
    }

    /// The batch is the game, so `complete` is always true and is never the
    /// caller's to set.
    #[test]
    fn a_submission_is_always_the_whole_game() {
        let sent: Value = serde_json::from_str(&check_and_build(&game()).unwrap()).unwrap();
        assert_eq!(sent["complete"], true);
    }

    /// The hub's own answer, copied from what `submitGameFacts` builds.
    #[test]
    fn the_hubs_own_answer_parses() {
        let answered: GameFactsBody = serde_json::from_str(
            r#"{"format":"coilbox-hub-games","version":1,"results":[{"kind":"unit","name":"armcom","outcome":"accepted"},{"kind":"unit","name":"corcom","outcome":"recorded"},{"kind":"unit","name":"armflash","outcome":"unchanged"},{"kind":"faction","name":"armada","outcome":"refused","said":"`key` is required."}]}"#,
        )
        .unwrap();

        assert_eq!(answered.format, SUBMIT_FORMAT);
        assert_eq!(
            answered
                .results
                .iter()
                .map(|r| r.outcome)
                .collect::<Vec<_>>(),
            vec![
                GameFactsOutcome::Accepted,
                GameFactsOutcome::Recorded,
                GameFactsOutcome::Unchanged,
                GameFactsOutcome::Refused,
            ]
        );
        assert_eq!(answered.results[3].kind, "faction");
        assert!(answered.results[3].said.as_deref().unwrap().contains("key"));
        assert!(answered.results[0].said.is_none());
    }

    #[test]
    fn the_route_is_built_off_the_configured_base() {
        assert_eq!(
            api_url("https://hub.example/", SUBMIT_PATH, "Sending").unwrap(),
            "https://hub.example/api/v1/games/facts"
        );
        assert!(api_url("http://hub.example", SUBMIT_PATH, "Sending")
            .unwrap_err()
            .contains("https"));
    }

    // --------------------------------------------------------- what is refused

    /// The one local check that is not a length. A complete batch is an
    /// instruction to retire every unit it did not name, so a read that came
    /// back empty must not travel as one.
    #[test]
    fn a_game_whose_units_could_not_be_read_is_not_sent_as_an_empty_one() {
        let refused = check_game(&GameFacts {
            units: Vec::new(),
            ..game()
        })
        .unwrap_err();
        assert!(refused.contains("retire every unit"), "{refused}");
    }

    /// A game with no version string cannot be sent at all: the hub requires
    /// `release` and answers 400 for the whole game without one. The sweep skips
    /// it before it gets this far, and this is what would catch one that did.
    #[test]
    fn a_game_that_declares_no_version_is_refused_by_name() {
        let refused = check_game(&GameFacts {
            release: "  ".into(),
            ..game()
        })
        .unwrap_err();
        assert!(refused.contains("release"), "{refused}");
    }

    #[test]
    fn a_game_with_no_shortname_is_refused_by_name() {
        let refused = check_game(&GameFacts {
            shortname: String::new(),
            ..game()
        })
        .unwrap_err();
        assert!(refused.contains("shortname"), "{refused}");
    }

    /// The hub would answer 400 naming the field. Naming the unit is what
    /// whoever has to fix the extraction can act on.
    #[test]
    fn an_overlong_field_is_refused_by_the_unit_that_carries_it() {
        let mut too_long = unit("armcom");
        too_long.full_name = Some("x".repeat(MAX_FULL_NAME + 1));
        let refused = check_game(&GameFacts {
            units: vec![too_long],
            ..game()
        })
        .unwrap_err();
        assert!(refused.contains("armcom"), "{refused}");
        assert!(refused.contains("full name"), "{refused}");
    }

    #[test]
    fn a_game_past_the_unit_cap_is_refused_before_it_is_sent() {
        let units: Vec<GameUnitFacts> = (0..MAX_UNITS + 1)
            .map(|n| unit(&format!("armunit{n}")))
            .collect();
        let refused = check_game(&GameFacts { units, ..game() }).unwrap_err();
        assert!(refused.contains("at most 2000"), "{refused}");
    }

    /// The byte cap, measured on the finished body because that is what the hub
    /// measures.
    #[test]
    fn a_game_past_the_byte_cap_is_refused_before_it_is_sent() {
        let units: Vec<GameUnitFacts> = (0..MAX_UNITS)
            .map(|n| GameUnitFacts {
                build_options: (0..100).map(|b| format!("armbuildable{n}x{b}")).collect(),
                ..unit(&format!("armunit{n}"))
            })
            .collect();
        let refused = check_and_build(&GameFacts { units, ..game() }).unwrap_err();
        assert!(refused.contains("at most 2000000"), "{refused}");
    }

    /// A game that could never be accepted fails before a token refresh is spent
    /// finding that out.
    #[tokio::test]
    async fn a_game_that_cannot_be_sent_fails_before_any_request() {
        let refused = publish_game_facts(
            "https://hub.example",
            &GameFacts {
                units: Vec::new(),
                ..game()
            },
            &AssetUploadConsent::for_test(),
        )
        .await
        .unwrap_err();
        assert!(refused.contains("retire every unit"), "{refused}");
    }

    // ----------------------------------------------------------- the request

    #[tokio::test]
    async fn one_game_is_one_request_and_the_token_goes_out_as_a_bearer_header() {
        let hub = GameHubServer::accepting();

        let results = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "armcom");
        assert_eq!(results[0].outcome, GameFactsOutcome::Accepted);
        assert_eq!(hub.requests(), 1);
        assert!(hub.last_headers().contains("authorization: bearer a-token"));
    }

    /// Sending the same game twice writes nothing the second time, which is what
    /// makes a backfill safe to leave running.
    #[tokio::test]
    async fn a_game_sent_twice_is_unchanged_the_second_time() {
        let hub = GameHubServer::accepting();
        let body = check_and_build(&game()).unwrap();

        send_facts(&submit_url(&hub), "a-token", &body)
            .await
            .unwrap();
        let again = send_facts(&submit_url(&hub), "a-token", &body)
            .await
            .unwrap();

        assert!(again
            .iter()
            .all(|r| r.outcome == GameFactsOutcome::Unchanged));
    }

    /// A unit the hub would not take is a result inside a 200 rather than an
    /// error, so the rest of the game still landed.
    #[tokio::test]
    async fn a_refused_unit_does_not_lose_the_game() {
        let hub = GameHubServer::answering(
            200,
            serde_json::json!({
                "format": SUBMIT_FORMAT,
                "version": 1,
                "results": [
                    { "kind": "unit", "name": "armcom", "outcome": "accepted" },
                    { "kind": "unit", "name": "corcom", "outcome": "refused", "said": "`stats` holds more than 8192 bytes of JSON." },
                ],
            }),
        );

        let results = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(results[0].outcome, GameFactsOutcome::Accepted);
        assert_eq!(results[1].outcome, GameFactsOutcome::Refused);
        assert!(results[1].said.as_deref().unwrap().contains("stats"));
    }

    /// A body the hub will not parse is a 400 for the whole game, and its own
    /// words survive because it is the side that knows which field it objected
    /// to.
    #[tokio::test]
    async fn the_hubs_own_words_survive_a_refusal() {
        let hub = GameHubServer::answering(
            400,
            serde_json::json!({ "error": "A unit unknown field: full_name" }),
        );

        let refused = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap_err();

        assert!(refused.contains("unknown field: full_name"), "{refused}");
    }

    #[tokio::test]
    async fn a_refused_sign_in_says_what_to_do_and_is_not_tried_again() {
        let hub = GameHubServer::answering(401, serde_json::json!({ "error": "no" }));

        let refused = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap_err();

        assert!(refused.contains("Sign in again"), "{refused}");
        assert_eq!(hub.requests(), 1);
    }

    /// A 5xx is the hub not answering just now, so it is worth another go.
    #[tokio::test]
    async fn a_hub_that_recovers_gets_the_same_game_again() {
        let hub = GameHubServer::answering_in_turn(&[
            (503, serde_json::json!({ "error": "no" })),
            (
                200,
                serde_json::json!({
                    "format": SUBMIT_FORMAT,
                    "version": 1,
                    "results": [{ "kind": "unit", "name": "armcom", "outcome": "accepted" }],
                }),
            ),
        ]);

        let results = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(results[0].outcome, GameFactsOutcome::Accepted);
        assert_eq!(hub.requests(), 2);
    }

    #[tokio::test]
    async fn a_hub_that_speaks_a_newer_version_is_not_guessed_at() {
        let hub = GameHubServer::answering(
            200,
            serde_json::json!({ "format": SUBMIT_FORMAT, "version": 2, "results": [] }),
        );

        let refused = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap_err();

        assert!(refused.contains("Update coilbox"), "{refused}");
    }

    #[tokio::test]
    async fn something_that_is_not_a_hub_is_not_read_as_an_answer() {
        let hub = GameHubServer::answering(200, serde_json::json!({ "results": [] }));

        let refused = send_facts(
            &submit_url(&hub),
            "a-token",
            &check_and_build(&game()).unwrap(),
        )
        .await
        .unwrap_err();

        assert!(
            refused.contains("did not answer with a game submission"),
            "{refused}"
        );
    }

    // ------------------------------------------------------------------- live

    /// What a hub says to the route with no token. Needs a hub running at the
    /// address below and no account, and sends no facts.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_game_facts_need_a_token -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches a running hub, so it cannot run in CI"]
    async fn live_game_facts_need_a_token() {
        let url = api_url("http://localhost:3000", SUBMIT_PATH, "Sending").unwrap();
        let response = reqwest::Client::new()
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(check_and_build(&game()).unwrap())
            .send()
            .await
            .expect("the hub could not be reached");
        let status = response.status().as_u16();
        println!("{status}: {}", response.text().await.unwrap_or_default());
        assert_eq!(status, 401);
    }

    /// A two faction game landing in a local hub's catalog, and staying put the
    /// second time. Needs a hub at the address below and an access token for an
    /// account on it in `COILBOX_HUB_TOKEN`.
    ///
    /// This is the one thing the stand-in above cannot prove: that the body this
    /// module builds is a body the hub's own parser accepts. Point it at a local
    /// hub only. It writes to whatever it is pointed at.
    ///
    /// ```text
    /// COILBOX_HUB_TOKEN=... cargo test -p tauri-plugin-coilbox-hub live_game_facts_land -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "writes to a running hub, so it cannot run in CI"]
    async fn live_game_facts_land_in_the_catalog() {
        let token = std::env::var("COILBOX_HUB_TOKEN").expect("COILBOX_HUB_TOKEN is not set");
        let url = api_url("http://localhost:3000", SUBMIT_PATH, "Sending").unwrap();
        let two_factions = GameFacts {
            shortname: "CBTEST".into(),
            release: "1.0".into(),
            start_units: vec!["armcom".into(), "corcom".into()],
            units: vec![
                GameUnitFacts {
                    build_options: vec!["armlab".into()],
                    ..unit("armcom")
                },
                GameUnitFacts {
                    faction_key: Some("armada".into()),
                    ..unit("armlab")
                },
                GameUnitFacts {
                    faction_key: Some("cortex".into()),
                    build_options: vec!["corlab".into()],
                    ..unit("corcom")
                },
                GameUnitFacts {
                    faction_key: Some("cortex".into()),
                    ..unit("corlab")
                },
            ],
        };
        let body = check_and_build(&two_factions).unwrap();

        let first = send_facts(&url, &token, &body).await.unwrap();
        println!("first: {first:?}");
        assert!(first.iter().all(|r| r.outcome != GameFactsOutcome::Refused));

        let again = send_facts(&url, &token, &body).await.unwrap();
        println!("again: {again:?}");
        assert!(again
            .iter()
            .all(|r| r.outcome == GameFactsOutcome::Unchanged));
    }
}
