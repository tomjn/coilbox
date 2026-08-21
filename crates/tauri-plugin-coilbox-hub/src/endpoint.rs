//! Turning a configured hub address into a route on it, and posting JSON to it.
//!
//! One place rather than one per request, because the rule it carries is a
//! security rule: a bearer token only goes out over https, with loopback the
//! exception so a hub being developed locally still works. Two copies of that
//! would eventually be two different rules.
//!
//! The JSON post below arrived with the map catalog ([`crate::maps`]) and is
//! here because the game catalog ([`crate::games`]) sends the same kind of
//! request: a token, a JSON body, a bounded answer, and the retry taxonomy
//! [`crate::upload`] already reads off a status. The picture upload keeps its
//! own, because a multipart body and a per-asset cancellation are a different
//! request.

use std::time::Duration;

use coilbox_oauth::HTTP_TIMEOUT;
use url::Url;

use crate::upload::{verdict_for, Verdict, RETRY_BACKOFF, UPLOAD_ATTEMPTS};

/// Longest one request may take end to end, matching the other hub routes for
/// the same reason: a hub asleep on a free tier is woken by the first request,
/// which is slow rather than broken.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Bound the initial connect on its own, so a dead host fails before any of the
/// above is spent waiting.
const CONNECT_TIMEOUT: Duration = HTTP_TIMEOUT;

/// Where a route on a hub lives, or why this address cannot carry a token.
///
/// `doing` names what is being attempted, so the refusal says which action it is
/// about rather than "a request failed": "Publishing needs an https hub address".
///
/// Loopback is the exception to https. A hub being developed locally is served
/// over http and there is no wire for the token to be on.
pub fn api_url(hub_url: &str, path: &str, doing: &str) -> Result<String, String> {
    let base = hub_url.trim_end_matches('/');
    let parsed =
        Url::parse(base).map_err(|_| "The hub address is not a web address.".to_owned())?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(format!(
            "{doing} needs an https hub address, so your sign-in is not sent in the clear."
        ));
    }
    Ok(format!("{base}{path}"))
}

/// The host of a URL, for a message, or the URL itself if it will not parse.
pub fn host_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

/// Read a response body, stopping at `limit` rather than buffering whatever
/// arrives. Streamed with the cap applied as it goes, the way `dl_fetch_text`
/// does, so a body that lies about its length is dropped mid transfer rather
/// than downloaded first.
pub async fn read_capped(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len() + chunk.len() > limit {
                    return Err("That address answered, but it is not a coilbox hub.".to_owned());
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(buf),
            Err(_) => return Err("The hub stopped answering part way through.".to_owned()),
        }
    }
}

/// A hub's answer, once it has one.
pub struct Read {
    pub status: u16,
    pub bytes: Vec<u8>,
}

/// Send a JSON body, trying again while the answer is one another request could
/// change.
///
/// The same taxonomy the picture upload reads off a status
/// ([`crate::upload::Verdict`]) rather than a second copy of it: a 5xx or a
/// request that never arrived is worth another go, a 401 or a 429 is not about
/// this body and is not, and everything else is the same answer for ever.
///
/// Bounded at [`UPLOAD_ATTEMPTS`], so a hub answering 503 to everything costs
/// three requests rather than three hundred.
pub async fn post_json_with_retries(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &str,
    answer_limit: usize,
) -> Result<Read, String> {
    let mut waiting = RETRY_BACKOFF;
    let mut attempt = 1;
    loop {
        let sent = post_json(client, url, token, body, answer_limit).await;
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

async fn post_json(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: &str,
    answer_limit: usize,
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
    let bytes = read_capped(response, answer_limit).await?;
    Ok(Read { status, bytes })
}

/// A client with both deadlines set. One per call rather than one per request,
/// so a run that makes several reuses the connection.
pub fn json_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Whether the answer is the document this build knows how to read.
pub fn check_envelope(
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

/// What the hub said no with. Its own words when it gave any, because it is the
/// side that knows what it objected to.
pub fn refusal(status: u16, body: &[u8], url: &str) -> String {
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
pub fn unreachable_message(url: &str, timed_out: bool) -> String {
    let host = host_of(url);
    if timed_out {
        format!("The hub at {host} took too long to answer. It may be waking up after a quiet spell, so try again in a moment.")
    } else {
        format!("Could not reach the hub at {host}. Check your connection, and give it a moment if it is waking up after a quiet spell.")
    }
}
