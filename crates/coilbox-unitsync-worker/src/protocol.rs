//! How the plugin talks to a worker that stays running (issue #3722).
//!
//! A worker started with [`SERVE_FLAG`] reads one request per line on its
//! standard input and answers each on its standard output. Both ends are in
//! this file so they cannot drift apart.
//!
//! A request is one line of JSON: an id and the argument list a one-shot worker
//! would have been started with.
//!
//! A reply is a frame:
//!
//! ```text
//! <newline>
//! @coilbox-unitsync <token> {"id":7,"code":0,"len":1234}<newline>
//! <1234 bytes><newline>
//! ```
//!
//! The engine's library shares the worker's standard output, and nothing stops
//! it printing there. So a reply is never "whatever came out". The reader skips
//! every line that does not start with the marker and the token, and takes the
//! reply's bytes by length. The token is made up by the plugin for each worker
//! it starts and handed over in [`TOKEN_ENV`], so text an archive manages to get
//! printed cannot pass for a frame. The id says which request the reply answers.

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

/// The first argument of a worker that stays running.
pub const SERVE_FLAG: &str = "--serve";

/// The environment variable the plugin puts a new worker's token in.
pub const TOKEN_ENV: &str = "COILBOX_UNITSYNC_SERVE_TOKEN";

/// The only argument of a request that is not a read: nothing is waiting for
/// this worker, so it lets go of the game it kept mounted for the next read
/// (issue #3728). It gets no reply.
pub const RELEASE_FLAG: &str = "--release";

/// What every frame's header line starts with.
pub const MARKER: &str = "@coilbox-unitsync";

/// How long a worker waits for another process's `Init` or `UnInit` before going
/// ahead without the engine's init lock. `initlock.rs` in the worker says where
/// the figure comes from. It lives here so the plugin, which waits for a
/// worker's `UnInit` on the way out, reads the same value.
pub const INIT_LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(60);

/// One read asked of a running worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    /// The arguments a one-shot worker would be started with for this read.
    pub args: Vec<String>,
}

/// How long one `Init` took, for the plugin's dev log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct InitTiming {
    /// Time spent queued behind another process's `Init`.
    pub lock_wait_ms: u64,
    pub call_ms: u64,
}

/// A reply's header: which request it answers and how it went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplyHead {
    pub id: u64,
    /// The exit code a one-shot worker would have ended with.
    pub code: i32,
    /// Set when answering this request ran `Init`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub init: Option<InitTiming>,
    /// How long each mount of an archive set took while answering this request,
    /// in milliseconds. One entry per `AddAllArchives` call, for the plugin's
    /// dev log (issue #3728).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mount_ms: Vec<u64>,
}

/// The header as it is written, with the length of the bytes that follow.
#[derive(Serialize, Deserialize)]
struct WireHead {
    #[serde(flatten)]
    head: ReplyHead,
    len: usize,
}

/// Write one request and flush it, so the worker sees it now.
pub fn write_request(out: &mut impl Write, request: &Request) -> io::Result<()> {
    let line = serde_json::to_string(request).map_err(io::Error::other)?;
    out.write_all(line.as_bytes())?;
    out.write_all(b"\n")?;
    out.flush()
}

/// Read the next request. `Ok(None)` when the input has closed, which is how a
/// worker learns the plugin has gone.
pub fn read_request(input: &mut impl BufRead) -> io::Result<Option<Request>> {
    loop {
        let mut line = String::new();
        if input.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if line.trim().is_empty() {
            continue;
        }
        return serde_json::from_str(&line)
            .map(Some)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e));
    }
}

/// Write one reply frame and flush it.
///
/// The frame opens with a newline so its header starts a line even when the
/// engine left half a line behind it.
pub fn write_reply(
    out: &mut impl Write,
    token: &str,
    head: &ReplyHead,
    payload: &[u8],
) -> io::Result<()> {
    let wire = WireHead {
        head: head.clone(),
        len: payload.len(),
    };
    let header = serde_json::to_string(&wire).map_err(io::Error::other)?;
    let mut frame = Vec::with_capacity(payload.len() + header.len() + token.len() + 32);
    frame.push(b'\n');
    frame.extend_from_slice(MARKER.as_bytes());
    frame.push(b' ');
    frame.extend_from_slice(token.as_bytes());
    frame.push(b' ');
    frame.extend_from_slice(header.as_bytes());
    frame.push(b'\n');
    frame.extend_from_slice(payload);
    frame.push(b'\n');
    out.write_all(&frame)?;
    out.flush()
}

/// Read the next reply frame, skipping everything that is not one.
///
/// `Ok(None)` when the output closed between frames, which is a worker that has
/// exited. An `Err` is a frame that started and did not finish as one: a header
/// that does not parse, or fewer bytes than it promised. The caller cannot trust
/// anything after either, so both end the worker.
pub fn read_reply(
    input: &mut impl BufRead,
    token: &str,
) -> io::Result<Option<(ReplyHead, Vec<u8>)>> {
    let prefix = format!("{MARKER} {token} ");
    loop {
        match line_start(input, prefix.as_bytes())? {
            LineStart::Closed => return Ok(None),
            LineStart::Other { ended: true } => continue,
            LineStart::Other { ended: false } => {
                if input.skip_until(b'\n')? == 0 {
                    return Ok(None);
                }
                continue;
            }
            LineStart::Frame => {}
        }
        let mut header = Vec::new();
        input.read_until(b'\n', &mut header)?;
        if header.pop() != Some(b'\n') {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "the output closed in the middle of a reply's header",
            ));
        }
        let wire: WireHead = serde_json::from_slice(&header).map_err(|e| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("a reply's header does not parse: {e}"),
            )
        })?;
        let mut payload = vec![0u8; wire.len];
        input.read_exact(&mut payload).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!("the output closed in the middle of a reply: {e}"),
            )
        })?;
        let mut end = [0u8; 1];
        input.read_exact(&mut end)?;
        if end[0] != b'\n' {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "a reply is longer than its header said",
            ));
        }
        return Ok(Some((wire.head, payload)));
    }
}

/// What the line the reader is at the start of turned out to be.
enum LineStart {
    /// The input closed.
    Closed,
    /// It starts with the marker and the token, both now consumed.
    Frame,
    /// Something else. `ended` when the byte that gave it away was the newline.
    Other { ended: bool },
}

/// Consume the start of a line for as long as it matches `prefix`.
///
/// A byte at a time and keeping none of them, so a line of any length that is
/// not a frame costs no memory.
fn line_start(input: &mut impl BufRead, prefix: &[u8]) -> io::Result<LineStart> {
    for &want in prefix {
        let got = match input.fill_buf()?.first() {
            Some(&byte) => byte,
            None => return Ok(LineStart::Closed),
        };
        input.consume(1);
        if got != want {
            return Ok(LineStart::Other {
                ended: got == b'\n',
            });
        }
    }
    Ok(LineStart::Frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TOKEN: &str = "0123456789abcdef";

    fn head(id: u64) -> ReplyHead {
        ReplyHead {
            id,
            code: 0,
            init: None,
            mount_ms: Vec::new(),
        }
    }

    fn frame(token: &str, head: &ReplyHead, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        write_reply(&mut out, token, head, payload).unwrap();
        out
    }

    #[test]
    fn a_request_survives_the_trip() {
        let request = Request {
            id: 42,
            args: vec!["--map".into(), "a map\nwith a newline".into()],
        };
        let mut wire = Vec::new();
        write_request(&mut wire, &request).unwrap();
        assert_eq!(
            wire.iter().filter(|&&b| b == b'\n').count(),
            1,
            "one request is one line, whatever its arguments hold"
        );
        let mut input = Cursor::new(wire);
        assert_eq!(read_request(&mut input).unwrap(), Some(request));
        assert_eq!(read_request(&mut input).unwrap(), None);
    }

    #[test]
    fn a_request_that_is_not_json_is_an_error() {
        let mut input = Cursor::new(b"--map foo\n".to_vec());
        assert!(read_request(&mut input).is_err());
    }

    #[test]
    fn a_reply_survives_the_trip() {
        let sent = ReplyHead {
            id: 7,
            code: 1,
            init: Some(InitTiming {
                lock_wait_ms: 3,
                call_ms: 190,
            }),
            mount_ms: vec![41, 3],
        };
        let payload = b"{\"errors\":[]}\n";
        let mut input = Cursor::new(frame(TOKEN, &sent, payload));
        let (got, bytes) = read_reply(&mut input, TOKEN).unwrap().unwrap();
        assert_eq!(got, sent);
        assert_eq!(bytes, payload);
        assert!(read_reply(&mut input, TOKEN).unwrap().is_none());
    }

    #[test]
    fn replies_are_read_one_at_a_time_in_order() {
        let mut wire = frame(TOKEN, &head(1), b"first");
        wire.extend(frame(TOKEN, &head(2), b""));
        wire.extend(frame(TOKEN, &head(3), b"third"));
        let mut input = Cursor::new(wire);
        let mut seen = Vec::new();
        while let Some((head, bytes)) = read_reply(&mut input, TOKEN).unwrap() {
            seen.push((head.id, String::from_utf8(bytes).unwrap()));
        }
        assert_eq!(
            seen,
            vec![
                (1, "first".to_string()),
                (2, String::new()),
                (3, "third".to_string())
            ]
        );
    }

    #[test]
    fn what_the_engine_prints_is_not_a_reply() {
        let mut wire = b"Scanning: /maps\n[f=0] a line with no end".to_vec();
        wire.extend(frame(TOKEN, &head(5), b"the answer"));
        wire.extend_from_slice(b"\n\ntrailing noise\n");
        let mut input = Cursor::new(wire);
        let (got, bytes) = read_reply(&mut input, TOKEN).unwrap().unwrap();
        assert_eq!(got.id, 5);
        assert_eq!(bytes, b"the answer");
        assert!(read_reply(&mut input, TOKEN).unwrap().is_none());
    }

    #[test]
    fn a_frame_under_another_token_is_not_a_reply() {
        // What a hostile archive could get printed: a whole, well formed frame.
        // It does not know this worker's token.
        let mut wire = frame("ffffffffffffffff", &head(5), b"forged");
        wire.extend(frame(TOKEN, &head(5), b"real"));
        let mut input = Cursor::new(wire);
        let (_, bytes) = read_reply(&mut input, TOKEN).unwrap().unwrap();
        assert_eq!(bytes, b"real");
    }

    #[test]
    fn a_payload_that_looks_like_a_frame_is_still_payload() {
        let inner = frame(TOKEN, &head(99), b"nested");
        let mut input = Cursor::new(frame(TOKEN, &head(1), &inner));
        let (got, bytes) = read_reply(&mut input, TOKEN).unwrap().unwrap();
        assert_eq!(got.id, 1);
        assert_eq!(bytes, inner);
        assert!(read_reply(&mut input, TOKEN).unwrap().is_none());
    }

    #[test]
    fn a_reply_cut_short_is_an_error() {
        let whole = frame(TOKEN, &head(1), b"a reply that is cut off");
        let mut input = Cursor::new(whole[..whole.len() - 8].to_vec());
        assert!(read_reply(&mut input, TOKEN).is_err());
    }

    #[test]
    fn a_header_that_does_not_parse_is_an_error() {
        let wire = format!("\n{MARKER} {TOKEN} not json at all\n").into_bytes();
        let mut input = Cursor::new(wire);
        let err = read_reply(&mut input, TOKEN).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn a_reply_longer_than_its_header_says_is_an_error() {
        let wire = format!("\n{MARKER} {TOKEN} {{\"id\":1,\"code\":0,\"len\":2}}\nabcdef\n");
        let mut input = Cursor::new(wire.into_bytes());
        let err = read_reply(&mut input, TOKEN).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }
}
