//! The 96 byte header and the window index.

use crate::error::{Result, TrackError};
use crate::quant::{check_limit, Quantiser, VALUE_LIMIT};

pub const MAGIC: [u8; 4] = *b"CBTK";
pub const FORMAT_VERSION: u16 = 1;
/// The header's size in format version 1.
pub const HEADER_SIZE: usize = 96;
/// Every chunk starts at a multiple of this many bytes.
pub const BLOCK_SIZE: u64 = 64;
/// The size of one entry in the window index.
pub const INDEX_ENTRY_SIZE: usize = 16;

/// Where a chunk is: its block number, so its offset is `block * 64`, and its
/// length in bytes. A length of 0 means the chunk is not there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Extent {
    pub block: u32,
    pub length: u32,
}

impl Extent {
    pub fn offset(&self) -> u64 {
        self.block as u64 * BLOCK_SIZE
    }
}

/// One window's chunks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WindowEntry {
    pub main: Extent,
    /// Length 0 when no terrain changed in the window.
    pub terrain: Extent,
}

/// What a writer chooses. The header's other fields come from the content.
#[derive(Debug, Clone, PartialEq)]
pub struct Settings {
    /// Changes when the recorder would produce different keys from the same
    /// replay.
    pub recorder_version: u16,
    /// The simulation's frames per second. The engine's `GAME_SPEED` is 30.
    pub frames_per_second: u16,
    pub first_frame: u32,
    pub last_frame: u32,
    /// 1 to 65,535 frames, so an offset in a window fits 16 bits.
    pub window_length: u32,
    /// In elmos. No recorded sample is further than this from the track.
    pub tolerance: f32,
    pub position_shift: u8,
    pub velocity_shift: u8,
    /// 8 to 16.
    pub rotation_bits: u8,
    /// Frames between the recorder's unit samples. For information only.
    pub sample_interval: u8,
    /// The replay's game id, copied from the replay header.
    pub game_id: [u8; 16],
}

impl Default for Settings {
    /// The rules a version 1 writer uses for a tolerance of 0.5 elmo: a
    /// position step of 1/8 elmo, a velocity step of 1/2048 elmo per frame,
    /// 12 rotation bits and windows of 900 frames.
    fn default() -> Self {
        Self {
            recorder_version: 0,
            frames_per_second: 30,
            first_frame: 0,
            last_frame: 0,
            window_length: 900,
            tolerance: 0.5,
            position_shift: 3,
            velocity_shift: 11,
            rotation_bits: 12,
            sample_interval: 0,
            game_id: [0; 16],
        }
    }
}

impl Settings {
    pub fn quantiser(&self) -> Result<Quantiser> {
        Quantiser::new(self.position_shift, self.velocity_shift, self.rotation_bits)
    }

    pub(crate) fn check(&self) -> Result<()> {
        self.quantiser()?;
        if !(1..=65_535).contains(&self.window_length) {
            return Err(TrackError::invalid(format!(
                "the window length must be 1 to 65535 frames, not {}",
                self.window_length
            )));
        }
        if self.last_frame < self.first_frame {
            return Err(TrackError::invalid(format!(
                "the last frame, {}, is before the first, {}",
                self.last_frame, self.first_frame
            )));
        }
        if !self.tolerance.is_finite() || self.tolerance < 0.0 {
            return Err(TrackError::invalid(
                "the tolerance must be a number that is not negative",
            ));
        }
        check_limit(|| "the last frame".into(), self.last_frame as i64)?;
        Ok(())
    }

    pub fn window_count(&self) -> u32 {
        window_count(self.first_frame, self.last_frame, self.window_length)
    }

    /// The first and last frame of window `k`. A frame on the boundary is in
    /// both windows either side of it.
    pub fn window_bounds(&self, k: u32) -> (u32, u32) {
        window_bounds(self.first_frame, self.last_frame, self.window_length, k)
    }
}

pub(crate) fn window_count(first: u32, last: u32, length: u32) -> u32 {
    (last - first).div_ceil(length).max(1)
}

pub(crate) fn window_bounds(first: u32, last: u32, length: u32, k: u32) -> (u32, u32) {
    let start = first + k * length;
    (start, (start + length).min(last))
}

/// The header of a track file.
#[derive(Debug, Clone, PartialEq)]
pub struct Header {
    /// The size the file states. A later writer may add fields after byte 96.
    pub header_size: u16,
    pub recorder_version: u16,
    pub frames_per_second: u16,
    pub first_frame: u32,
    pub last_frame: u32,
    pub window_length: u32,
    pub window_count: u32,
    pub tolerance: f32,
    pub position_shift: u8,
    pub velocity_shift: u8,
    pub rotation_bits: u8,
    pub sample_interval: u8,
    pub info: Extent,
    pub features: Extent,
    pub unit_count: u32,
    pub projectile_count: u32,
    pub feature_count: u32,
    pub game_id: [u8; 16],
}

impl Header {
    pub fn quantiser(&self) -> Result<Quantiser> {
        Quantiser::new(self.position_shift, self.velocity_shift, self.rotation_bits)
    }

    /// The window that holds `frame`. A frame on a boundary is in two
    /// windows, and this gives the earlier. A frame past the end is in the
    /// last window and one before the start is in the first.
    pub fn window_of_frame(&self, frame: u32) -> u32 {
        let k = frame.saturating_sub(self.first_frame) / self.window_length;
        k.min(self.window_count - 1)
    }

    /// The first and last frame of window `k`.
    pub fn window_bounds(&self, k: u32) -> (u32, u32) {
        window_bounds(self.first_frame, self.last_frame, self.window_length, k)
    }

    pub(crate) fn encode(&self) -> [u8; HEADER_SIZE] {
        let mut b = [0u8; HEADER_SIZE];
        b[0..4].copy_from_slice(&MAGIC);
        b[4..6].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
        b[6..8].copy_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
        b[8..10].copy_from_slice(&self.recorder_version.to_le_bytes());
        b[10..12].copy_from_slice(&self.frames_per_second.to_le_bytes());
        b[12..16].copy_from_slice(&self.first_frame.to_le_bytes());
        b[16..20].copy_from_slice(&self.last_frame.to_le_bytes());
        b[20..24].copy_from_slice(&self.window_length.to_le_bytes());
        b[24..28].copy_from_slice(&self.window_count.to_le_bytes());
        b[28..32].copy_from_slice(&self.tolerance.to_le_bytes());
        b[32] = self.position_shift;
        b[33] = self.velocity_shift;
        b[34] = self.rotation_bits;
        b[35] = self.sample_interval;
        b[36..40].copy_from_slice(&self.info.block.to_le_bytes());
        b[40..44].copy_from_slice(&self.info.length.to_le_bytes());
        b[44..48].copy_from_slice(&self.features.block.to_le_bytes());
        b[48..52].copy_from_slice(&self.features.length.to_le_bytes());
        b[52..56].copy_from_slice(&self.unit_count.to_le_bytes());
        b[56..60].copy_from_slice(&self.projectile_count.to_le_bytes());
        b[60..64].copy_from_slice(&self.feature_count.to_le_bytes());
        b[64..80].copy_from_slice(&self.game_id);
        b
    }

    /// Reads the fixed part of a header. A file whose magic or version is not
    /// known is refused by name before anything else is looked at.
    pub(crate) fn decode(b: &[u8; HEADER_SIZE]) -> Result<Self> {
        if b[0..4] != MAGIC {
            return Err(TrackError::UnknownLayout {
                field: "magic",
                found: format!("{:?}", String::from_utf8_lossy(&b[0..4])),
                expected: format!("{:?}", String::from_utf8_lossy(&MAGIC)),
            });
        }
        let u16_at = |at: usize| u16::from_le_bytes([b[at], b[at + 1]]);
        let u32_at = |at: usize| u32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        let version = u16_at(4);
        if version != FORMAT_VERSION {
            return Err(TrackError::UnknownLayout {
                field: "version",
                found: version.to_string(),
                expected: FORMAT_VERSION.to_string(),
            });
        }
        let header_size = u16_at(6);
        if (header_size as usize) < HEADER_SIZE {
            return Err(TrackError::UnknownLayout {
                field: "header size",
                found: header_size.to_string(),
                expected: format!("{HEADER_SIZE} or more"),
            });
        }
        let h = Header {
            header_size,
            recorder_version: u16_at(8),
            frames_per_second: u16_at(10),
            first_frame: u32_at(12),
            last_frame: u32_at(16),
            window_length: u32_at(20),
            window_count: u32_at(24),
            tolerance: f32::from_le_bytes(b[28..32].try_into().unwrap()),
            position_shift: b[32],
            velocity_shift: b[33],
            rotation_bits: b[34],
            sample_interval: b[35],
            info: Extent {
                block: u32_at(36),
                length: u32_at(40),
            },
            features: Extent {
                block: u32_at(44),
                length: u32_at(48),
            },
            unit_count: u32_at(52),
            projectile_count: u32_at(56),
            feature_count: u32_at(60),
            game_id: b[64..80].try_into().unwrap(),
        };
        h.check()?;
        Ok(h)
    }

    fn check(&self) -> Result<()> {
        let bad = |reason: String| Err(TrackError::corrupt("header", reason));
        if !(1..=65_535).contains(&self.window_length) {
            return bad(format!("its window length is {}", self.window_length));
        }
        if self.last_frame < self.first_frame {
            return bad(format!(
                "its last frame, {}, is before its first, {}",
                self.last_frame, self.first_frame
            ));
        }
        if !(8..=16).contains(&self.rotation_bits) {
            return bad(format!("its rotation bits are {}", self.rotation_bits));
        }
        let expected = window_count(self.first_frame, self.last_frame, self.window_length);
        if self.window_count != expected {
            return bad(format!(
                "it says {} windows, but its frames and window length make {expected}",
                self.window_count
            ));
        }
        for (name, v) in [
            ("first frame", self.first_frame),
            ("last frame", self.last_frame),
            ("info chunk block", self.info.block),
            ("info chunk length", self.info.length),
            ("features chunk block", self.features.block),
            ("features chunk length", self.features.length),
            ("unit count", self.unit_count),
            ("projectile count", self.projectile_count),
            ("feature count", self.feature_count),
        ] {
            if v as i64 > VALUE_LIMIT {
                return bad(format!("its {name} is {v}, over {VALUE_LIMIT}"));
            }
        }
        Ok(())
    }
}

impl WindowEntry {
    pub(crate) fn encode(&self) -> [u8; INDEX_ENTRY_SIZE] {
        let mut b = [0u8; INDEX_ENTRY_SIZE];
        b[0..4].copy_from_slice(&self.main.block.to_le_bytes());
        b[4..8].copy_from_slice(&self.main.length.to_le_bytes());
        b[8..12].copy_from_slice(&self.terrain.block.to_le_bytes());
        b[12..16].copy_from_slice(&self.terrain.length.to_le_bytes());
        b
    }

    pub(crate) fn decode(b: &[u8]) -> Self {
        let w = |at: usize| u32::from_le_bytes(b[at..at + 4].try_into().unwrap());
        Self {
            main: Extent {
                block: w(0),
                length: w(4),
            },
            terrain: Extent {
                block: w(8),
                length: w(12),
            },
        }
    }
}
