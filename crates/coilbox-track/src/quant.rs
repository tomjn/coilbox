use crate::error::{Result, TrackError};
use crate::keys::Rotation;

/// No single value in a track is larger than this. The engine's Lua numbers
/// are 32 bit floats, which hold a whole number exactly only up to 2 to the
/// power 24.
pub const VALUE_LIMIT: i64 = 16_777_215;

/// A piece angle is a whole number of 65,536ths of a turn, the engine's own
/// unit for piece angles.
pub const ANGLE_UNITS_PER_TURN: i32 = 65_536;

/// The health and build progress of a full or complete unit.
pub const FRACTION_FULL: u16 = 65_535;

/// Turns real values into the whole numbers a track stores and back, using the
/// three steps in a track's header.
///
/// The thinning of issue #3782 checks its tolerance against the values these
/// functions give back, since those are what a reader sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quantiser {
    position_shift: u8,
    velocity_shift: u8,
    rotation_bits: u8,
}

impl Quantiser {
    /// The position step is 1 elmo divided by 2 to the `position_shift`. The
    /// velocity step is 1 elmo per frame divided by 2 to the `velocity_shift`.
    /// `rotation_bits` is 8 to 16.
    pub fn new(position_shift: u8, velocity_shift: u8, rotation_bits: u8) -> Result<Self> {
        if !(8..=16).contains(&rotation_bits) {
            return Err(TrackError::invalid(format!(
                "rotation bits must be 8 to 16, not {rotation_bits}"
            )));
        }
        Ok(Self {
            position_shift,
            velocity_shift,
            rotation_bits,
        })
    }

    pub fn position_shift(&self) -> u8 {
        self.position_shift
    }

    pub fn velocity_shift(&self) -> u8 {
        self.velocity_shift
    }

    pub fn rotation_bits(&self) -> u8 {
        self.rotation_bits
    }

    /// Elmos to position steps, rounded to the nearest. A position, a piece
    /// offset and a height all use this step.
    pub fn position(&self, elmos: f64) -> Result<i32> {
        scaled("position", elmos, self.position_shift)
    }

    pub fn position_value(&self, steps: i32) -> f64 {
        steps as f64 / 2f64.powi(self.position_shift as i32)
    }

    /// Elmos per frame to velocity steps, rounded to the nearest.
    pub fn velocity(&self, elmos_per_frame: f64) -> Result<i32> {
        scaled("velocity", elmos_per_frame, self.velocity_shift)
    }

    pub fn velocity_value(&self, steps: i32) -> f64 {
        steps as f64 / 2f64.powi(self.velocity_shift as i32)
    }

    /// The largest whole number a kept rotation component takes.
    fn rotation_scale(&self) -> f64 {
        ((1u32 << (self.rotation_bits - 1)) - 1) as f64
    }

    /// A unit quaternion `(x, y, z, w)` in the smallest three form. The input
    /// is normalised first, so a quaternion that is only nearly of unit length
    /// is accepted.
    pub fn rotation(&self, q: [f64; 4]) -> Rotation {
        let len = q.iter().map(|c| c * c).sum::<f64>().sqrt();
        let q = if len > 0.0 {
            q.map(|c| c / len)
        } else {
            [0.0, 0.0, 0.0, 1.0]
        };
        let mut dropped = 0;
        for i in 1..4 {
            if q[i].abs() > q[dropped].abs() {
                dropped = i;
            }
        }
        let sign = if q[dropped] < 0.0 { -1.0 } else { 1.0 };
        let scale = self.rotation_scale();
        let mut kept = [0i16; 3];
        let mut next = 0;
        for (i, c) in q.iter().enumerate() {
            if i == dropped {
                continue;
            }
            let n = (sign * c * scale / std::f64::consts::FRAC_1_SQRT_2).round();
            kept[next] = n.clamp(-scale, scale) as i16;
            next += 1;
        }
        Rotation {
            dropped: dropped as u8,
            kept,
        }
    }

    /// The quaternion `(x, y, z, w)` a stored rotation stands for. The dropped
    /// component comes back positive.
    pub fn rotation_value(&self, r: &Rotation) -> [f64; 4] {
        let scale = self.rotation_scale();
        let k = r
            .kept
            .map(|n| n as f64 * std::f64::consts::FRAC_1_SQRT_2 / scale);
        let dropped = (1.0 - k.iter().map(|c| c * c).sum::<f64>()).max(0.0).sqrt();
        let mut out = [0.0; 4];
        let mut next = 0;
        for (i, slot) in out.iter_mut().enumerate() {
            if i == r.dropped as usize {
                *slot = dropped;
            } else {
                *slot = k[next];
                next += 1;
            }
        }
        out
    }

    /// The rotation that turns a unit's resting front `(0, 0, 1)` and up
    /// `(0, 1, 0)` into the given front and up, in the smallest three form.
    pub fn rotation_from_front_up(&self, front: [f64; 3], up: [f64; 3]) -> Rotation {
        self.rotation(quaternion_from_front_up(front, up))
    }

    /// A fraction from 0 to 1, as health and build progress are stored.
    /// Anything outside 0 to 1 is clamped, since a unit's health can pass its
    /// maximum or go below zero for a frame.
    pub fn fraction(&self, f: f64) -> u16 {
        (f.clamp(0.0, 1.0) * FRACTION_FULL as f64).round() as u16
    }

    pub fn fraction_value(&self, n: u16) -> f64 {
        n as f64 / FRACTION_FULL as f64
    }
}

/// The quaternion `(x, y, z, w)` that turns a unit's resting front `(0, 0, 1)`
/// and up `(0, 1, 0)` into the given front and up, before any rounding.
/// `right = up x front`, and the rotation matrix has right, up and front for
/// its columns.
///
/// The thinning of issue #3782 measures a recorded sample against the track
/// with this, since the sample is what was recorded and not what was stored.
pub fn quaternion_from_front_up(front: [f64; 3], up: [f64; 3]) -> [f64; 4] {
    let right = [
        up[1] * front[2] - up[2] * front[1],
        up[2] * front[0] - up[0] * front[2],
        up[0] * front[1] - up[1] * front[0],
    ];
    // m[row][column].
    let m = [
        [right[0], up[0], front[0]],
        [right[1], up[1], front[1]],
        [right[2], up[2], front[2]],
    ];
    let trace = m[0][0] + m[1][1] + m[2][2];
    if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [
            (m[2][1] - m[1][2]) / s,
            (m[0][2] - m[2][0]) / s,
            (m[1][0] - m[0][1]) / s,
            0.25 * s,
        ]
    } else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
        let s = (1.0 + m[0][0] - m[1][1] - m[2][2]).sqrt() * 2.0;
        [
            0.25 * s,
            (m[0][1] + m[1][0]) / s,
            (m[0][2] + m[2][0]) / s,
            (m[2][1] - m[1][2]) / s,
        ]
    } else if m[1][1] > m[2][2] {
        let s = (1.0 + m[1][1] - m[0][0] - m[2][2]).sqrt() * 2.0;
        [
            (m[0][1] + m[1][0]) / s,
            0.25 * s,
            (m[1][2] + m[2][1]) / s,
            (m[0][2] - m[2][0]) / s,
        ]
    } else {
        let s = (1.0 + m[2][2] - m[0][0] - m[1][1]).sqrt() * 2.0;
        [
            (m[0][2] + m[2][0]) / s,
            (m[1][2] + m[2][1]) / s,
            0.25 * s,
            (m[1][0] - m[0][1]) / s,
        ]
    }
}

fn scaled(what: &str, value: f64, shift: u8) -> Result<i32> {
    let steps = (value * 2f64.powi(shift as i32)).round();
    if !steps.is_finite() || steps.abs() > VALUE_LIMIT as f64 {
        return Err(TrackError::OutOfRange {
            what: what.to_string(),
            value: if steps.is_finite() {
                steps as i64
            } else {
                i64::MAX
            },
            limit: VALUE_LIMIT,
        });
    }
    Ok(steps as i32)
}

/// A value that must not pass [`VALUE_LIMIT`] in either direction.
pub(crate) fn check_limit(what: impl FnOnce() -> String, value: i64) -> Result<()> {
    if value.abs() > VALUE_LIMIT {
        return Err(TrackError::OutOfRange {
            what: what(),
            value,
            limit: VALUE_LIMIT,
        });
    }
    Ok(())
}
