//! Turning a configured hub address into a route on it.
//!
//! One place rather than one per request, because the rule it carries is a
//! security rule: a bearer token only goes out over https, with loopback the
//! exception so a hub being developed locally still works. Two copies of that
//! would eventually be two different rules.

use url::Url;

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
