//! Which samples of a curve become keys.
//!
//! The method is Douglas-Peucker over time. Keep the first and last sample.
//! Find the sample the curve between two kept neighbours predicts worst. If it
//! is off by more than the tolerance, keep it and do the same on both halves.
//!
//! A curve is thinned a stretch at a time, so that only the samples since the
//! last key are held. A stretch ends on a window's edge: the sample on the
//! edge is kept as a key, or the samples either side of it when none falls on
//! it. The track writer needs a value at each window's edge in any case, and
//! with a sample for a key there, no window has a value that was worked out
//! from the curve and rounded a second time.
//!
//! What a key predicts is asked of `coilbox-track`'s own curve functions, on
//! the rounded keys. The check in `verify` asks the same functions of the
//! keys it reads back from the written file, so the two cannot disagree.

use crate::error::Result;
use coilbox_track::{Keyed, Quantiser};

/// What thinning needs to know about the track being made.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Rules {
    pub q: Quantiser,
    /// In elmos.
    pub tolerance: f64,
    /// In metal or energy, and as a fraction of the sample, for the numbers
    /// of a team that are not kept exactly. See
    /// [`coilbox_track::value_allowance`].
    pub value_tolerance: f32,
    pub value_fraction: f32,
    pub first_frame: u32,
    pub window_length: u32,
}

impl Rules {
    fn on_edge(&self, frame: u32) -> bool {
        (frame - self.first_frame).is_multiple_of(self.window_length)
    }

    /// The first window edge after `frame`.
    fn edge_after(&self, frame: u32) -> u32 {
        let k = (frame - self.first_frame) / self.window_length;
        self.first_frame + (k + 1) * self.window_length
    }
}

/// One kind of curve: how a sample becomes a key, and how far a sample is
/// from what a list of keys says.
pub(crate) trait Curve {
    type Sample;
    type Key: Keyed + Clone + PartialEq;

    fn frame(sample: &Self::Sample) -> u32;

    /// The sample rounded to what the track stores.
    fn key(&self, q: &Quantiser, sample: &Self::Sample) -> Result<Self::Key>;

    /// How far `sample` is from the value a reader gets from `keys` at the
    /// sample's frame, in the units of [`Curve::tolerance`].
    fn error(&self, q: &Quantiser, keys: &[Self::Key], sample: &Self::Sample) -> f64;

    /// The furthest a dropped sample may be from the curve.
    fn tolerance(&self, rules: &Rules) -> f64;

    /// Whether a key between two keys of the same value can go. True for a
    /// curve that runs in a straight line between keys, since a line between
    /// two equal values is that value. Not true of a projectile, whose curve
    /// between two keys also follows their velocities.
    const FLAT_BETWEEN_EQUAL_KEYS: bool;
}

fn same_value<K: Keyed + Clone + PartialEq>(a: &K, b: &K) -> bool {
    let mut a = a.clone();
    a.set_frame(b.frame());
    &a == b
}

/// Adds a key to a curve. Where the two before it and this one all have the
/// same value, the middle one adds nothing, so this one takes its place.
pub(crate) fn emit<C: Curve>(out: &mut Vec<C::Key>, key: C::Key) {
    let n = out.len();
    if C::FLAT_BETWEEN_EQUAL_KEYS
        && n >= 2
        && same_value(&out[n - 1], &key)
        && same_value(&out[n - 2], &out[n - 1])
    {
        out[n - 1] = key;
    } else {
        out.push(key);
    }
}

/// A curve holds its last key's value after it, so a last key with the value
/// of the one before it says nothing.
pub(crate) fn close<C: Curve>(out: &mut Vec<C::Key>) {
    let n = out.len();
    if C::FLAT_BETWEEN_EQUAL_KEYS && n >= 2 && same_value(&out[n - 2], &out[n - 1]) {
        out.pop();
    }
}

/// The keys to keep from `samples`, which follow `anchor`, the key before
/// them. The last sample is always kept. Without an anchor the first is too.
fn thin<C: Curve>(
    curve: &C,
    rules: &Rules,
    anchor: Option<&C::Key>,
    samples: &[C::Sample],
) -> Result<Vec<C::Key>> {
    let q = &rules.q;
    let tolerance = curve.tolerance(rules);
    // Point 0 is the anchor when there is one, so sample `i` is point
    // `i + shift`.
    let shift = anchor.is_some() as usize;
    let mut keys: Vec<C::Key> = Vec::with_capacity(samples.len() + shift);
    keys.extend(anchor.cloned());
    for s in samples {
        keys.push(curve.key(q, s)?);
    }
    let last = keys.len() - 1;
    let mut keep = vec![false; keys.len()];
    keep[0] = true;
    keep[last] = true;
    let mut todo = vec![(0usize, last)];
    while let Some((a, b)) = todo.pop() {
        if b - a < 2 {
            continue;
        }
        let ends = [keys[a].clone(), keys[b].clone()];
        let mut worst = (tolerance, None);
        for i in a + 1..b {
            let error = curve.error(q, &ends, &samples[i - shift]);
            if error > worst.0 {
                worst = (error, Some(i));
            }
        }
        if let Some(i) = worst.1 {
            keep[i] = true;
            todo.push((a, i));
            todo.push((i, b));
        }
    }
    Ok(keys
        .into_iter()
        .zip(keep)
        .skip(shift)
        .filter_map(|(k, kept)| kept.then_some(k))
        .collect())
}

/// The samples of one curve since its last key.
pub(crate) struct Stretch<C: Curve> {
    anchor: Option<C::Key>,
    pending: Vec<C::Sample>,
    /// The frame of the last sample taken in.
    last: Option<u32>,
}

impl<C: Curve> Default for Stretch<C> {
    fn default() -> Self {
        Self {
            anchor: None,
            pending: Vec::new(),
            last: None,
        }
    }
}

impl<C: Curve> Stretch<C> {
    pub fn last_frame(&self) -> Option<u32> {
        self.last
    }

    /// Takes the next sample, and thins what is held into `out` when the
    /// sample reaches a window's edge.
    pub fn push(
        &mut self,
        curve: &C,
        rules: &Rules,
        sample: C::Sample,
        out: &mut Vec<C::Key>,
    ) -> Result<()> {
        let frame = C::frame(&sample);
        let passed = self.last.is_some_and(|last| frame > rules.edge_after(last));
        if passed {
            // No sample fell on the edge, so the one before it is a key and
            // so is this one.
            self.flush(curve, rules, out)?;
        }
        self.pending.push(sample);
        self.last = Some(frame);
        if passed || rules.on_edge(frame) {
            self.flush(curve, rules, out)?;
        }
        Ok(())
    }

    fn flush(&mut self, curve: &C, rules: &Rules, out: &mut Vec<C::Key>) -> Result<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let keys = thin(curve, rules, self.anchor.as_ref(), &self.pending)?;
        self.anchor = keys.last().cloned();
        for key in keys {
            emit::<C>(out, key);
        }
        self.pending.clear();
        Ok(())
    }

    /// Thins what is left, at the end of the curve.
    pub fn finish(&mut self, curve: &C, rules: &Rules, out: &mut Vec<C::Key>) -> Result<()> {
        self.flush(curve, rules, out)?;
        close::<C>(out);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curves::{TransformCurve, TransformSample};
    use coilbox_track::TransformKey;

    fn rules() -> Rules {
        Rules {
            q: Quantiser::new(3, 11, 12).unwrap(),
            tolerance: 0.5,
            value_tolerance: 0.5,
            value_fraction: 0.0,
            first_frame: 100,
            window_length: 900,
        }
    }

    /// A unit that drives along x at one elmo a frame, sampled on `frames`.
    fn thin_line(frames: impl Iterator<Item = u32>) -> Vec<u32> {
        let curve = TransformCurve { radius: 10.0 };
        let mut stretch = Stretch::default();
        let mut keys: Vec<TransformKey> = Vec::new();
        for frame in frames {
            let sample = TransformSample {
                frame,
                position: [frame as f64, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
            };
            stretch.push(&curve, &rules(), sample, &mut keys).unwrap();
        }
        stretch.finish(&curve, &rules(), &mut keys).unwrap();
        keys.iter().map(|k| k.frame).collect()
    }

    #[test]
    fn a_sample_on_a_window_edge_is_kept_as_a_key() {
        // Windows start at frame 100, so their edges are 1000 and 1900.
        assert_eq!(thin_line((100..=2200).step_by(3)), [100, 1000, 1900, 2200]);
    }

    #[test]
    fn the_samples_either_side_of_an_edge_are_kept_when_none_falls_on_it() {
        assert_eq!(
            thin_line((101..=2200).step_by(3)),
            [101, 998, 1001, 1898, 1901, 2198]
        );
    }

    #[test]
    fn a_gap_that_spans_a_whole_window_keeps_the_samples_at_its_two_ends() {
        let frames = (100..=400).step_by(3).chain((2500..=2800).step_by(3));
        assert_eq!(thin_line(frames), [100, 400, 2500, 2800]);
    }

    #[test]
    fn keys_of_one_value_in_a_row_are_cut_to_the_first() {
        let curve = TransformCurve { radius: 10.0 };
        let mut stretch = Stretch::default();
        let mut keys: Vec<TransformKey> = Vec::new();
        for frame in (100..=2800).step_by(3) {
            let sample = TransformSample {
                frame,
                // Still until frame 2500, then one elmo a frame.
                position: [frame.saturating_sub(2500) as f64, 0.0, 0.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
            };
            stretch.push(&curve, &rules(), sample, &mut keys).unwrap();
        }
        stretch.finish(&curve, &rules(), &mut keys).unwrap();
        // The edges at 1000 and 1900 said nothing new, and the last sample
        // before it moved, 2500, is the moment it starts.
        let frames: Vec<u32> = keys.iter().map(|k| k.frame).collect();
        assert_eq!(frames, [100, 2500, 2800]);
    }
}
