//! The replay track file, `.cbtrack`: where everything was during one replay,
//! recorded once and played back in either direction.
//!
//! The format is specified in `docs/reference/replay-track-format.md`. This
//! crate does no IO of its own. It works on byte slices and on `Read`, `Write`
//! and `Seek`, and has no dependency on Tauri.
//!
//! # Writing
//!
//! Fill in a [`Track`] with each entity's keys over the whole match, in the
//! file's own units, and call [`Track::to_bytes`] or [`Track::write_to`]. The
//! writer cuts the match into windows and adds the keys a window needs at its
//! edges. A [`Quantiser`] converts elmos, elmos per frame and quaternions to
//! the whole numbers a key holds, and back. The thinning that decides which
//! keys to give the writer checks its tolerance against the values the
//! quantiser gives back, since those are what a reader sees.
//!
//! # Reading
//!
//! [`TrackReader::open`] reads the header and the window index. After that,
//! [`TrackReader::window`] reads one window and [`TrackReader::sample`] gives
//! every unit and projectile at a frame. [`TrackReader::window_chunk`] gives
//! a window's columns as they are in the file, for a caller that wants typed
//! arrays and not keys.

mod chunk;
mod curve;
mod error;
mod header;
mod keys;
mod meta;
mod quant;
mod reader;
mod terrain;
mod track;
mod window;

pub use chunk::{compress, decompress, Chunk, Column};
pub use curve::{held, pose_at, projectile_at, status_at, transform_at};
pub use error::{Result, TrackError};
pub use header::{
    Extent, Header, Settings, WindowEntry, BLOCK_SIZE, FORMAT_VERSION, HEADER_SIZE,
    INDEX_ENTRY_SIZE, MAGIC,
};
pub use keys::*;
pub use quant::{
    quaternion_from_front_up, Quantiser, ANGLE_UNITS_PER_TURN, FRACTION_FULL, VALUE_LIMIT,
};
pub use reader::TrackReader;
pub use terrain::apply_terrain;
pub use track::Track;
pub use window::{
    FrameState, PoseState, ProjectileState, TargetState, UnitState, Window, WindowProjectile,
    WindowUnit,
};
