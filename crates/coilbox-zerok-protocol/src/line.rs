//! The wire line: a command name, one space, and a JSON object.
//!
//! Upstream's `CommandJsonSerializer` writes the name, a space, the JSON and a
//! newline, and reads a line back by splitting it into two parts on the first
//! space. The body is a JSON object with spaces of its own, so splitting on
//! every space instead of the first is the mistake this module exists to make
//! impossible.
//!
//! Neither function here handles the trailing newline. A line goes out through
//! `LinesCodec`, which appends the delimiter, and arrives with it already
//! stripped.

use crate::{Command, ZerokMessage};

/// Split a wire line into the command name and the JSON body.
///
/// `None` when the line has no space in it, which upstream treats as a protocol
/// error. Leading spaces are skipped, because .NET's `RemoveEmptyEntries` does.
pub fn split_line(line: &str) -> Option<(&str, &str)> {
    let line = line.trim_start_matches(' ');
    let at = line.find(' ')?;
    Some((&line[..at], &line[at + 1..]))
}

/// Parse a whole wire line into a message.
///
/// `None` only when the line is not a line: no space, so no command name and no
/// body. Everything past that point is total, because a command this build does
/// not know is still worth showing. See [`ZerokMessage::decode`].
pub fn parse_line(line: &str) -> Option<ZerokMessage> {
    let (name, body) = split_line(line)?;
    Some(ZerokMessage::decode(name, body))
}

/// Build the wire line for a command, without its trailing newline.
///
/// Fails only if the command cannot be serialised, which for a generated type
/// would mean a map keyed by something other than a string. None of them has
/// one.
pub fn to_line<C: Command>(command: &C) -> Result<String, serde_json::Error> {
    Ok(format!("{} {}", C::NAME, serde_json::to_string(command)?))
}

/// Whether a line can go out as one line.
///
/// A line break inside a command would be read by the server as the end of the
/// message and the start of another, so a name or a body carrying one has to be
/// refused rather than sent. Nothing generated can produce one, because
/// `serde_json` escapes a break inside a string, and this is the last check
/// before the socket.
pub fn is_wire_safe(line: &str) -> bool {
    !line.contains('\n') && !line.contains('\r')
}
