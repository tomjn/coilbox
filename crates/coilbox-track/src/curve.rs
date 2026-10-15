//! The value of a curve at a frame, from the keys either side of it.
//!
//! Before a curve's first key its value is that key's value, and after its
//! last key the same. A frame on a key gives that key's value exactly.
//!
//! The writer runs the same functions over a unit's whole curve to find the
//! value at a window's edge, so what it writes and what a reader works out
//! agree.

use crate::error::Result;
use crate::keys::*;
use crate::quant::Quantiser;

/// Where a frame sits among a curve's keys.
pub(crate) enum Span<'a, K> {
    Empty,
    /// On a key, or before the first or after the last.
    Hold(&'a K),
    /// Between two keys, `s` of the way from `a` to `b`, which are `n` frames apart.
    Between {
        a: &'a K,
        b: &'a K,
        s: f64,
        n: u32,
    },
}

pub(crate) fn span<K: Keyed>(keys: &[K], frame: u32) -> Span<'_, K> {
    let Some(first) = keys.first() else {
        return Span::Empty;
    };
    let after = keys.partition_point(|k| k.frame() <= frame);
    if after == 0 {
        return Span::Hold(first);
    }
    let a = &keys[after - 1];
    match keys.get(after) {
        Some(b) if a.frame() != frame => {
            let n = b.frame() - a.frame();
            Span::Between {
                a,
                b,
                s: (frame - a.frame()) as f64 / n as f64,
                n,
            }
        }
        _ => Span::Hold(a),
    }
}

/// The key a stepped curve is on at `frame`: the last one at or before it, or
/// the first when the frame is before them all.
pub fn held<K: Keyed>(keys: &[K], frame: u32) -> Option<&K> {
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some(k),
        Span::Between { a, .. } => Some(a),
    }
}

fn lerp3(a: [f64; 3], b: [f64; 3], s: f64) -> [f64; 3] {
    [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * s)
}

/// Two quaternions blended in the same proportion and scaled back to unit
/// length, with the second negated first when the dot product is negative.
fn nlerp(a: [f64; 4], b: [f64; 4], s: f64) -> [f64; 4] {
    let dot: f64 = (0..4).map(|i| a[i] * b[i]).sum();
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let q = [0, 1, 2, 3].map(|i| a[i] * (1.0 - s) + sign * b[i] * s);
    let len = q.iter().map(|c| c * c).sum::<f64>().sqrt();
    if len > 0.0 {
        q.map(|c| c / len)
    } else {
        a
    }
}

fn dequantised_position(q: &Quantiser, p: [i32; 3]) -> [f64; 3] {
    p.map(|v| q.position_value(v))
}

/// A unit's position in elmos and rotation as `(x, y, z, w)`. A straight line
/// between keys for position, a normalised blend for rotation.
pub fn transform_at(
    keys: &[TransformKey],
    q: &Quantiser,
    frame: u32,
) -> Option<([f64; 3], [f64; 4])> {
    let value = |k: &TransformKey| {
        (
            dequantised_position(q, k.position),
            q.rotation_value(&k.rotation),
        )
    };
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some(value(k)),
        Span::Between { a, b, s, .. } => {
            let (pa, ra) = value(a);
            let (pb, rb) = value(b);
            Some((lerp3(pa, pb, s), nlerp(ra, rb, s)))
        }
    }
}

/// Health and build progress as fractions, in a straight line between keys,
/// and the flags, which hold until the next key.
pub fn status_at(keys: &[StatusKey], frame: u32) -> Option<(f64, f64, u8)> {
    let full = crate::quant::FRACTION_FULL as f64;
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some((
            k.health as f64 / full,
            k.build_progress as f64 / full,
            k.flags,
        )),
        Span::Between { a, b, s, .. } => {
            let mix = |x: u16, y: u16| (x as f64 + (y as f64 - x as f64) * s) / full;
            Some((
                mix(a.health, b.health),
                mix(a.build_progress, b.build_progress),
                a.flags,
            ))
        }
    }
}

/// A pose track's angles in 65,536ths of a turn and offsets in elmos, all six
/// in a straight line between keys. An angle is not reduced to one turn.
pub fn pose_at(keys: &[PoseKey], q: &Quantiser, frame: u32) -> Option<([f64; 3], [f64; 3])> {
    let value = |k: &PoseKey| {
        (
            k.angles.map(|a| a as f64),
            dequantised_position(q, k.offsets),
        )
    };
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some(value(k)),
        Span::Between { a, b, s, .. } => {
            let (aa, oa) = value(a);
            let (ab, ob) = value(b);
            Some((lerp3(aa, ab, s), lerp3(oa, ob, s)))
        }
    }
}

/// A projectile's position in elmos and velocity in elmos per frame. Between
/// two keys `n` frames apart the position is the cubic through both positions
/// that matches both velocities, and the velocity is the slope of that cubic
/// divided by `n`.
pub fn projectile_at(
    keys: &[ProjectileKey],
    q: &Quantiser,
    frame: u32,
) -> Option<([f64; 3], [f64; 3])> {
    let value = |k: &ProjectileKey| {
        (
            dequantised_position(q, k.position),
            k.velocity.map(|v| q.velocity_value(v)),
        )
    };
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some(value(k)),
        Span::Between { a, b, s, n } => {
            let (p0, v0) = value(a);
            let (p1, v1) = value(b);
            let n = n as f64;
            let (s2, s3) = (s * s, s * s * s);
            let h00 = 2.0 * s3 - 3.0 * s2 + 1.0;
            let h10 = s3 - 2.0 * s2 + s;
            let h01 = -2.0 * s3 + 3.0 * s2;
            let h11 = s3 - s2;
            let d00 = 6.0 * s2 - 6.0 * s;
            let d10 = 3.0 * s2 - 4.0 * s + 1.0;
            let d01 = -6.0 * s2 + 6.0 * s;
            let d11 = 3.0 * s2 - 2.0 * s;
            let pos =
                [0, 1, 2].map(|i| h00 * p0[i] + h10 * n * v0[i] + h01 * p1[i] + h11 * n * v1[i]);
            let vel = [0, 1, 2]
                .map(|i| (d00 * p0[i] + d10 * n * v0[i] + d01 * p1[i] + d11 * n * v1[i]) / n);
            Some((pos, vel))
        }
    }
}

/// A team's or the game's number at a frame, in a straight line between keys.
pub fn value_at(keys: &[ValueKey], frame: u32) -> Option<f64> {
    match span(keys, frame) {
        Span::Empty => None,
        Span::Hold(k) => Some(k.value() as f64),
        Span::Between { a, b, s, .. } => {
            let (a, b) = (a.value() as f64, b.value() as f64);
            Some(a + (b - a) * s)
        }
    }
}

/// A key worked out from a curve, so the writer can add one where a window
/// needs it. `at` gives the curve's value at `frame` in the file's own units.
pub(crate) trait Linear: Keyed + Clone + PartialEq {
    fn at(keys: &[Self], q: &Quantiser, frame: u32) -> Result<Self>;
}

fn held_at<K: Keyed + Clone>(keys: &[K], frame: u32) -> K {
    let mut k = held(keys, frame)
        .expect("a curve with no keys was checked for earlier")
        .clone();
    k.set_frame(frame);
    k
}

impl Linear for TransformKey {
    fn at(keys: &[Self], q: &Quantiser, frame: u32) -> Result<Self> {
        if let Span::Hold(_) | Span::Empty = span(keys, frame) {
            return Ok(held_at(keys, frame));
        }
        let (p, r) = transform_at(keys, q, frame).expect("not empty");
        let rot = q.rotation(r);
        Ok(TransformKey {
            frame,
            position: [q.position(p[0])?, q.position(p[1])?, q.position(p[2])?],
            rotation: rot,
        })
    }
}

impl Linear for StatusKey {
    fn at(keys: &[Self], q: &Quantiser, frame: u32) -> Result<Self> {
        if let Span::Hold(_) | Span::Empty = span(keys, frame) {
            return Ok(held_at(keys, frame));
        }
        let (h, b, flags) = status_at(keys, frame).expect("not empty");
        Ok(StatusKey {
            frame,
            health: q.fraction(h),
            build_progress: q.fraction(b),
            flags,
        })
    }
}

impl Linear for PoseKey {
    fn at(keys: &[Self], q: &Quantiser, frame: u32) -> Result<Self> {
        if let Span::Hold(_) | Span::Empty = span(keys, frame) {
            return Ok(held_at(keys, frame));
        }
        let (a, o) = pose_at(keys, q, frame).expect("not empty");
        Ok(PoseKey {
            frame,
            angles: a.map(|v| v.round() as i32),
            offsets: [q.position(o[0])?, q.position(o[1])?, q.position(o[2])?],
        })
    }
}

impl Linear for ValueKey {
    fn at(keys: &[Self], _: &Quantiser, frame: u32) -> Result<Self> {
        if let Span::Hold(_) | Span::Empty = span(keys, frame) {
            return Ok(held_at(keys, frame));
        }
        let value = value_at(keys, frame).expect("not empty");
        Ok(ValueKey::new(frame, value as f32))
    }
}

impl Linear for ProjectileKey {
    fn at(keys: &[Self], q: &Quantiser, frame: u32) -> Result<Self> {
        if let Span::Hold(_) | Span::Empty = span(keys, frame) {
            return Ok(held_at(keys, frame));
        }
        let (p, v) = projectile_at(keys, q, frame).expect("not empty");
        Ok(ProjectileKey {
            frame,
            position: [q.position(p[0])?, q.position(p[1])?, q.position(p[2])?],
            velocity: [q.velocity(v[0])?, q.velocity(v[1])?, q.velocity(v[2])?],
        })
    }
}
