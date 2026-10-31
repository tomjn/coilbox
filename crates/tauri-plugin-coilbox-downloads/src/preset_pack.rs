//! Fetching a setup pack somebody follows by its address (issue #1298).
//!
//! A followed pack's presets can carry tweak slots, which are Lua the game runs,
//! so what decides where the bytes may come from is here at the network call and
//! not in the webview. Redirects are followed by hand, one at a time, because a
//! host has to be checked before a request goes to it, and the check runs on every
//! hop. The list comes from the distribution profile on disk, never from the
//! caller, so nothing the webview sends can widen it.

use std::net::IpAddr;
use std::time::Duration;

use coilbox_ui_error::UiError;
use picoframe_core::CliResult;
use reqwest::{StatusCode, Url};
use serde_json::json;

use crate::{codes, fetch_timeout, read_capped};

/// Hosts a pack may come from when the distribution profile names none.
const DEFAULT_HOSTS: [&str; 2] = ["raw.githubusercontent.com", "gist.githubusercontent.com"];

/// The profile key that replaces [`DEFAULT_HOSTS`]. An empty list refuses every
/// host, which is how a distribution turns following off.
const HOSTS_KEY: &str = "presetPackHosts";

/// Largest pack that will be read: the ceiling a setup pack has in its own format,
/// `MAX_INFLATED_BYTES` in `src/container/container.ts`. A pack past it could not
/// be shared as a code or imported from a link either.
const PACK_LIMIT: u64 = 512 * 1024;

/// Most redirects one fetch follows, the number reqwest's own default policy stops at.
const MAX_REDIRECTS: usize = 10;

/// Longest one request may take, end to end. The branding catalog's timeout, since
/// that is a file of a similar size from the same host.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

fn host_not_allowed(host: &str) -> UiError {
    UiError::new(
        codes::PACK_HOST_NOT_ALLOWED,
        format!("Coilbox does not follow packs from {host}. That host is not on its list."),
    )
    .param("host", host)
}

fn redirect_refused(host: &str) -> UiError {
    UiError::new(
        codes::PACK_REDIRECT_REFUSED,
        format!("That address redirects to {host}, which is not on the list of hosts coilbox follows packs from."),
    )
    .param("host", host)
}

fn pack_too_large() -> UiError {
    UiError::new(
        codes::PACK_TOO_LARGE,
        "That file is too large to be a setup pack.",
    )
}

fn bad_address() -> UiError {
    UiError::new(
        codes::PACK_BAD_ADDRESS,
        "That is not a web address coilbox can follow.",
    )
}

fn not_a_pack() -> UiError {
    UiError::new(
        codes::PACK_NOT_A_PACK,
        "That address did not return a setup pack.",
    )
}

/// The hosts `profile_json` allows, lowercased, or the defaults when there is no
/// profile, it does not parse, or it does not set a list of strings.
fn allowed_hosts_from(profile_json: Option<&str>) -> Vec<String> {
    let listed = profile_json
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|profile| {
            profile
                .get(HOSTS_KEY)?
                .as_array()?
                .iter()
                .map(|host| host.as_str().map(|h| h.trim().to_ascii_lowercase()))
                .collect::<Option<Vec<_>>>()
        });
    listed.unwrap_or_else(|| DEFAULT_HOSTS.iter().map(|h| h.to_string()).collect())
}

/// The hosts this install allows, read from the profile each time so a
/// distribution's reload of its profile applies to the next fetch.
fn allowed_hosts() -> Vec<String> {
    let profile = coilbox_portable::portable_root()
        .and_then(|root| std::fs::read_to_string(root.join("profile.json")).ok());
    allowed_hosts_from(profile.as_deref())
}

/// Loopback is the one exception to https, as it is for a hub being developed
/// locally, because there is no wire. It still has to be on the list, and the
/// default list holds no such host.
fn is_loopback(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// Whether a request may go to `url`. The host comes first so the message for an
/// `http` address on an unlisted host names the thing that would not be fixed by
/// typing `https`. A password in the address and a port on a remote host are
/// refused as an unlisted host: `https://raw.githubusercontent.com@example.test/`
/// has `example.test` as its host, and a listed name on another port is another
/// server.
fn check_url(url: &Url, hosts: &[String], redirected: bool) -> Result<(), UiError> {
    let Some(host) = url.host_str() else {
        return Err(bad_address());
    };
    let refused = |host: &str| {
        if redirected {
            redirect_refused(host)
        } else {
            host_not_allowed(host)
        }
    };
    if !hosts.iter().any(|allowed| allowed == host) {
        return Err(refused(host));
    }
    let loopback = is_loopback(url);
    if !url.username().is_empty() || url.password().is_some() {
        return Err(refused(host));
    }
    if url.port().is_some() && !loopback {
        return Err(refused(host));
    }
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(UiError::new(
            codes::PACK_HTTPS_ONLY,
            "A preset pack's address must be https.",
        ));
    }
    Ok(())
}

/// Fetch a pack's text, refusing any hop `check_url` refuses before asking it for
/// anything.
async fn fetch_pack(address: &str, hosts: &[String]) -> Result<String, UiError> {
    let mut url = Url::parse(address.trim()).map_err(|_| bad_address())?;
    let client = reqwest::Client::builder()
        .user_agent("coilbox")
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| UiError::new(codes::FETCH_UNREACHABLE, e.to_string()))?;

    let mut hops = 0;
    let response = loop {
        check_url(&url, hosts, hops > 0)?;
        let response = client.get(url.clone()).send().await.map_err(|e| {
            if e.is_timeout() {
                fetch_timeout()
            } else {
                UiError::new(codes::FETCH_UNREACHABLE, "Could not reach the host.")
            }
        })?;
        let redirects = matches!(
            response.status(),
            StatusCode::MOVED_PERMANENTLY
                | StatusCode::FOUND
                | StatusCode::SEE_OTHER
                | StatusCode::TEMPORARY_REDIRECT
                | StatusCode::PERMANENT_REDIRECT
        );
        if !redirects {
            break response;
        }
        hops += 1;
        if hops > MAX_REDIRECTS {
            return Err(UiError::new(
                codes::PACK_TOO_MANY_REDIRECTS,
                "That address redirects too many times.",
            ));
        }
        url = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|location| location.to_str().ok())
            .and_then(|location| url.join(location).ok())
            .ok_or_else(not_a_pack)?;
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        return Err(UiError::new(
            codes::FETCH_STATUS,
            format!("The host returned an error ({status})."),
        )
        .param("status", status));
    }
    let bytes = read_capped(response, PACK_LIMIT, pack_too_large).await?;
    String::from_utf8(bytes).map_err(|_| not_a_pack())
}

/// `dl_fetch_preset_pack` - fetch a followed pack's manifest as text. The frontend
/// validates what comes back, and keeps its cached copy when this fails.
#[tauri::command]
pub(crate) async fn dl_fetch_preset_pack(url: String) -> CliResult {
    match fetch_pack(&url, &allowed_hosts()).await {
        Ok(text) => CliResult::ok(json!({ "text": text })),
        Err(e) => CliResult::err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A server on loopback that gives every request for a test's own paths the
    /// same raw answer, and counts them, so a test can say one never arrived.
    ///
    /// Anything else is let go, uncounted. Other programs on a developer machine
    /// probe new local ports with a `GET /`, and counting those made a request that
    /// was refused look as if it had arrived. Each connection has its own thread, so
    /// a probe that connects and says nothing does not hold up the request behind it.
    struct Server {
        port: u16,
        requests: Arc<AtomicUsize>,
    }

    fn is_ours(mut stream: &TcpStream) -> bool {
        const OURS: [&[u8]; 2] = [b"GET /p ", b"GET /moved "];
        let mut seen = Vec::new();
        let mut chunk = [0u8; 512];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => return false,
                Ok(n) => seen.extend_from_slice(&chunk[..n]),
            }
            let matches = |wanted: &&[u8]| {
                let len = seen.len().min(wanted.len());
                seen[..len] == wanted[..len]
            };
            if !OURS.iter().any(|wanted| matches(wanted)) {
                return false;
            }
            if seen.windows(4).any(|w| w == b"\r\n\r\n") {
                return true;
            }
        }
    }

    fn serve(head: &str, body: Vec<u8>) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let requests = Arc::new(AtomicUsize::new(0));
        let counted = requests.clone();
        let head = head.to_owned();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let (counted, head, body) = (counted.clone(), head.clone(), body.clone());
                std::thread::spawn(move || {
                    if !is_ours(&stream) {
                        return;
                    }
                    counted.fetch_add(1, Ordering::SeqCst);
                    let _ = write!(stream, "{head}\r\nConnection: close\r\n\r\n");
                    let _ = stream.write_all(&body);
                });
            }
        });
        Server { port, requests }
    }

    fn redirecting_to(location: &str) -> Server {
        serve(
            &format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0"),
            Vec::new(),
        )
    }

    fn answering(body: &str) -> Server {
        serve(
            &format!("HTTP/1.1 200 OK\r\nContent-Length: {}", body.len()),
            body.as_bytes().to_vec(),
        )
    }

    fn loopback_only() -> Vec<String> {
        vec!["127.0.0.1".to_string()]
    }

    fn fetch(url: &str, hosts: &[String]) -> Result<String, UiError> {
        tauri::async_runtime::block_on(fetch_pack(url, hosts))
    }

    fn code_of(result: Result<String, UiError>) -> String {
        result.expect_err("the fetch must fail").code.into_owned()
    }

    #[test]
    fn the_default_list_is_the_two_github_hosts() {
        assert_eq!(
            allowed_hosts_from(None),
            ["raw.githubusercontent.com", "gist.githubusercontent.com"]
        );
        assert_eq!(
            allowed_hosts_from(Some(r#"{"version":1}"#)),
            allowed_hosts_from(None)
        );
    }

    #[test]
    fn a_profile_replaces_the_list_and_can_empty_it() {
        assert_eq!(
            allowed_hosts_from(Some(r#"{"presetPackHosts":["Packs.Example.org"]}"#)),
            ["packs.example.org"]
        );
        assert!(allowed_hosts_from(Some(r#"{"presetPackHosts":[]}"#)).is_empty());
    }

    #[test]
    fn a_profile_that_cannot_be_read_keeps_the_defaults() {
        let defaults = allowed_hosts_from(None);
        assert_eq!(allowed_hosts_from(Some("{ not json")), defaults);
        assert_eq!(
            allowed_hosts_from(Some(r#"{"presetPackHosts":"example.org"}"#)),
            defaults
        );
        assert_eq!(
            allowed_hosts_from(Some(r#"{"presetPackHosts":["example.org",7]}"#)),
            defaults
        );
    }

    #[test]
    fn an_address_on_the_default_list_passes_the_check() {
        let hosts = allowed_hosts_from(None);
        for address in [
            "https://raw.githubusercontent.com/o/r/main/pack.json",
            "https://gist.githubusercontent.com/o/1/raw/pack.json",
            "https://RAW.githubusercontent.com:443/o/r/main/pack.json",
        ] {
            let url = Url::parse(address).unwrap();
            assert!(check_url(&url, &hosts, false).is_ok(), "{address}");
        }
    }

    #[test]
    fn an_unlisted_host_is_refused_by_name_before_any_request() {
        let server = answering("{}");
        let hosts = vec!["localhost".to_string()];
        let error = fetch(&format!("http://127.0.0.1:{}/p", server.port), &hosts)
            .expect_err("127.0.0.1 is not on this list");
        assert_eq!(error.code, codes::PACK_HOST_NOT_ALLOWED);
        assert_eq!(error.params["host"], "127.0.0.1");
        assert!(error.fallback.contains("127.0.0.1"), "{}", error.fallback);
        assert_eq!(server.requests.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_lookalike_of_a_listed_host_is_refused() {
        let hosts = allowed_hosts_from(None);
        for address in [
            "https://raw.githubusercontent.com.example.test/p.json",
            "https://example.test/raw.githubusercontent.com/p.json",
            "https://raw.githubusercontent.com@example.test/p.json",
            "https://notraw.githubusercontent.com/p.json",
            "https://githubusercontent.com/p.json",
        ] {
            let url = Url::parse(address).unwrap();
            let error = check_url(&url, &hosts, false).expect_err(address);
            assert_eq!(error.code, codes::PACK_HOST_NOT_ALLOWED, "{address}");
        }
    }

    #[test]
    fn credentials_or_another_port_on_a_listed_host_are_refused() {
        let hosts = allowed_hosts_from(None);
        for address in [
            "https://me:secret@raw.githubusercontent.com/p.json",
            "https://raw.githubusercontent.com:8443/p.json",
        ] {
            let url = Url::parse(address).unwrap();
            let error = check_url(&url, &hosts, false).expect_err(address);
            assert_eq!(error.code, codes::PACK_HOST_NOT_ALLOWED, "{address}");
        }
    }

    #[test]
    fn a_listed_remote_host_over_http_is_refused() {
        let url = Url::parse("http://raw.githubusercontent.com/p.json").unwrap();
        let error = check_url(&url, &allowed_hosts_from(None), false).expect_err("http");
        assert_eq!(error.code, codes::PACK_HTTPS_ONLY);
    }

    #[test]
    fn something_that_is_not_a_web_address_says_so() {
        for address in ["not an address", "file:///etc/passwd"] {
            assert_eq!(
                code_of(fetch(address, &loopback_only())),
                codes::PACK_BAD_ADDRESS,
                "{address}"
            );
        }
    }

    #[test]
    fn a_probe_of_the_test_server_is_not_counted_as_a_request() {
        let server = answering("{}");
        let probed = |request: &[u8]| {
            let mut probe = TcpStream::connect(("127.0.0.1", server.port)).expect("connect");
            probe.write_all(request).expect("write");
            // The server closes on a probe, so this returns once it has decided.
            let mut answer = Vec::new();
            let _ = probe.read_to_end(&mut answer);
            answer
        };
        assert!(probed(b"GET / HTTP/1.1\r\n\r\n").is_empty());
        assert!(probed(b"\x16\x03\x01").is_empty());
        assert_eq!(server.requests.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_listed_host_answers_with_the_text() {
        let server = answering(r#"{"title":"Pack"}"#);
        let text = fetch(
            &format!("http://127.0.0.1:{}/p", server.port),
            &loopback_only(),
        );
        assert_eq!(text.ok().as_deref(), Some(r#"{"title":"Pack"}"#));
    }

    #[test]
    fn a_redirect_to_another_host_is_refused_and_never_requested() {
        let elsewhere = answering("{}");
        // Addressed by a name that is not on the list, though it is the same machine.
        let start = redirecting_to(&format!("http://localhost:{}/p", elsewhere.port));
        let error = fetch(
            &format!("http://127.0.0.1:{}/p", start.port),
            &loopback_only(),
        )
        .expect_err("localhost is not on this list");
        assert_eq!(error.code, codes::PACK_REDIRECT_REFUSED);
        assert_eq!(error.params["host"], "localhost");
        assert_eq!(start.requests.load(Ordering::SeqCst), 1);
        assert_eq!(elsewhere.requests.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_redirect_from_https_down_to_http_on_a_listed_host_is_refused() {
        let url = Url::parse("http://raw.githubusercontent.com/p.json").unwrap();
        let error = check_url(&url, &allowed_hosts_from(None), true).expect_err("http");
        assert_eq!(error.code, codes::PACK_HTTPS_ONLY);
    }

    #[test]
    fn a_redirect_on_the_same_host_is_followed() {
        let end = answering("the pack");
        let start = redirecting_to(&format!("http://127.0.0.1:{}/p", end.port));
        let text = fetch(
            &format!("http://127.0.0.1:{}/p", start.port),
            &loopback_only(),
        );
        assert_eq!(text.ok().as_deref(), Some("the pack"));
    }

    #[test]
    fn a_relative_redirect_is_resolved_against_the_address_it_came_from() {
        let server = redirecting_to("/moved");
        assert_eq!(
            code_of(fetch(
                &format!("http://127.0.0.1:{}/p", server.port),
                &loopback_only(),
            )),
            codes::PACK_TOO_MANY_REDIRECTS
        );
        assert_eq!(server.requests.load(Ordering::SeqCst), MAX_REDIRECTS + 1);
    }

    #[test]
    fn an_error_status_says_which() {
        let server = serve("HTTP/1.1 404 Not Found\r\nContent-Length: 0", Vec::new());
        let error = fetch(
            &format!("http://127.0.0.1:{}/p", server.port),
            &loopback_only(),
        )
        .expect_err("a 404");
        assert_eq!(error.code, codes::FETCH_STATUS);
        assert_eq!(error.params["status"], "404");
    }

    #[test]
    fn a_body_past_the_limit_is_refused_whatever_its_header_says() {
        let body = vec![b'x'; PACK_LIMIT as usize + 1];
        let honest = serve(
            &format!("HTTP/1.1 200 OK\r\nContent-Length: {}", body.len()),
            body.clone(),
        );
        // No length at all, so the cap applies while the body arrives.
        let silent = serve("HTTP/1.1 200 OK", body);
        for server in [honest, silent] {
            assert_eq!(
                code_of(fetch(
                    &format!("http://127.0.0.1:{}/p", server.port),
                    &loopback_only(),
                )),
                codes::PACK_TOO_LARGE
            );
        }
    }

    #[test]
    fn a_body_at_the_limit_is_read() {
        let body = vec![b'x'; PACK_LIMIT as usize];
        let server = serve(
            &format!("HTTP/1.1 200 OK\r\nContent-Length: {}", body.len()),
            body,
        );
        let text = fetch(
            &format!("http://127.0.0.1:{}/p", server.port),
            &loopback_only(),
        );
        assert_eq!(text.map(|t| t.len()).ok(), Some(PACK_LIMIT as usize));
    }

    #[test]
    fn a_body_that_is_not_text_is_not_a_pack() {
        let server = serve("HTTP/1.1 200 OK\r\nContent-Length: 2", vec![0xff, 0xfe]);
        assert_eq!(
            code_of(fetch(
                &format!("http://127.0.0.1:{}/p", server.port),
                &loopback_only(),
            )),
            codes::PACK_NOT_A_PACK
        );
    }
}
