//! Pure, IO-free Tachyon lobby protocol types and parser.
//!
//! Tachyon is the protocol Teiserver is replacing the TASServer protocol with.
//! It is a WebSocket protocol carrying JSON messages, and it is defined by JSON
//! Schema rather than by a written document. We vendor the schema bundle at
//! `schema/compiled.json` and generate the types from it in `build.rs`, so the
//! types are the specification rather than a reading of it. See
//! `schema/README.md` for the upstream version and the one local patch.
//!
//! This crate is the Tachyon counterpart of `coilbox-lobby-protocol`. It owns
//! parsing only. The WebSocket, the authentication and the reduction into
//! `LobbyState` live elsewhere.
//!
//! # The generated root type is meant to look wrong
//!
//! The bundle is one top-level `anyOf` of 166 command schemas. Typify turns
//! that into [`types::TachyonCommand`], a struct of 166 flattened `Option`
//! fields.
//!
//! That is expected typify behaviour for a large top-level `anyOf`, not a
//! broken build. `TachyonCommand` cannot discriminate anything, so nothing
//! should reference it. Use [`parse_frame`] and the per-command types instead,
//! which are the good part of the same output: `LobbyJoinRequest` is a struct,
//! and `LobbyJoinResponse` is an enum over the success and failure shapes.
//!
//! # A failed response carries its reason as a string
//!
//! The schema lists the reasons each command can fail with, but `build.rs`
//! loosens those lists to plain strings before generating. A generated enum is
//! closed, so a reason a newer server has and the vendored bundle does not
//! would fail the whole response, turning a refusal we could have shown into an
//! unreadable frame. It also removed 68 near-duplicate enums, one per response,
//! because the reasons are inlined per command and most list the same four. See
//! `loosen_failure_reasons` in `build.rs`.
//!
//! # Surface
//!
//! - [`parse_frame`] turns a raw text frame into a typed [`TachyonMessage`].
//! - [`Envelope`] is the hand-written first pass, the three fields every
//!   message carries.
//! - [`types`] holds the generated per-command types.
//! - [`merge_patch`] holds the `lobby/updated` patch types, which are hand
//!   written because typify cannot express them, and the function that applies
//!   one to a lobby.

use serde::{Deserialize, Serialize};

pub mod merge_patch;

/// Types generated from the vendored schema bundle. See the note above about
/// [`types::TachyonCommand`].
pub mod types {
    #![allow(clippy::all)]
    include!(concat!(env!("OUT_DIR"), "/types.rs"));
}

include!(concat!(env!("OUT_DIR"), "/dispatch.rs"));

/// The `type` field of the envelope, which says which direction of a command
/// this message is.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    /// A command asking for something. Either side may send one.
    Request,
    /// The answer to a request, carrying the same message id.
    Response,
    /// An unsolicited message, sent because of a subscription.
    Event,
}

/// The three fields every Tachyon message carries, whatever the command.
///
/// This is the first parsing pass. The rest of the message, `data` and the
/// response's `status`, `reason` and `details`, is ignored here and read in the
/// second pass by the per-command type.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Envelope {
    /// Which direction of the command this is.
    #[serde(rename = "type")]
    pub kind: MessageKind,
    /// Correlates a response with its request. Unique per connection.
    #[serde(rename = "messageId")]
    pub message_id: String,
    /// The command, such as `lobby/join`.
    #[serde(rename = "commandId")]
    pub command_id: String,
}

/// Turns a raw text frame into a typed message.
///
/// Parsing is total and never fails, mirroring `parse_line` in
/// `coilbox-lobby-protocol`. A frame we cannot place lands in
/// [`TachyonMessage::Unknown`] or [`TachyonMessage::Invalid`] rather than
/// stopping the connection, because the protocol is at v0 and the server is
/// free to be ahead of the vendored schema.
///
/// Two passes. Read the [`Envelope`], then deserialise the whole frame into the
/// type the pair of command id and kind names.
pub fn parse_frame(raw: &str) -> TachyonMessage {
    let Ok(envelope) = serde_json::from_str::<Envelope>(raw) else {
        return TachyonMessage::Unknown {
            raw: raw.to_string(),
        };
    };

    match TachyonMessage::decode(&envelope, raw) {
        Some(Ok(message)) => message,
        Some(Err(error)) => TachyonMessage::Invalid {
            command_id: envelope.command_id,
            raw: raw.to_string(),
            error: error.to_string(),
        },
        None => TachyonMessage::Unknown {
            raw: raw.to_string(),
        },
    }
}

#[cfg(test)]
mod tests;
