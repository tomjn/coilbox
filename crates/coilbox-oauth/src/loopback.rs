//! The loopback listener the browser is redirected back to, per RFC 8252.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinSet;
use tokio::time::Instant;
use url::Url;

use crate::AuthError;

/// Path the browser is redirected back to, shared by every service.
///
/// Tachyon's generic client registers `http://localhost/oauth2callback` with no
/// port, and Teiserver skips the port comparison when both sides are loopback, so
/// an ephemeral port matches. Supabase allows any path under `http://127.0.0.1:*`,
/// so it takes this one too rather than needing one of its own.
pub const CALLBACK_PATH: &str = "/oauth2callback";

/// Which of the two colours the page carries.
///
/// The tone is the whole difference between the page a finished sign-in leaves
/// behind and the page a failed one does, so a failure is legible as one before
/// the text is read.
#[derive(Clone, Copy)]
enum Tone {
    Done,
    Failed,
}

impl Tone {
    /// Written straight into the `<body>` tag, so `Done` contributes nothing.
    fn body_class(self) -> &'static str {
        match self {
            Tone::Done => "",
            Tone::Failed => " class=\"err\"",
        }
    }
}

/// Everything the page needs, held apart from [`page`]'s format string because
/// CSS braces cannot go through `format!`.
///
/// Colours are picoframe's dark zinc ramp resolved to literals: `#111113` is
/// `--background`, `#f2f2f2` is `--foreground` and `#a3a3ae` is
/// `--muted-foreground`. Resolved rather than imported because this page is
/// served by the loopback listener below, which has no route for a stylesheet,
/// a font or an image. Everything is inline for the same reason, down to the
/// favicon, whose data URI also stops the browser firing a stray
/// `/favicon.ico` at the listener.
const STYLE: &str = r#"
*{box-sizing:border-box}
html,body{height:100%}
body{--tone:#f2f2f2;--dim:#a3a3ae;margin:0;display:grid;place-items:center;padding:2rem;background:#111113;color:#f2f2f2;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
body.err{--tone:#eb6a6a;--dim:#c9a3a6}
.art,.rings{position:fixed;z-index:0;pointer-events:none}
.art{inset:0;width:100%;height:100%}
.rings{top:50%;left:50%;width:min(94vmin,880px);height:min(94vmin,880px);translate:-50% -50%;-webkit-mask-image:radial-gradient(ellipse min(60%,20rem) min(30%,10rem) at 50% 50%,transparent 60%,#000 100%);mask-image:radial-gradient(ellipse min(60%,20rem) min(30%,10rem) at 50% 50%,transparent 60%,#000 100%)}
.rings,.mark{color:var(--tone)}
main{position:relative;z-index:1;max-width:34rem;text-align:center}
.mark{width:5rem;height:5rem;display:block;margin:0 auto 1.75rem}
.mark path{stroke-dasharray:64;stroke-dashoffset:64;animation:coil 1.4s cubic-bezier(.16,1,.3,1) .1s forwards}
h1{margin:0;font-size:clamp(1.5rem,6vw,2rem);line-height:1.15;font-weight:600;letter-spacing:-.025em;color:var(--tone)}
p{margin:.75rem 0 0;font-size:1rem;line-height:1.6;color:var(--dim)}
.copy{opacity:0;animation:rise .7s cubic-bezier(.16,1,.3,1) .5s forwards}
@keyframes coil{to{stroke-dashoffset:0}}
@keyframes rise{from{opacity:0;transform:translateY(.5rem)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mark path{animation:none;stroke-dashoffset:0}.copy{animation:none;opacity:1}}
"#;

/// The coilbox mark's single path, shared by the logo, the favicon and nothing
/// else. Taken from `src-tauri/icons/source-hexagonal-coil.svg`.
const COIL: &str = "M12 3 18.62 7.39A1.3 1.3 0 0 1 19.2 8.56L18.76 15.13A1.3 1.3 0 0 1 18.03 16.21L12.68 18.79A1.3 1.3 0 0 1 11.38 18.69L6.99 15.68A1.3 1.3 0 0 1 6.44 14.5L6.84 9.82A1.3 1.3 0 0 1 7.6 8.75L11.31 7.06A1.3 1.3 0 0 1 12.61 7.2L15.39 9.24A1.3 1.3 0 0 1 15.91 10.45L15.56 13.24A1.3 1.3 0 0 1 14.75 14.28L12.72 15.09A1.3 1.3 0 0 1 11.4 14.88L10.22 13.89A1.3 1.3 0 0 1 9.79 12.61L10.04 11.47A1.09 1.09 0 0 1 10.66 10.71L11.34 10.4";

/// The backdrop: the mark's own hexagon scaled out and turned eight degrees a
/// ring, so the drawing behind the page is the coil unwinding rather than
/// decoration. Two layers, because a single full-bleed drawing would slice the
/// hexagons into stray diagonals on a wide window. The rings are a square
/// element centred on the viewport. The dashed arcs and the scattered points
/// are full-bleed and stay neutral in both tones, so a failure reads as one
/// thing going wrong rather than a red wash.
const ART: &str = r##"<svg class="rings" viewBox="-500 -500 1000 1000" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
<defs><polygon id="h" points="0,-100 -86.6,-50 -86.6,50 0,100 86.6,50 86.6,-50" vector-effect="non-scaling-stroke"/></defs>
<use href="#h" transform="rotate(0) scale(1.15)" stroke-opacity=".2"/>
<use href="#h" transform="rotate(8) scale(1.85)" stroke-opacity=".15"/>
<use href="#h" transform="rotate(16) scale(2.6)" stroke-opacity=".11"/>
<use href="#h" transform="rotate(24) scale(3.4)" stroke-opacity=".08"/>
<use href="#h" transform="rotate(32) scale(4.3)" stroke-opacity=".055"/>
</svg>
<svg class="art" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" aria-hidden="true">
<g stroke-width="1.2" stroke-opacity=".13" stroke-dasharray="7 11" stroke-linecap="round">
<path d="M-40 158 Q 420 40 640 180 T 1240 122"/>
<path d="M-40 656 Q 380 758 680 618 T 1240 682"/>
</g>
<g fill="#f2f2f2" stroke="none">
<circle cx="118" cy="96" r="2.5" fill-opacity=".3"/><circle cx="264" cy="52" r="1.6" fill-opacity=".18"/>
<circle cx="392" cy="150" r="2" fill-opacity=".22"/><circle cx="86" cy="330" r="1.8" fill-opacity=".2"/>
<circle cx="212" cy="452" r="2.6" fill-opacity=".28"/><circle cx="60" cy="690" r="2" fill-opacity=".22"/>
<circle cx="330" cy="726" r="1.6" fill-opacity=".16"/><circle cx="470" cy="644" r="2.2" fill-opacity=".24"/>
<circle cx="928" cy="120" r="2.4" fill-opacity=".26"/><circle cx="1082" cy="216" r="1.8" fill-opacity=".2"/>
<circle cx="806" cy="66" r="1.6" fill-opacity=".16"/><circle cx="1136" cy="452" r="2.6" fill-opacity=".28"/>
<circle cx="990" cy="588" r="2" fill-opacity=".22"/><circle cx="852" cy="712" r="2.3" fill-opacity=".24"/>
<circle cx="1150" cy="700" r="1.7" fill-opacity=".18"/><circle cx="700" cy="760" r="1.9" fill-opacity=".2"/>
</g>
</svg>"##;

/// The page the browser is left showing, whichever way the callback went.
///
/// Every string that reaches it is a literal from this file. Nothing the
/// authorization server sent is rendered. An `error` or `error_description`
/// from the query goes into [`AuthError`] for Coilbox to show, and putting it
/// on this page instead would be writing an unescaped remote string into HTML.
fn page(tone: Tone, heading: &str, message: &str) -> String {
    let body_class = tone.body_class();
    format!(
        r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{heading}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f2f2f2' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='{COIL}'/%3E%3C/svg%3E">
<style>{STYLE}</style></head><body{body_class}>
{ART}
<main>
<svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Coilbox">
<path d="{COIL}"/>
</svg>
<div class="copy"><h1>{heading}</h1><p>{message}</p></div>
</main>
</body></html>"##
    )
}

/// What every way of not finishing says. One recovery, because there is only
/// one: the sign-in is started from Coilbox, not from here.
const TRY_AGAIN: &str = "You can close this window and try again in Coilbox.";

/// What a callback carrying somebody else's `state` is told.
const NOT_OURS: &str =
    "This sign-in was not the one Coilbox started. You can close this window and try again in Coilbox.";

/// Write one HTTP response and close. Anything the browser sends after this is of
/// no interest to us.
async fn respond(sock: &mut TcpStream, status: &str, body: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = sock.write_all(head.as_bytes()).await;
    let _ = sock.write_all(body.as_bytes()).await;
    let _ = sock.flush().await;
}

/// Read the request line of an HTTP request and return its target, for example
/// `/oauth2callback?code=x`. Anything longer than 8 KiB before the first line break
/// is not a browser and is dropped.
async fn read_target(sock: &mut TcpStream) -> Option<String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    while !buf.windows(2).any(|w| w == b"\r\n") {
        if buf.len() > 8192 {
            return None;
        }
        match sock.read(&mut chunk).await {
            Ok(0) | Err(_) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let line = String::from_utf8_lossy(&buf);
    let line = line.split("\r\n").next()?;
    let mut parts = line.split(' ');
    let _method = parts.next()?;
    Some(parts.next()?.to_owned())
}

/// A bound loopback socket waiting for the browser to come back to it.
///
/// Bound before the browser opens, so the redirect URI in the authorization
/// request names a port that is already listening.
pub struct Loopback {
    listener: TcpListener,
    redirect_uri: String,
}

impl Loopback {
    /// Bind an ephemeral port on the loopback interface.
    pub async fn bind() -> Result<Self, AuthError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AuthError::Listener(e.to_string()))?;
        let port = listener
            .local_addr()
            .map_err(|e| AuthError::Listener(e.to_string()))?
            .port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
        })
    }

    /// The address to send the authorization server's redirect to.
    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    /// Wait for the browser to arrive at the callback and return the authorization
    /// code.
    ///
    /// It answers every request it receives, because a browser left on an
    /// unanswered socket shows an error page rather than the one we wrote, but only
    /// a request to [`CALLBACK_PATH`] ends the wait.
    ///
    /// A callback carrying the wrong `state` is refused rather than ignored.
    /// Ignoring it would leave the real browser able to finish, but it would also
    /// mean a process on this machine could keep guessing without us ever noticing.
    ///
    /// Once the code is in hand the listener stays up for `grace` in a task of its
    /// own, so the sign-in carries on without waiting for it. The same callback URL
    /// can arrive more than once, for example when the Discord desktop app follows
    /// the redirect and then hands it to the browser, and a second arrival that
    /// found the port closed would show "refused to connect" over a sign-in that
    /// worked. See [`Callback::answer`] for what it answers then.
    ///
    /// Every connection is served in its own task, before the code and after it,
    /// so a socket that opens and sends nothing cannot hold up the one behind it
    /// (#3213). The tasks live in a [`JoinSet`] owned alongside the listener, so
    /// they all end when the listener closes.
    pub async fn wait_for_code(
        self,
        state: &str,
        timeout: Duration,
        grace: Duration,
    ) -> Result<String, AuthError> {
        let listener = self.listener;
        let callback = Arc::new(Callback {
            state: state.to_owned(),
            phase: Mutex::new(Phase::Waiting),
        });
        let mut conns = JoinSet::new();
        let deadline = Instant::now() + timeout;
        let code = match serve_until(&listener, &mut conns, &callback, deadline).await {
            Some(result) => result?,
            None => return Err(AuthError::TimedOut),
        };
        tokio::spawn(async move {
            let deadline = Instant::now() + grace;
            let _ = serve_until(&listener, &mut conns, &callback, deadline).await;
            // The listener and every connection task drop here, which releases the
            // port.
        });
        Ok(code)
    }
}

/// What a connection's task hands back: the end of the wait if its request
/// settled the sign-in, or nothing.
type Outcome = Option<Result<String, AuthError>>;

/// Accept connections until one settles the sign-in or `deadline` passes, serving
/// each in its own task in `conns`.
///
/// Returns the settling result, an error if accepting fails, or `None` at the
/// deadline. Finished tasks are reaped as it goes, so a stream of connections
/// does not pile up in `conns`.
async fn serve_until(
    listener: &TcpListener,
    conns: &mut JoinSet<Outcome>,
    callback: &Arc<Callback>,
    deadline: Instant,
) -> Outcome {
    let serve = async {
        loop {
            tokio::select! {
                accepted = listener.accept() => match accepted {
                    Ok((sock, _)) => {
                        conns.spawn(serve(sock, Arc::clone(callback)));
                    }
                    Err(e) => return Some(Err(AuthError::Listener(e.to_string()))),
                },
                Some(joined) = conns.join_next() => {
                    if let Ok(Some(result)) = joined {
                        return Some(result);
                    }
                }
            }
        }
    };
    tokio::time::timeout_at(deadline, serve)
        .await
        .unwrap_or(None)
}

/// Read one request, answer it, and hand back what it settled, if anything.
///
/// The page is written before the outcome is handed back, because the wait
/// closes the listener and every connection task as soon as it has an error.
async fn serve(mut sock: TcpStream, callback: Arc<Callback>) -> Outcome {
    // The target is a path, so it needs any origin to parse as a URL. Ours is the
    // one it arrived on.
    let url = read_target(&mut sock)
        .await
        .and_then(|target| Url::parse(&format!("http://127.0.0.1{target}")).ok());
    let (status, body, outcome) = match url {
        None => (
            "400 Bad Request",
            page(Tone::Failed, "Bad request", TRY_AGAIN),
            None,
        ),
        Some(url) if url.path() != CALLBACK_PATH => (
            "404 Not Found",
            page(Tone::Failed, "Not found", "You can close this window."),
            None,
        ),
        Some(url) => callback.answer(&url),
    };
    respond(&mut sock, status, &body).await;
    outcome
}

/// Where the sign-in stands, shared by every connection's task.
enum Phase {
    /// No callback has settled it yet.
    Waiting,
    /// A callback carried our `state` and a code, and the code was handed back.
    SignedIn,
    /// A callback settled it with an error.
    Failed,
}

/// The sign-in every connection answers for.
struct Callback {
    state: String,
    phase: Mutex<Phase>,
}

impl Callback {
    /// Answer a request to [`CALLBACK_PATH`] with a status, a page and what it
    /// settled.
    ///
    /// Only the first callback to arrive while [`Phase::Waiting`] settles anything.
    /// The phase moves on under the same lock, so exactly one outcome is ever
    /// handed back, whichever order the connections finish reading in.
    ///
    /// A callback carrying the wrong `state` is refused rather than ignored.
    /// Ignoring it would leave the real browser able to finish, but it would also
    /// mean a process on this machine could keep guessing without us ever noticing.
    ///
    /// Once the code is taken nothing is acted on. A callback carrying our `state`
    /// is a copy of the redirect that already finished, so it gets the signed in
    /// page, and anything else gets the refused page. Every page is fixed text, so
    /// nothing from the query is echoed and a second code goes nowhere.
    fn answer(&self, url: &Url) -> (&'static str, String, Outcome) {
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let ours = params.get("state") == Some(&self.state);
        let mut phase = self.phase.lock().unwrap_or_else(|e| e.into_inner());
        match *phase {
            Phase::SignedIn if ours => (
                "200 OK",
                page(Tone::Done, "Signed in", "You can close this window."),
                None,
            ),
            Phase::SignedIn => (
                "400 Bad Request",
                page(Tone::Failed, "Sign-in refused", NOT_OURS),
                None,
            ),
            Phase::Failed => (
                "400 Bad Request",
                page(Tone::Failed, "Sign-in did not finish", TRY_AGAIN),
                None,
            ),
            Phase::Waiting => {
                let (status, body, result) = if let Some(error) = params.get("error") {
                    (
                        "200 OK",
                        page(Tone::Failed, "Sign-in did not finish", TRY_AGAIN),
                        Err(AuthError::Denied {
                            error: error.clone(),
                            description: params.get("error_description").cloned(),
                        }),
                    )
                } else if !ours {
                    (
                        "400 Bad Request",
                        page(Tone::Failed, "Sign-in refused", NOT_OURS),
                        Err(AuthError::StateMismatch),
                    )
                } else if let Some(code) = params.get("code").filter(|c| !c.is_empty()) {
                    (
                        "200 OK",
                        page(Tone::Done, "Signed in", "You can close this window."),
                        Ok(code.clone()),
                    )
                } else {
                    (
                        "400 Bad Request",
                        page(Tone::Failed, "Sign-in did not finish", TRY_AGAIN),
                        Err(AuthError::BadCallback("no code".into())),
                    )
                };
                *phase = if result.is_ok() {
                    Phase::SignedIn
                } else {
                    Phase::Failed
                };
                (status, body, Some(result))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_listener_gives_up_rather_than_waiting_for_a_browser_that_never_comes() {
        let loopback = Loopback::bind().await.unwrap();
        let err = loopback
            .wait_for_code("some-state", Duration::from_millis(50), Duration::ZERO)
            .await
            .unwrap_err();
        assert!(matches!(err, AuthError::TimedOut), "{err:?}");
    }

    #[test]
    fn only_a_failed_page_carries_the_failed_tone() {
        let done = page(Tone::Done, "Signed in", "You can close this window.");
        let failed = page(Tone::Failed, "Sign-in did not finish", TRY_AGAIN);
        assert!(done.contains("<body>"), "{done}");
        assert!(failed.contains(r#"<body class="err">"#), "{failed}");
    }

    #[test]
    fn the_page_carries_its_own_mark_and_styling_with_nothing_to_fetch() {
        let html = page(Tone::Done, "Signed in", "You can close this window.");
        assert!(html.contains(COIL), "the mark is missing");
        assert!(html.contains("<style>"), "the styling is missing");
        // A stylesheet, script, font or image link would 404: this listener
        // serves one path and it is the callback.
        assert!(!html.contains("stylesheet"), "{html}");
        assert!(!html.contains("<script"), "{html}");
        assert!(!html.contains("<img"), "{html}");
    }

    /// One HTTP request against a live loopback, returning the response body.
    async fn request(port: u16, target: &str) -> String {
        let mut sock = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        sock.write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut buf = Vec::new();
        sock.read_to_end(&mut buf).await.unwrap();
        String::from_utf8_lossy(&buf).into_owned()
    }

    #[tokio::test]
    async fn a_refused_callback_never_echoes_what_the_server_sent() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let wait = tokio::spawn(loopback.wait_for_code(
            "real-state",
            Duration::from_secs(5),
            Duration::ZERO,
        ));
        let response = request(
            port,
            "/oauth2callback?error=access_denied&error_description=%3Csvg+onload%3Dalert(1)%3E",
        )
        .await;
        assert!(!response.contains("onload"), "{response}");
        assert!(!response.contains("access_denied"), "{response}");
        assert!(response.contains("Sign-in did not finish"), "{response}");
        assert!(
            matches!(wait.await.unwrap(), Err(AuthError::Denied { .. })),
            "the caller still has to be told"
        );
    }

    #[tokio::test]
    async fn a_stray_request_gets_the_same_page_rather_than_bare_text() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let wait = tokio::spawn(loopback.wait_for_code(
            "real-state",
            Duration::from_millis(300),
            Duration::ZERO,
        ));
        let response = request(port, "/somewhere-else").await;
        assert!(response.starts_with("HTTP/1.1 404 Not Found"), "{response}");
        assert!(response.contains("Not found"), "{response}");
        assert!(response.contains("<style>"), "{response}");
        // The wait carries on, because a stray request is not the browser.
        assert!(matches!(wait.await.unwrap(), Err(AuthError::TimedOut)));
    }

    /// The Windows report in #2377. With the Discord desktop app installed, the
    /// callback URL reaches the listener twice, and whatever arrives second used to
    /// find the port closed and show "refused to connect" over a sign-in that
    /// worked.
    #[tokio::test]
    async fn a_second_arrival_at_the_callback_still_gets_the_signed_in_page() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let grace = Duration::from_secs(5);
        let wait =
            tokio::spawn(loopback.wait_for_code("real-state", Duration::from_secs(5), grace));
        let callback = "/oauth2callback?code=the-code&state=real-state";
        let first = request(port, callback).await;
        assert!(first.contains("Signed in"), "{first}");
        // The code comes back straight away rather than after the grace window.
        let code = tokio::time::timeout(grace / 5, wait)
            .await
            .expect("the sign-in waited for the grace window")
            .unwrap()
            .unwrap();
        assert_eq!(code, "the-code");

        // A socket that connects and sends nothing, the way a browser opens one
        // speculatively, must not hold up the request behind it.
        let _silent = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let second = tokio::time::timeout(grace / 5, request(port, callback))
            .await
            .expect("a silent socket held up the second arrival");
        assert!(second.starts_with("HTTP/1.1 200 OK"), "{second}");
        assert!(second.contains("Signed in"), "{second}");
    }

    /// #3213. Before the code arrives, a local connection that sends nothing used
    /// to hold up the browser's callback until the whole wait timed out.
    #[tokio::test]
    async fn a_silent_connection_does_not_hold_up_the_callback() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let timeout = Duration::from_secs(5);
        let wait = tokio::spawn(loopback.wait_for_code("real-state", timeout, Duration::ZERO));

        let _silent = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let response = tokio::time::timeout(
            timeout / 5,
            request(port, "/oauth2callback?code=the-code&state=real-state"),
        )
        .await
        .expect("a silent socket held up the callback");
        assert!(response.contains("Signed in"), "{response}");
        let code = tokio::time::timeout(timeout / 5, wait)
            .await
            .expect("the code did not come back after the callback was answered")
            .unwrap()
            .unwrap();
        assert_eq!(code, "the-code");
    }

    /// A connection opened before the code arrived, whose request only comes in
    /// after, is answered as a copy of the finished sign-in. Its code goes nowhere.
    #[tokio::test]
    async fn a_request_that_straddles_the_code_is_answered_but_not_acted_on() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let wait = tokio::spawn(loopback.wait_for_code(
            "real-state",
            Duration::from_secs(5),
            Duration::from_secs(5),
        ));

        let mut early = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        request(port, "/oauth2callback?code=the-code&state=real-state").await;
        assert_eq!(wait.await.unwrap().unwrap(), "the-code");

        early
            .write_all(b"GET /oauth2callback?code=another-code&state=real-state HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut buf = Vec::new();
        early.read_to_end(&mut buf).await.unwrap();
        let response = String::from_utf8_lossy(&buf);
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("Signed in"), "{response}");
        assert!(!response.contains("another-code"), "{response}");
    }

    /// After the code is taken, a callback that is not a copy of ours is told it
    /// was refused, and nothing it carried comes back in the page.
    #[tokio::test]
    async fn a_callback_that_is_not_ours_after_sign_in_is_refused_without_echo() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let wait = tokio::spawn(loopback.wait_for_code(
            "real-state",
            Duration::from_secs(5),
            Duration::from_secs(5),
        ));
        request(port, "/oauth2callback?code=the-code&state=real-state").await;
        wait.await.unwrap().unwrap();

        for target in [
            "/oauth2callback?code=another-code&state=guessed-state",
            "/oauth2callback?code=another-code",
            "/oauth2callback",
        ] {
            let response = request(port, target).await;
            assert!(
                response.starts_with("HTTP/1.1 400 Bad Request"),
                "{response}"
            );
            assert!(response.contains("Sign-in refused"), "{response}");
            assert!(!response.contains("another-code"), "{response}");
            assert!(!response.contains("guessed-state"), "{response}");
        }
        let elsewhere = request(port, "/favicon.ico").await;
        assert!(
            elsewhere.starts_with("HTTP/1.1 404 Not Found"),
            "{elsewhere}"
        );
    }

    /// The port closes when the grace window ends, even with a connection held
    /// open that never sends a request.
    #[tokio::test]
    async fn the_port_is_released_when_the_grace_window_ends() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let grace = Duration::from_millis(200);
        let wait =
            tokio::spawn(loopback.wait_for_code("real-state", Duration::from_secs(5), grace));
        request(port, "/oauth2callback?code=the-code&state=real-state").await;
        wait.await.unwrap().unwrap();
        let _silent = TcpStream::connect(("127.0.0.1", port)).await.unwrap();

        tokio::time::sleep(grace * 2).await;
        assert!(
            TcpStream::connect(("127.0.0.1", port)).await.is_err(),
            "port {port} is still accepting after the grace window"
        );
    }

    /// A callback that ends the sign-in with an error closes the port straight
    /// away, with no grace window, even with a silent connection held open.
    #[tokio::test]
    async fn the_port_is_released_as_soon_as_the_sign_in_fails() {
        let loopback = Loopback::bind().await.unwrap();
        let port = Url::parse(loopback.redirect_uri()).unwrap().port().unwrap();
        let wait = tokio::spawn(loopback.wait_for_code(
            "real-state",
            Duration::from_secs(5),
            Duration::from_secs(5),
        ));
        let _silent = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let response = request(port, "/oauth2callback?code=a-code&state=guessed-state").await;
        assert!(response.contains("Sign-in refused"), "{response}");
        assert!(matches!(wait.await.unwrap(), Err(AuthError::StateMismatch)));
        assert!(
            TcpStream::connect(("127.0.0.1", port)).await.is_err(),
            "port {port} is still accepting after the sign-in failed"
        );
    }

    #[tokio::test]
    async fn the_redirect_uri_names_the_port_that_is_already_listening() {
        let loopback = Loopback::bind().await.unwrap();
        let uri = loopback.redirect_uri().to_owned();
        assert!(uri.starts_with("http://127.0.0.1:"), "{uri}");
        assert!(uri.ends_with(CALLBACK_PATH), "{uri}");
        // The port is bound, so connecting to it succeeds while the listener lives.
        let parsed = Url::parse(&uri).unwrap();
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", parsed.port().unwrap()))
                .await
                .is_ok()
        );
    }
}
