//! The four kinds of curve that are thinned, and how far a recorded sample is
//! from each.
//!
//! A distance is one number in elmos. Where a sample has a rotation as well
//! as a position, the angle between the recorded rotation and the track's is
//! multiplied by a length and added to the distance between the two
//! positions. For a unit the length is its radius, which bounds how far any
//! point within the radius of the unit's centre is from where it was
//! recorded. For a piece, which is measured relative to its parent, it is how
//! far the piece's geometry and that of the pieces below it reach from the
//! piece's origin.

use crate::error::Result;
use crate::pose::{self, PieceSample};
use crate::thin::{Curve, Rules};
use coilbox_track::{
    pose_at, projectile_at, status_at, transform_at, PoseKey, ProjectileKey, Quantiser, StatusKey,
    TransformKey, FRACTION_FULL,
};

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f64>().sqrt()
}

fn position(q: &Quantiser, p: [f64; 3]) -> Result<[i32; 3]> {
    Ok([q.position(p[0])?, q.position(p[1])?, q.position(p[2])?])
}

/// The angle in radians between two rotations given as quaternions.
///
/// Neither has to be of unit length. A quaternion made from a front and an up
/// direction that the engine gave as 32 bit floats is off by a few parts in a
/// million, and read as an angle that would be a turn of a few thousandths of
/// a radian that never happened.
fn quaternion_angle(a: [f64; 4], b: [f64; 4]) -> f64 {
    let dot = |x: [f64; 4], y: [f64; 4]| (0..4).map(|i| x[i] * y[i]).sum::<f64>();
    let lengths = (dot(a, a) * dot(b, b)).sqrt();
    if lengths == 0.0 {
        return 0.0;
    }
    2.0 * (dot(a, b).abs() / lengths).min(1.0).acos()
}

/// A unit's position and rotation.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TransformSample {
    pub frame: u32,
    pub position: [f64; 3],
    /// `(x, y, z, w)`, of unit length.
    pub rotation: [f64; 4],
}

pub(crate) struct TransformCurve {
    /// The unit's radius in elmos, which its turn is multiplied by.
    pub radius: f64,
}

impl Curve for TransformCurve {
    type Sample = TransformSample;
    type Key = TransformKey;
    const FLAT_BETWEEN_EQUAL_KEYS: bool = true;

    fn frame(s: &TransformSample) -> u32 {
        s.frame
    }

    fn key(&self, q: &Quantiser, s: &TransformSample) -> Result<TransformKey> {
        Ok(TransformKey {
            frame: s.frame,
            position: position(q, s.position)?,
            rotation: q.rotation(s.rotation),
        })
    }

    fn error(&self, q: &Quantiser, keys: &[TransformKey], s: &TransformSample) -> f64 {
        match transform_at(keys, q, s.frame) {
            Some((p, r)) => distance(p, s.position) + self.radius * quaternion_angle(r, s.rotation),
            None => f64::INFINITY,
        }
    }

    fn tolerance(&self, rules: &Rules) -> f64 {
        rules.tolerance
    }
}

/// A unit's health and build progress as fractions from 0 to 1, and its
/// flags.
#[derive(Debug, Clone, Copy)]
pub(crate) struct StatusSample {
    pub frame: u32,
    pub health: f64,
    pub build: f64,
    pub flags: u8,
}

/// The furthest a dropped health or build progress sample may be from the
/// track: one step of the 65,535 the track stores a fraction in.
///
/// The tolerance in a track's header is a distance, and a fraction of a
/// unit's health is not one, so the header's tolerance cannot be used here.
/// One step is the smallest whole number of steps that leaves room for
/// rounding, which moves each key by up to half a step. It cost little on the
/// benchmark recordings: 35,855 status keys for the 1,368 units of the BAR
/// match.
pub(crate) const STATUS_TOLERANCE: f64 = 1.0 / FRACTION_FULL as f64;

pub(crate) struct StatusCurve;

impl Curve for StatusCurve {
    type Sample = StatusSample;
    type Key = StatusKey;
    const FLAT_BETWEEN_EQUAL_KEYS: bool = true;

    fn frame(s: &StatusSample) -> u32 {
        s.frame
    }

    fn key(&self, q: &Quantiser, s: &StatusSample) -> Result<StatusKey> {
        Ok(StatusKey {
            frame: s.frame,
            health: q.fraction(s.health),
            build_progress: q.fraction(s.build),
            flags: s.flags,
        })
    }

    /// The larger of the two fractions' errors. Flags are not on a scale, so
    /// a sample whose flags the track gets wrong is infinitely far from it.
    fn error(&self, _: &Quantiser, keys: &[StatusKey], s: &StatusSample) -> f64 {
        match status_at(keys, s.frame) {
            Some((health, build, flags)) if flags == s.flags => {
                (health - s.health).abs().max((build - s.build).abs())
            }
            _ => f64::INFINITY,
        }
    }

    fn tolerance(&self, _: &Rules) -> f64 {
        STATUS_TOLERANCE
    }
}

/// One piece of a unit.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PoseSample {
    pub frame: u32,
    pub piece: PieceSample,
    /// The piece's rotation as the three angles a key stores, before
    /// rounding.
    pub angles: [f64; 3],
}

pub(crate) struct PoseCurve {
    /// The length in elmos the piece's turn is multiplied by: how far the
    /// piece reaches from its own origin. See [`pose::reaches`].
    pub reach: f64,
}

impl Curve for PoseCurve {
    type Sample = PoseSample;
    type Key = PoseKey;
    const FLAT_BETWEEN_EQUAL_KEYS: bool = true;

    fn frame(s: &PoseSample) -> u32 {
        s.frame
    }

    fn key(&self, q: &Quantiser, s: &PoseSample) -> Result<PoseKey> {
        Ok(PoseKey {
            frame: s.frame,
            angles: s.angles.map(|a| a.round() as i32),
            offsets: position(q, s.piece.translation)?,
        })
    }

    fn error(&self, q: &Quantiser, keys: &[PoseKey], s: &PoseSample) -> f64 {
        match pose_at(keys, q, s.frame) {
            Some((angles, offsets)) => {
                distance(offsets, s.piece.translation)
                    + self.reach * pose::angle_between(&pose::rotation(angles), &s.piece.rotation)
            }
            None => f64::INFINITY,
        }
    }

    fn tolerance(&self, rules: &Rules) -> f64 {
        rules.tolerance
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProjectileSample {
    pub frame: u32,
    pub position: [f64; 3],
    /// In elmos per frame.
    pub velocity: [f64; 3],
}

pub(crate) struct ProjectileCurve;

impl Curve for ProjectileCurve {
    type Sample = ProjectileSample;
    type Key = ProjectileKey;
    const FLAT_BETWEEN_EQUAL_KEYS: bool = false;

    fn frame(s: &ProjectileSample) -> u32 {
        s.frame
    }

    fn key(&self, q: &Quantiser, s: &ProjectileSample) -> Result<ProjectileKey> {
        Ok(ProjectileKey {
            frame: s.frame,
            position: position(q, s.position)?,
            velocity: [
                q.velocity(s.velocity[0])?,
                q.velocity(s.velocity[1])?,
                q.velocity(s.velocity[2])?,
            ],
        })
    }

    /// The distance between the positions. The track's curve between two keys
    /// is the cubic through both positions that matches both velocities, so
    /// that is what a sample is measured against.
    fn error(&self, q: &Quantiser, keys: &[ProjectileKey], s: &ProjectileSample) -> f64 {
        match projectile_at(keys, q, s.frame) {
            Some((p, _)) => distance(p, s.position),
            None => f64::INFINITY,
        }
    }

    fn tolerance(&self, rules: &Rules) -> f64 {
        rules.tolerance
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quaternion_that_is_not_quite_of_unit_length_is_not_a_turn() {
        let a = [0.0, 0.6, 0.0, 0.8];
        let longer = a.map(|c| c * 1.00001);
        assert!(quaternion_angle(a, longer) < 1e-7);
        // A real turn of a hundredth of a radian about y.
        let turned = [0.0, 0.005f64.sin(), 0.0, 0.005f64.cos()];
        let identity = [0.0, 0.0, 0.0, 1.0];
        assert!((quaternion_angle(identity, turned) - 0.01).abs() < 1e-9);
        assert!((quaternion_angle(identity, turned.map(|c| -c)) - 0.01).abs() < 1e-9);
    }
}
