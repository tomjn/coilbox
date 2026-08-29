//! Zero-K's lobby protocol, as Rust types.
//!
//! Zero-K's protocol has no published schema. It is defined by C# classes in
//! [ZeroK-RTS/Zero-K-Infrastructure][repo], which the server serialises to JSON
//! and sends down the wire, so this crate vendors that C# at a pinned commit and
//! generates the Rust from it at build time. `upstream/README.md` covers how a
//! refresh works. Nothing here does any IO.
//!
//! [repo]: https://github.com/ZeroK-RTS/Zero-K-Infrastructure
//!
//! # Reading a message
//!
//! [`ZerokMessage::decode`] takes a command name and its JSON body and answers a
//! typed message. It is total: a name this build has never heard of, or a body
//! that does not fit, comes back as [`ZerokMessage::Unknown`] or
//! [`ZerokMessage::Invalid`] rather than an error, because Zero-K's live server
//! is free to be ahead of the pinned commit and a line we cannot parse is still
//! a line worth showing.
//!
//! # Writing one
//!
//! Every command implements [`Command`], which carries the name it goes out
//! under and the side allowed to send it.
//!
//! # What the types look like, and why
//!
//! Upstream's serialiser sets `NullValueHandling.Ignore`, so a null member is
//! left out of the JSON entirely. Every reference member is therefore
//! `Option<T>`, whether or not C# marks it nullable, and a value member is
//! `Option<T>` only when it does. A member the server leaves out reads as the
//! same default C# would have given it.
//!
//! An enum goes over the wire as a number, because upstream registers no string
//! converter. Each generated enum has an `Other(i32)` variant, so a value added
//! upstream since the pinned commit costs one field rather than the whole
//! message.
//!
//! A `DateTime` is a `String`. Json.NET round-trips the kind, so a UTC one ends
//! in `Z`, a local one carries an offset and an unspecified one carries neither.
//! A type that insisted on RFC 3339 would refuse the third.
//!
//! # What coilbox will not carry
//!
//! Every command in this crate is generated, so a message coilbox does nothing
//! with is still parsed and still shows in the protocol console. Most of those
//! are a gap waiting to be filled, which is what the `lobby-protocol-gap` label
//! tracks. Two families are not, and are worth naming here so they are not
//! mistaken for one.
//!
//! **Steam authentication.** `Login` and `Register` both carry a
//! `SteamAuthToken`, and coilbox never sets it. A ticket is only valid for the
//! Steam App ID it was minted under and the server checks Zero-K's, so a
//! third-party client can only do this by introducing itself to Steam as Zero-K.
//! Steam sign-in is bound up with account identity, ban evasion checks and the
//! VPN exemption on Zero-K's server, and it belongs to that project rather than
//! to us. Coilbox signs in with a name and password and says so on the login
//! form. See coilbox issue #1988.
//!
//! **Planet Wars.** The `Pw*` commands, `JoinFactionRequest`, `Welcome`'s
//! faction list and `User::faction` are Zero-K's persistent metagame: a
//! campaign map, faction membership, attack charges and the votes that pick a
//! planet to fight over. It is theirs to run, its state lives on their server
//! and their website, and a lobby client that half implemented it would be a
//! worse way to play it than the one they already ship. Coilbox reads these off
//! the wire and does nothing with them, deliberately and not for now.
//!
//! `AutohostMode::Planetwars` is the exception that proves it. That is a battle
//! mode a room can be in, which the battle list shows like any other, and
//! showing it is not taking part.

/// The wire line, which is a command name, a space and a JSON object.
pub mod line;

/// The generated types, one per C# class or enum a command can reach.
pub mod types {
    #![allow(clippy::doc_markdown, clippy::struct_excessive_bools)]
    include!(concat!(env!("OUT_DIR"), "/types.rs"));
}

include!(concat!(env!("OUT_DIR"), "/dispatch.rs"));

/// Which side of the connection may send a command.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// Only the server sends it.
    Server,
    /// Only a client sends it.
    Client,
    /// Either side does.
    Both,
}

/// A message the protocol names, so it can go out as a wire line.
pub trait Command: serde::Serialize {
    /// The name the command travels under, which is upstream's class name.
    const NAME: &'static str;
    /// The side allowed to send it.
    const DIRECTION: Direction;
}

/// The commit of `ZeroK-RTS/Zero-K-Infrastructure` the types were generated
/// from, so a bug report can say which one it saw.
pub const UPSTREAM_COMMIT: &str = include_str!("../upstream/upstream-version.txt");

#[cfg(test)]
mod tests;
