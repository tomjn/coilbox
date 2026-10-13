//! The steps a version 1 writer rounds to, worked out from the tolerance.
//!
//! The rules are in `docs/reference/replay-track-format.md` under "Choosing
//! the steps and the window length". Each keeps rounding to a quarter of the
//! tolerance.

/// The share of the tolerance that rounding may use.
const ROUNDING_SHARE: f64 = 0.25;

/// The largest shift a step is given. At 24 a step is 1 / 16,777,216, and one
/// elmo no longer fits the format's largest value.
const SHIFT_LIMIT: u8 = 24;

/// The smallest shift whose step, 1 / 2^shift, is at most `largest`.
fn shift_for(largest: f64) -> u8 {
    (0..SHIFT_LIMIT)
        .find(|shift| 1.0 / 2f64.powi(*shift as i32) <= largest)
        .unwrap_or(SHIFT_LIMIT)
}

/// The largest power of two position step whose rounding moves a point no
/// further than a quarter of the tolerance. Rounding three axes by up to half
/// a step each moves a point by up to `step * sqrt(3) / 2`.
pub(crate) fn position_shift(tolerance: f64) -> u8 {
    shift_for(tolerance * ROUNDING_SHARE * 2.0 / 3f64.sqrt())
}

/// The largest power of two velocity step whose rounding moves a
/// projectile's cubic no further than a quarter of the tolerance over a gap
/// of one window. Rounding both velocities by up to half a step moves the
/// curve by up to `window length * step * sqrt(3) / 8`.
pub(crate) fn velocity_shift(tolerance: f64, window_length: u32) -> u8 {
    shift_for(tolerance * ROUNDING_SHARE * 8.0 / (window_length as f64 * 3f64.sqrt()))
}

/// The smallest rotation width at which rounding cannot move a point `length`
/// elmos from a unit's centre further than a quarter of the tolerance.
/// Rounding turns a unit by at most `sqrt(6) / (2^(bits - 1) - 1)` radians.
///
/// 16 bits is the widest the format has. Past the length it covers, rounding
/// uses more than a quarter of the tolerance, and thinning keeps more keys to
/// stay inside the whole of it.
pub(crate) fn rotation_bits(tolerance: f64, length: f64) -> u8 {
    (8..=16u8)
        .find(|bits| {
            let turn = 6f64.sqrt() / ((1u32 << (bits - 1)) - 1) as f64;
            turn * length <= tolerance * ROUNDING_SHARE
        })
        .unwrap_or(16)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tolerance_of_half_an_elmo_gives_the_steps_the_format_document_does() {
        assert_eq!(position_shift(0.5), 3);
        assert_eq!(velocity_shift(0.5, 900), 11);
        // The largest unit radius in the BAR benchmark, then in the Splinter
        // Faction one.
        assert_eq!(rotation_bits(0.5, 85.0), 12);
        assert_eq!(rotation_bits(0.5, 130.0), 13);
    }

    #[test]
    fn a_finer_tolerance_gives_finer_steps() {
        assert_eq!(position_shift(0.25), 4);
        assert_eq!(position_shift(1.0), 2);
        assert_eq!(velocity_shift(0.5, 450), 10);
        assert_eq!(rotation_bits(0.25, 85.0), 13);
    }

    #[test]
    fn a_unit_too_large_for_the_rule_gets_the_widest_rotation() {
        assert_eq!(rotation_bits(0.5, 5000.0), 16);
    }
}
