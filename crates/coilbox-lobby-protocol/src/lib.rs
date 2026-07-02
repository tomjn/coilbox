//! Pure, IO-free TASServer / Recoil lobby protocol engine.
//!
//! This crate owns the *protocol* and the *authoritative lobby state* — it takes
//! server lines in and returns typed messages and state deltas out. It performs no
//! IO: the socket, TLS and Tauri IPC live in `tauri-plugin-coilbox-multiplayer`,
//! which drives this crate. Keeping it pure is what lets the bitfields, the parser
//! and the state reducer be golden-tested in isolation (mirrors the `anim` crate).
//!
//! Modules are filled in incrementally; see the crate's implementation plan.

// Scaffold: module surface is added by the implementation. Kept empty so the
// workspace compiles before the protocol engine lands.
