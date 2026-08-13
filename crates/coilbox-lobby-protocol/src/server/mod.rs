//! The server half of the protocol: read client lines, write server lines.
//!
//! The rest of the crate is a client. It parses what a server says
//! ([`crate::parse_line`]) and builds what a client sends ([`crate::command`]).
//! Hosting a battle with no lobby server needs the other two corners of that
//! square, and nothing else: a host that produces the same lines a real server
//! would produce is a host every existing client path already understands.
//!
//! Still IO free, like the rest of the crate. Sockets, peers and disconnects
//! belong to the plugin that drives this.
//!
//! # Ordering
//!
//! `SETSCRIPTTAGS`, `REMOVESCRIPTTAGS`, `ADDSTARTRECT` and `REMOVESTARTRECT`
//! carry no battle id. A client applies them to whichever battle it is currently
//! in, so they are only meaningful after that client's own `JOINBATTLE` or
//! `OPENBATTLE` acknowledgement. Sent before it, they are silently dropped and
//! the joiner sits in a room with no start boxes and no game options.

mod client;
pub mod line;
mod room;

pub use client::{parse_client_line, ClientCommand};
pub use line::BattleOpened;
pub use room::{Outbound, PeerId, PendingJoin, RoomConfig, RoomState};
