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
