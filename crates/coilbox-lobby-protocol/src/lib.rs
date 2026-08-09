//! Pure, IO-free TASServer / Recoil lobby protocol engine.
//!
//! This crate owns the *protocol* and the *authoritative lobby state* — it takes
//! server lines in and returns typed messages and state deltas out. It performs no
//! IO: the socket, TLS and Tauri IPC live in `tauri-plugin-coilbox-multiplayer`,
//! which drives this crate. Keeping it pure is what lets the bitfields, the parser
//! and the state reducer be golden-tested in isolation (mirrors the `anim` crate).
//!
//! # Surface
//! - [`parse_line`] turns a raw server line into a typed [`ServerMessage`].
//! - The [`command`] module builds outgoing wire lines (no trailing newline).
//! - [`ClientStatus`] / [`BattleStatus`] pack and unpack the status bitfields.
//! - [`password_hash`] computes the login password hash.
//! - [`reduce`] applies a [`ServerMessage`] to [`LobbyState`], emitting [`Delta`]s.
//! - [`LoginMachine`] drives the reply-driven login handshake.

pub mod command;
mod hash;
mod login;
mod message;
mod reduce;
mod state;
mod status;
mod vote;

pub use hash::password_hash;
pub use login::{LoginConfig, LoginMachine, LoginMode, LoginPhase};
pub use message::{parse_line, ServerMessage};
pub use reduce::{
    begin_channel_list, push_chat, push_dm, record_outgoing_private, reduce, reduce_at, Delta,
};
pub use state::{
    Battle, Bot, ChannelState, ChatKind, ChatMsg, DirChannel, LobbyState, MemberStatus, StartRect,
    User, Vote,
};
pub use status::{
    default_battle_status, team_color_from_rgb, team_color_rgb, BattleStatus, ClientStatus,
};
