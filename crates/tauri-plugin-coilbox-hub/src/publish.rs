//! Publishing a share code to the Coilbox hub.
//!
//! `POST <hub>/api/v1/items` with a bearer token, which is the same code path the
//! website's publish form takes, so what the hub accepts here and there cannot
//! drift.
//!
//! The request goes out from here rather than from the webview because this is
//! where the access token lives, and no token crosses the IPC boundary (see
//! [`crate::auth`]). The webview hands over the code and the words that go with it
//! and gets back what the hub answered.
//!
//! Shaped after `dl_fetch_text` in the downloads plugin: an https check, a client
//! with timeouts, a hard cap on what will be read back, and failures worded for the
//! person reading them.

use coilbox_oauth::HTTP_TIMEOUT;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use url::Url;

use crate::auth;

/// The route that takes a publication.
const ITEMS_PATH: &str = "/api/v1/items";

/// Longest a publish may take end to end. Longer than the sign-in's own timeout
/// because the hub sleeps after a quiet week and the first request wakes it, which
/// is slow rather than broken.
const PUBLISH_TIMEOUT: Duration = Duration::from_secs(60);

/// Bound the initial connect on its own, so a dead host fails before any of the
/// above is spent waiting.
const CONNECT_TIMEOUT: Duration = HTTP_TIMEOUT;

/// Largest answer that will be read. The hub replies with the new row and a link,
/// never the container it was sent, so anything approaching this is not an answer
/// from a hub.
const ANSWER_LIMIT: usize = 256 * 1024;

/// What goes in the request body. The field names are the hub's
/// (`parsePublishBody` in tomjn/coilbox-hub), which rejects any name it does not
/// know rather than ignoring it.
#[derive(Debug, Serialize)]
pub struct Publication {
    pub code: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
}

/// What the hub answered: its status and its body, parsed if it was JSON.
///
/// Deliberately not turned into a verdict here. Which status means what is the
/// hub's API talking, and `src/hub/publish.ts` already owns that vocabulary for
/// the read side, wording included. Rust's part is everything the webview cannot
/// do: the token, and reaching the host.
#[derive(Debug)]
pub struct Answer {
    pub status: u16,
    pub body: Option<Value>,
}

/// Where a hub's publish route lives, or why this address cannot carry a token.
///
/// https, because a bearer token on the wire in clear text is a token anybody on
/// the network has. Loopback is the exception: a hub being developed locally is
/// served over http, and there is no wire for it to be on.
fn publish_url(hub_url: &str) -> Result<String, String> {
    let base = hub_url.trim_end_matches('/');
    let parsed =
        Url::parse(base).map_err(|_| "The hub address is not a web address.".to_owned())?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(
            "Publishing needs an https hub address, so your sign-in is not sent in the clear."
                .to_owned(),
        );
    }
    Ok(format!("{base}{ITEMS_PATH}"))
}

/// The host of a URL, for a message, or the URL itself if it will not parse.
fn host_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

/// Publish to a hub, as the signed-in account.
///
/// The only failures worded here are the ones the webview cannot see: an address
/// that cannot carry a token, no usable sign-in, and never reaching the hub at all.
/// Anything the hub itself said comes back as an [`Answer`] to be read there.
pub async fn publish(hub_url: &str, publication: &Publication) -> Result<Answer, String> {
    let url = publish_url(hub_url)?;
    let token = auth::access_token(hub_url)
        .await
        .map_err(|e| auth::explain(&e, hub_url))?;

    let body = serde_json::to_string(publication).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(PUBLISH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| unreachable_message(hub_url, e.is_timeout()))?;

    let status = response.status().as_u16();
    let bytes = read_capped(response).await?;
    Ok(Answer {
        status,
        body: serde_json::from_slice(&bytes).ok(),
    })
}

/// Why the hub was never reached. Both cases name the host, because it is a
/// setting and often not the default one, and both name waking up, because a hub
/// asleep on a free tier is the likeliest reason a publish never lands.
fn unreachable_message(hub_url: &str, timed_out: bool) -> String {
    let host = host_of(hub_url);
    if timed_out {
        format!("The hub at {host} took too long to answer. It may be waking up after a quiet spell, so try again in a moment.")
    } else {
        format!("Could not reach the hub at {host}. Check your connection, and give it a moment if it is waking up after a quiet spell.")
    }
}

/// Read a response body, stopping at [`ANSWER_LIMIT`] rather than buffering
/// whatever arrives. Streamed with the cap applied as it goes, the way
/// `dl_fetch_text` does, so a body that lies about its length is dropped mid
/// transfer rather than downloaded first.
async fn read_capped(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len() + chunk.len() > ANSWER_LIMIT {
                    return Err("That address answered, but it is not a coilbox hub.".to_owned());
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(buf),
            Err(_) => return Err("The hub stopped answering part way through.".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_route_off_the_configured_base() {
        assert_eq!(
            publish_url("https://hub.example").unwrap(),
            "https://hub.example/api/v1/items"
        );
    }

    #[test]
    fn a_trailing_slash_is_the_same_hub() {
        assert_eq!(
            publish_url("https://hub.example/").unwrap(),
            publish_url("https://hub.example").unwrap()
        );
    }

    /// A hub served under a path prefix keeps it, the same way `hubItemsUrl` in
    /// `src/hub/api.ts` builds its addresses.
    #[test]
    fn a_path_prefix_is_kept() {
        assert_eq!(
            publish_url("https://example.test/hub").unwrap(),
            "https://example.test/hub/api/v1/items"
        );
    }

    #[test]
    fn plain_http_will_not_carry_a_token() {
        let refused = publish_url("http://hub.example").unwrap_err();
        assert!(refused.contains("https"), "{refused}");
    }

    #[test]
    fn a_hub_being_developed_locally_is_allowed_over_http() {
        assert_eq!(
            publish_url("http://localhost:3000").unwrap(),
            "http://localhost:3000/api/v1/items"
        );
    }

    #[test]
    fn something_that_is_not_an_address_is_refused() {
        assert!(publish_url("coilbox-hub.vercel.app").is_err());
    }

    /// The body the hub is sent, by the names it insists on: it rejects a field
    /// name it does not know rather than ignoring it.
    #[test]
    fn the_body_uses_the_hubs_field_names() {
        let sent = serde_json::to_value(Publication {
            code: "a-code".into(),
            title: "A title".into(),
            description: "".into(),
            tags: vec!["one".into()],
        })
        .unwrap();
        assert_eq!(
            sent,
            serde_json::json!({
                "code": "a-code",
                "title": "A title",
                "description": "",
                "tags": ["one"],
            })
        );
    }

    // ------------------------------------------------------------------- live

    /// What the live hub says to a publish with no token. Needs the internet but no
    /// account, and publishes nothing.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_publish_needs_a_token -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "reaches the live hub, so it cannot run in CI"]
    async fn live_publish_needs_a_token() {
        let url = publish_url("https://coilbox-hub.vercel.app").unwrap();
        let response = reqwest::Client::new()
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::json!({ "code": "not-a-code", "title": "t" }).to_string())
            .send()
            .await
            .expect("the hub could not be reached");
        let status = response.status().as_u16();
        println!("{status}: {}", response.text().await.unwrap_or_default());
        assert_eq!(status, 401);
    }

    /// The one test that publishes for real. It needs a sign-in already stored on
    /// this machine (Settings > Coilbox hub), and it puts a real item in the live
    /// gallery, which you will want to withdraw afterwards.
    ///
    /// ```text
    /// cargo test -p tauri-plugin-coilbox-hub live_publish -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "publishes a real item as your account, so it cannot run in CI"]
    async fn live_publish() {
        let hub = "https://coilbox-hub.vercel.app";
        // A minimal preset container, which is the smallest thing the gallery
        // carries. Sent as raw JSON rather than a code: the hub's `accept()` takes
        // either, and a saved export is JSON.
        let container = serde_json::json!({
            "format": "coilbox-container",
            "container": 1,
            "kind": "preset",
            "kindVersion": 1,
            "payload": {
                "gameName": "Beyond All Reason test-1",
                "mapName": "Comet Catcher Remake",
                "participants": [],
            },
        });
        let answer = publish(
            hub,
            &Publication {
                code: container.to_string(),
                title: "Publish test, please withdraw".into(),
                description: "Posted by cargo test live_publish.".into(),
                tags: vec!["test".into()],
            },
        )
        .await
        .expect("publishing failed");
        println!("{}: {:?}", answer.status, answer.body);
        assert_eq!(answer.status, 201);
    }
}
